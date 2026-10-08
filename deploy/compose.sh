#!/usr/bin/env bash
# Docker Compose di produzione, con il file e le variabili giusti.
# Uso (dalla cartella del progetto o da qualsiasi altra):
#   ./deploy/compose.sh ps
#   ./deploy/compose.sh logs -f api
#   ./deploy/compose.sh exec api npm run crea-admin -- ...
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DIR/.env.production}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Manca $ENV_FILE: crealo con ./deploy/genera-segreti.sh (vedi RUNBOOK.md)." >&2
  exit 1
fi
exec docker compose --project-directory "$DIR" -f "$DIR/compose.prod.yml" --env-file "$ENV_FILE" "$@"
