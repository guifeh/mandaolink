<#
.SYNOPSIS
    Script de backup diário do Postgres com rotação de 7 dias e cópia de redundância.
.DESCRIPTION
    Executa pg_dump dentro do container Postgres do Docker, copia o arquivo
    para o diretório local de backups, sincroniza com diretório secundário (opcional)
    e remove arquivos com mais de 7 dias.
.EXAMPLE
    pwsh -File .\scripts\backup.ps1 -SecondaryBackupDir "D:\Backups\OneDrive"
#>

[CmdletBinding()]
param(
    [string]$ContainerName = "mandaolink-postgres",
    [string]$DbUser = "",
    [string]$DbName = "",
    [string]$BackupDir = (Join-Path $PSScriptRoot "..\backups"),
    [string]$SecondaryBackupDir = "", # Opcional: pasta do OneDrive, Google Drive ou USB
    [int]$RetentionDays = 7
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$timestamp] [$Level] $Message"
}

# Tenta carregar credenciais do .env se não foram passadas como parâmetro
$envPath = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*POSTGRES_USER\s*=\s*(.+)$' -and -not $DbUser) { $DbUser = $matches[1].Trim() }
        if ($_ -match '^\s*POSTGRES_DB\s*=\s*(.+)$' -and -not $DbName) { $DbName = $matches[1].Trim() }
    }
}
if (-not $DbUser) { $DbUser = "postgres" }
if (-not $DbName) { $DbName = "mandaolink" }

try {
    Write-Log "Iniciando rotina de backup do MandaoLink (Banco: $DbName, Usuário: $DbUser)..."

    # 1. Garante que o diretório de destino primário existe
    if (-not (Test-Path -Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        Write-Log "Diretório de backups criado em: $BackupDir"
    }

    # 2. Verifica se o container está em execução
    $containerStatus = docker inspect --format '{{.State.Running}}' $ContainerName 2>$null
    if ($containerStatus -ne "true") {
        throw "Container '$ContainerName' não está em execução ou não foi encontrado."
    }

    # 3. Gera nome de arquivo com timestamp
    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $backupFileName = "mandaolink_backup_$timestamp.dump"
    $localBackupPath = Join-Path $BackupDir $backupFileName
    $containerTempPath = "/tmp/$backupFileName"

    Write-Log "Gerando dump no container ($containerTempPath)..."
    
    # 4. Executa pg_dump no formato custom (-Fc)
    docker exec $ContainerName pg_dump -U $DbUser -d $DbName -Fc -f $containerTempPath
    if ($LASTEXITCODE -ne 0) {
        throw "Falha na execução do pg_dump dentro do container."
    }

    # 5. Copia o arquivo gerado para o host
    Write-Log "Copiando backup para o host: $localBackupPath"
    docker cp "${ContainerName}:${containerTempPath}" $localBackupPath
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao copiar arquivo de backup do container para o host."
    }

    # 6. Remove arquivo temporário de dentro do container
    docker exec $ContainerName rm -f $containerTempPath

    # 7. Valida integridade do arquivo gerado
    $fileInfo = Get-Item -Path $localBackupPath
    if ($fileInfo.Length -le 0) {
        throw "Arquivo de backup gerado está vazio (0 bytes)."
    }
    $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
    Write-Log "Backup primário concluído: $backupFileName ($sizeMB MB)" "SUCCESS"

    # 8. Cópia secundária fora do disco principal (OneDrive, Google Drive ou USB)
    if ($SecondaryBackupDir) {
        if (-not (Test-Path -Path $SecondaryBackupDir)) {
            New-Item -ItemType Directory -Path $SecondaryBackupDir -Force | Out-Null
        }
        $secondaryPath = Join-Path $SecondaryBackupDir $backupFileName
        Copy-Item -Path $localBackupPath -Destination $secondaryPath -Force
        Write-Log "Cópia secundária de redundância gravada em: $secondaryPath" "SUCCESS"

        # Rotação também no diretório secundário
        $oldSecondary = Get-ChildItem -Path $SecondaryBackupDir -Filter "mandaolink_backup_*.dump" |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) }
        foreach ($oldSec in $oldSecondary) {
            Remove-Item -Path $oldSec.FullName -Force
            Write-Log "Removido backup secundário expirado: $($oldSec.Name)"
        }
    }

    # 9. Rotação primária: remove backups com mais de $RetentionDays dias
    Write-Log "Verificando arquivos antigos para rotação ($RetentionDays dias de retenção)..."
    $cutoffDate = (Get-Date).AddDays(-$RetentionDays)
    $oldBackups = Get-ChildItem -Path $BackupDir -Filter "mandaolink_backup_*.dump" |
        Where-Object { $_.LastWriteTime -lt $cutoffDate }

    $removedCount = 0
    foreach ($oldFile in $oldBackups) {
        Write-Log "Removendo backup expirado: $($oldFile.Name) (criado em $($oldFile.LastWriteTime))"
        Remove-Item -Path $oldFile.FullName -Force
        $removedCount++
    }

    Write-Log "Rotação concluída. $removedCount arquivo(s) expirado(s) removido(s)."
    exit 0

} catch {
    Write-Log "ERRO durante o backup: $_" "ERROR"
    exit 1
}
