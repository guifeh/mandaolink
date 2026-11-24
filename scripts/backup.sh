#!/usr/bin/env bash
# ==============================================================================
# Script de backup diário do Postgres com rotação de 7 dias (Linux/WSL)
# ==============================================================================
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-mandaolink-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-mandaolink}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../backups}"
RETENTION_DAYS=7

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$1] $2"
}

log "INFO" "Iniciando rotina de backup..."

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "ERROR" "Container $CONTAINER_NAME não está em execução."
  exit 1
fi

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
BACKUP_FILE="mandaolink_backup_${TIMESTAMP}.dump"
CONTAINER_TEMP="/tmp/${BACKUP_FILE}"
HOST_TARGET="${BACKUP_DIR}/${BACKUP_FILE}"

log "INFO" "Executando pg_dump no container..."
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "$CONTAINER_TEMP"

log "INFO" "Copiando dump para o host: $HOST_TARGET"
docker cp "${CONTAINER_NAME}:${CONTAINER_TEMP}" "$HOST_TARGET"
docker exec "$CONTAINER_NAME" rm -f "$CONTAINER_TEMP"

if [ ! -s "$HOST_TARGET" ]; then
  log "ERROR" "Arquivo de backup gerado está vazio."
  rm -f "$HOST_TARGET"
  exit 1
fi

log "SUCCESS" "Backup gerado com sucesso: $BACKUP_FILE ($(du -h "$HOST_TARGET" | cut -f1))"

log "INFO" "Executando rotação de backups (> $RETENTION_DAYS dias)..."
find "$BACKUP_DIR" -name "mandaolink_backup_*.dump" -type f -mtime "+${RETENTION_DAYS}" -exec rm -f {} +

log "SUCCESS" "Rotina de backup finalizada com sucesso."
exit 0
