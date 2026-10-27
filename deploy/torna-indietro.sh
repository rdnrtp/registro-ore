#!/usr/bin/env bash
# Torna alla versione precedente all'ultimo rilascio (vedi .rilasci.log).
#
# Uso (dalla cartella dell'app):
#   ./deploy/torna-indietro.sh                  solo il codice; i dati restano
#   ./deploy/torna-indietro.sh --con-database   codice E database com'erano
#                                               prima del rilascio
#
# Quasi sempre basta il primo: le migrazioni aggiungono e non tolgono, quindi
# la versione precedente funziona anche con il database aggiornato.
# Il secondo serve solo se la nuova versione ha rovinato i dati o se la
# versione precedente non parte con il database aggiornato: rimette il
# backup fatto all'inizio del rilascio, e TUTTO ciò che i colleghi hanno
# registrato dopo il rilascio va perso. Serve la chiave privata dei backup.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
richiedi_file_env
cd "$DIR"

CON_DATABASE=false
case "${1:-}" in
  "") ;;
  --con-database) CON_DATABASE=true ;;
  *) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

[[ -s .rilasci.log ]] || { errore "nessun rilascio annotato in .rilasci.log"; exit 1; }
IFS='|' read -r QUANDO PRIMA DOPO BACKUP < <(tail -n 1 .rilasci.log)
if [[ "$BACKUP" == indietro ]]; then
  errore "l'ultimo passo è già stato un ritorno indietro ($QUANDO)."
  echo "Per andare a una versione precisa: ./deploy/rilascia.sh <commit>   (elenco: git log --oneline -20 origin/HEAD)" >&2
  exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$DOPO" ]]; then
  errore "il codice attuale non è quello dell'ultimo rilascio annotato: niente da annullare automaticamente."
  exit 1
fi

echo "Rilascio del $QUANDO"
echo "  versione attuale:  $(git log -1 --format='%h %ad %s' --date=short "$DOPO")"
echo "  torno a:           $(git log -1 --format='%h %ad %s' --date=short "$PRIMA")"
$CON_DATABASE && echo "  database:          backup $BACKUP (i dati inseriti dopo vanno persi)"
read -r -p "Confermi? Scrivi SI: " risposta
[[ "$risposta" == SI ]] || { echo "Annullato."; exit 1; }

git checkout --quiet --detach "$PRIMA"
echo "$(date -Is)|$DOPO|$PRIMA|indietro" >> .rilasci.log
info "Costruzione della versione precedente"
dc build

if $CON_DATABASE; then
  [[ -f "$BACKUP" ]] || { errore "backup del rilascio non trovato: $BACKUP (cercalo con ./deploy/scarica-backup.sh)"; exit 1; }
  # Ferma l'app, sostituisce il database, applica le migrazioni della
  # versione precedente e riavvia.
  ./deploy/ripristina.sh "$BACKUP" --sostituisci
else
  dc up -d --remove-orphans --wait
  attendi_app 180 || { errore "l'app non risponde: ./deploy/compose.sh logs --tail 100 api"; exit 1; }
fi
# Caddyfile montato come singolo file: se è cambiato, Caddy va ricreato.
if ! git diff --quiet "$PRIMA" "$DOPO" -- deploy/Caddyfile; then
  info "Il Caddyfile è cambiato: ricreo Caddy"
  dc up -d --force-recreate --wait caddy
fi
info "TORNATO ALLA VERSIONE $(git log -1 --format='%h %s')"
