#!/usr/bin/env bash
# Rilascio di una nuova versione sul server.
#
# Uso (dalla cartella dell'app, come utente dell'app):
#   ./deploy/rilascia.sh             ultima versione del ramo principale del repository
#   ./deploy/rilascia.sh <commit>    una versione precisa (commit o tag)
#
# Passi: 1. backup del database   2. codice dal repository   3. costruzione
# delle immagini   4. migrazioni   5. riavvio   6. controllo che l'app risponda.
# Se qualcosa va storto si ferma e dice come tornare indietro
# (./deploy/torna-indietro.sh). Ogni rilascio è annotato in .rilasci.log.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
richiedi_file_env
cd "$DIR"

suggerimento() {
  errore "rilascio interrotto (riga $1 di rilascia.sh)."
  if [[ -n "${DOPO:-}" ]]; then
    echo "Per tornare alla versione di prima:  ./deploy/torna-indietro.sh" >&2
    echo "Per capire cosa è successo:          ./deploy/compose.sh ps   e   ./deploy/compose.sh logs --tail 100 api" >&2
  else
    echo "Il codice non è stato cambiato: l'app continua con la versione di prima." >&2
  fi
}
trap 'suggerimento $LINENO' ERR

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  errore "ci sono modifiche ai file del repository fatte sul server:"
  git status --short --untracked-files=no >&2
  echo "Sul server il codice non si modifica: annullale con  git checkout -- .  (o chiedi aiuto)." >&2
  exit 1
fi

PRIMA="$(git rev-parse HEAD)"

info "1/6 Backup del database prima del rilascio"
./deploy/backup.sh rilascio
BACKUP="$(find "$(leggi_var BACKUP_DIR)/rilasci" -maxdepth 1 -name '*.dump.age' | sort | tail -n 1)"

info "2/6 Codice dal repository"
git fetch --prune --tags --quiet origin
RIF="${1:-$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main)}"
DOPO="$(git rev-parse --verify --quiet "$RIF^{commit}")" || { errore "versione sconosciuta: $RIF"; DOPO=""; false; }
if [[ "$PRIMA" == "$DOPO" ]]; then
  info "Il server è già alla versione $(git log -1 --format='%h %s' "$DOPO"): ricostruisco comunque."
fi
echo "Da: $(git log -1 --format='%h %ad %s' --date=short "$PRIMA")"
echo "A:  $(git log -1 --format='%h %ad %s' --date=short "$DOPO")"
git checkout --quiet --detach "$DOPO"
echo "$(date -Is)|$PRIMA|$DOPO|$BACKUP" >> .rilasci.log

info "3/6 Costruzione delle immagini (qualche minuto)"
dc build --pull
dc pull --quiet db caddy

info "4/6 Migrazioni del database"
dc up -d --wait db
dc run --rm --no-deps api npm run --silent migra

info "5/6 Riavvio dell'app"
dc up -d --remove-orphans --wait
# Il Caddyfile è montato come singolo file: git lo sostituisce con un file
# nuovo e Caddy continuerebbe a leggere quello vecchio. Se è cambiato, Caddy
# si ricrea (pochi secondi senza risposta).
if ! git diff --quiet "$PRIMA" "$DOPO" -- deploy/Caddyfile; then
  info "Il Caddyfile è cambiato: ricreo Caddy"
  dc up -d --force-recreate --wait caddy
fi

info "6/6 Controllo che l'app risponda"
attendi_app 180 || { errore "l'app non risponde in HTTPS"; false; }

docker image prune -f > /dev/null
info "RILASCIO COMPLETATO: $(git log -1 --format='%h %s')"
