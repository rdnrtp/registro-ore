# shellcheck shell=bash
# Funzioni comuni agli script di deploy/. Si include con:
#   source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$DIR/.env.production}"

# Docker Compose di produzione.
dc() { "$DIR/deploy/compose.sh" "$@"; }

# Valore di una variabile di .env.production (senza eseguire il file:
# potrebbe contenere caratteri speciali). Toglie eventuali virgolette.
leggi_var() {
  local riga
  riga="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  riga="${riga#*=}"
  riga="${riga%\"}"; riga="${riga#\"}"
  riga="${riga%\'}"; riga="${riga#\'}"
  printf '%s' "$riga"
}

ora() { date '+%Y-%m-%d %H:%M:%S'; }
info() { echo "[$(ora)] $*"; }
errore() { echo "[$(ora)] ERRORE: $*" >&2; }

richiedi_file_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    errore "manca $ENV_FILE (vedi RUNBOOK.md)"
    exit 1
  fi
}

# Attende che l'app risponda attraverso Caddy, con il certificato vero.
# Restituisce 0 se risponde entro il tempo indicato (secondi).
attendi_app() {
  local dominio limite=${1:-120} inizio=$SECONDS
  dominio="$(leggi_var DOMINIO)"
  while (( SECONDS - inizio < limite )); do
    if curl -fsS -m 5 --resolve "$dominio:443:127.0.0.1" "https://$dominio/api/salute" > /dev/null 2>&1 \
      && curl -fsS -m 5 --resolve "$dominio:443:127.0.0.1" "https://$dominio/" > /dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# Manda un avviso tecnico ad ALLARMI_EMAIL attraverso l'API (testo da stdin).
avviso_email() {
  local oggetto="$1" testo
  testo="$(cat)"
  if dc exec -T api npm run --silent avviso-sistema -- --oggetto "$oggetto" <<< "$testo" 2> /dev/null; then
    return 0
  fi
  # API ferma: si prova con un container temporaneo.
  dc run --rm --no-deps -T api npm run --silent avviso-sistema -- --oggetto "$oggetto" <<< "$testo"
}
