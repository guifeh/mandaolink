# MandaoLink — Infraestrutura, Operação 24h e Cloudflare Tunnel (Tasks J4 e J5)

Guia completo de implantação, operação contínua e acesso remoto seguro via Cloudflare Tunnel para máquina Windows dedicada 24 h.

---

## 1. Pré-requisitos e Configurações de Hardware/BIOS

1. **BIOS / UEFI da Máquina:**
   - Configure a opção **"AC Power Loss" / "Restore on AC Power Loss" / "After Power Failure"** para **"Power On"** (ou "Last State").
   - Isso garante que, caso haja queda de energia elétrica, o computador ligue sozinho imediatamente assim que a energia for restabelecida.
2. **Logon Automático no Windows (Auto-Logon):**
   - O Docker Desktop roda no contexto da sessão do usuário e só inicializa após o logon no Windows.
   - Para permitir inicialização imediata após reboot do Windows Update ou queda de luz:
     - Utilize a ferramenta oficial Microsoft Sysinternals **`Autologon`** ou configure via `netplwiz` para logar o usuário local do operador automaticamente.
3. **Docker Desktop:**
   - Habilite a inicialização automática nas configurações: *Settings > General > "Start Docker Desktop when you log in"*.
   - WSL 2 ativado com distribuição Linux padrão.

---

## 2. Configurações de Energia do Windows

Abra o **PowerShell como Administrador** e execute:

```powershell
# Desativa suspensão quando conectado à tomada
powercfg /change standby-timeout-ac 0

# Desativa hibernação
powercfg /change hibernate-timeout-ac 0

# Desativa desligamento do monitor (ou defina 10 min se quiser tela apagada)
powercfg /change monitor-timeout-ac 0
```

---

## 3. Configuração de Variáveis de Ambiente e Segurança

1. Copie o arquivo modelo:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Defina valores obrigatórios no `.env`:
   - `POSTGRES_PASSWORD`: defina uma senha forte. O Compose bloqueia a subida caso essa variável não esteja preenchida.
   - `OWNER_EMAIL`: e-mail autorizado a receber os links mágicos de autenticação.
3. **Segurança de Rede:**
   - O banco Postgres publica a porta `5432` **estritamente em `127.0.0.1`**, protegendo contra acessos indevidos vindos da rede local (LAN).
   - O serviço `app` publica a porta `3000` **estritamente em `127.0.0.1`**.

---

## 4. Subindo o Sistema

### 4.1 Modo Padrão (Local / Desenvolvimento)
```powershell
docker compose up -d --build
```
> **Nota de Execução (Task P5):** O comando `server.ts` na inicialização do serviço `app` executa automaticamente as migrações do banco, sobe o servidor HTTP Fastify, inicia o worker de heartbeat e os workers da fila em segundo plano. Por padrão seguro, opera com `CONNECTORS=fake` e `DRY_RUN=true`, simulando o fluxo ponta a ponta a partir das fixtures sintéticas sem conectar serviços ou números externos reais.

Verifique a saúde:
```powershell
docker compose ps
curl http://127.0.0.1:3000/saude
```

### 4.2 Modo Produção com Cloudflare Tunnel (Task J5)
Para permitir que o cliente acesse e instale o PWA no celular via HTTPS sem abrir portas no roteador:

1. Obtenha o token do túnel criado no Cloudflare Zero Trust (conforme [guia](docs/ops/cloudflare-tunnel-passo-a-passo.md)).
   - No painel da Cloudflare (Public Hostnames), configure o serviço para apontar para **`HTTP`** na URL **`app:3000`** (resolvido internamente pela rede Docker `mandaolink-edge-net`).
2. Adicione no `.env`:
   ```dotenv
   # ATENÇÃO: APP_ORIGIN deve corresponder exatamente ao domínio configurado no túnel.
   # Com valor divergente, o app rejeita requisições POST pela validação de Origin/CORS.
   APP_ORIGIN=https://painel.seudominio.com.br
   COOKIE_SECURE=true
   TUNNEL_TOKEN=eyJhIjoi...
   # Sub-rede isolada da rede edge (mandaolink-edge-net) onde residem apenas app e cloudflared
   TRUSTED_TUNNEL_PROXIES=172.31.250.0/29
   # URL de heartbeat opcional (ex: Better Uptime / Healthchecks.io)
   HEARTBEAT_URL=https://uptime.betterstack.com/api/v1/heartbeat/exemplo
   ```
3. Suba os containers incluindo o profile `tunnel`:
   ```powershell
   docker compose --profile tunnel up -d
   ```
4. Arquitetura de Isolamento de Rede:
   - **`mandaolink-db-net`**: Rede interna restrita conectando apenas `postgres` e `app`. O container `cloudflared` não tem acesso a essa rede, blindando o banco de dados caso o túnel seja exposto.
   - **`mandaolink-edge-net`** (`172.31.250.0/29`): Rede isolada para tráfego web conectando apenas `cloudflared` e `app`.
   - O rate limiter do `app` confia no cabeçalho `CF-Connecting-IP` exclusivamente quando a requisição vem de `TRUSTED_TUNNEL_PROXIES` (`172.31.250.0/29`), protegendo a aplicação contra tentativas de IP spoofing sem precisar confiar em ranges públicos amplos.
   - O worker de heartbeat pinga o serviço de monitoramento a cada 5 minutos somente se o banco Postgres estiver acessível.

---

## 5. Rotina de Backup e Redundância Externa

O script `scripts/backup.ps1` gera backups consistentes (`pg_dump -Fc`), valida tamanho e faz rotação automática de **7 dias**.

### Cópia para OneDrive / USB (Redundância Física)
Para evitar perda total caso o disco rígido da máquina apresente defeito físico, informe o caminho de uma pasta sincronizada com a nuvem (ex: OneDrive ou Google Drive) ou pendrive:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -SecondaryBackupDir "C:\Users\<usuario>\OneDrive\BackupsMandaoLink"
```

### Agendamento Diário (03:00 da madrugada)
```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File C:\Users\<usuario>\mandaolink\scripts\backup.ps1 -SecondaryBackupDir C:\Users\<usuario>\OneDrive\BackupsMandaoLink"
$trigger = New-ScheduledTaskTrigger -Daily -At "03:00AM"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "MandaoLink-DailyBackup" -Action $action -Trigger $trigger -Settings $settings -Description "Backup diário MandaoLink com rotação de 7 dias e cópia secundária"
```

---

## 6. Procedimento de Teste de Restauração

Procedimento documentado para comprovar que um backup está íntegro e restaurável (registre a data da execução quando validado em ambiente ativo):

```powershell
# 1. Copiar o arquivo de backup para o container
docker cp .\backups\mandaolink_backup_exemplo.dump mandaolink-postgres:/tmp/restore.dump

# 2. Criar banco temporário de teste
docker exec mandaolink-postgres createdb -U postgres restore_teste

# 3. Restaurar o dump no banco temporário
docker exec mandaolink-postgres pg_restore -U postgres -d restore_teste /tmp/restore.dump

# 4. Validar se as tabelas foram restauradas com sucesso
docker exec mandaolink-postgres psql -U postgres -d restore_teste -c "\dt"

# 5. Limpar ambiente de teste
docker exec mandaolink-postgres dropdb -U postgres restore_teste
docker exec mandaolink-postgres rm -f /tmp/restore.dump
```
