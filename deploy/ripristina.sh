#!/usr/bin/env bash
# Ripristino di un backup (file .dump.age creato da backup.sh).
#
# Uso:
#   ./deploy/ripristina.sh <file.dump.age>                PROVA (predefinito)
#   ./deploy/ripristina.sh <file.dump.age> --tieni        prova, senza cancellare il database di prova
#   ./deploy/ripristina.sh <file.dump.age> --sostituisci  RIPRISTINO VERO
#   ./deploy/ripristina.sh ultimo [...]                   l'ultimo backup giornaliero del server
#
# PROVA: ripristina in un database separato (<nome>_prova) accanto a quello
# dell'app, che non viene toccato; confronta i conteggi delle tabelle
# principali con quelli attuali; poi cancella il database di prova.
#
# RIPRISTINO VERO: fa prima una copia del database attuale (backup manuale),
# ferma l'app, sostituisce il database con il contenuto del backup, applica
# le migrazioni (se il backup è di una versione precedente) e riavvia l'app.
# Tutto ciò che è stato registrato dopo il backup va perso.
#
# Serve la CHIAVE PRIVATA dei backup (AGE-SECRET-KEY-…), che non sta sul
# server: lo script la chiede e la tiene solo in memoria. In alternativa:
#   CHIAVE_PRIVATA_FILE=/percorso/del/file ./deploy/ripristina.sh ...
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
richiedi_file_env

FILE="${1:-}"
MODO="${2:---prova}"
case "$MODO" in --prova | --tieni | --sostituisci) ;; *) FILE="" ;; esac
if [[ -z "$FILE" ]]; then
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
if [[ "$FILE" == ultimo ]]; then
  FILE="$(find "$(leggi_var BACKUP_DIR)/giornalieri" -maxdepth 1 -name '*.dump.age' | sort | tail -n 1)"
  [[ -n "$FILE" ]] || { errore "nessun backup giornaliero sul server"; exit 1; }
fi
[[ -f "$FILE" ]] || { errore "file non trovato: $FILE"; exit 1; }
command -v age > /dev/null || { errore "age non è installato (sudo apt install age)"; exit 1; }

DB="$(leggi_var POSTGRES_DB)"
UTENTE_DB="$(leggi_var POSTGRES_USER)"
psql_su() { dc exec -T db psql -U "$UTENTE_DB" -v ON_ERROR_STOP=1 -X -q "$@"; }

# File temporanei solo in memoria, cancellati in ogni caso all'uscita.
CHIAVE_TMP="$(mktemp -p /dev/shm chiave.XXXXXX)"
CHIARO="$(mktemp -p /dev/shm ripristino.XXXXXX)"
trap 'rm -f "$CHIAVE_TMP" "$CHIARO"' EXIT

if [[ -n "${CHIAVE_PRIVATA_FILE:-}" ]]; then
  cp "$CHIAVE_PRIVATA_FILE" "$CHIAVE_TMP"
else
  read -r -s -p "Incolla la chiave privata dei backup (AGE-SECRET-KEY-…) e premi Invio: " chiave
  echo
  printf '%s\n' "$chiave" > "$CHIAVE_TMP"
  unset chiave
fi
grep -q '^AGE-SECRET-KEY-' "$CHIAVE_TMP" || { errore "non sembra una chiave privata age"; exit 1; }

info "Decifro $FILE"
age -d -i "$CHIAVE_TMP" -o "$CHIARO" "$FILE" || { errore "decifratura non riuscita: chiave sbagliata o file danneggiato"; exit 1; }
TABELLE="$(dc exec -T db pg_restore --list < "$CHIARO" | grep -c ' TABLE DATA ' || true)"
(( TABELLE > 0 )) || { errore "il backup non contiene tabelle"; exit 1; }
info "Backup leggibile: $TABELLE tabelle"

# Conteggi delle tabelle principali di un database.
CONTEGGI="
SELECT 'organizzazioni', count(*) FROM organizations
UNION ALL SELECT 'utenti (attivi)', count(*) FILTER (WHERE active) FROM users
UNION ALL SELECT 'utenti (tutti)', count(*) FROM users
UNION ALL SELECT 'attività', count(*) FROM activities
UNION ALL SELECT 'righe di ore', count(*) FROM time_entries
UNION ALL SELECT 'sedute PT', count(*) FROM pt_sessions
UNION ALL SELECT 'mesi inviati (versioni)', count(*) FROM month_submission_versions
UNION ALL SELECT 'modelli Excel', count(*) FROM excel_templates
UNION ALL SELECT 'email', count(*) FROM email_outbox
UNION ALL SELECT 'ultima migrazione', max(version)::text::int FROM (SELECT left(version, 3) AS version FROM schema_migrations) m
UNION ALL SELECT 'ultimo giorno con ore (AAAAMMGG)', to_char(max(entry_date), 'YYYYMMDD')::int FROM time_entries
"
conteggi() { psql_su -d "$1" -A -t -F '|' -c "$CONTEGGI"; }

if [[ "$MODO" != --sostituisci ]]; then
  PROVA="${DB}_prova"
  info "Ripristino di prova nel database $PROVA (quello dell'app non viene toccato)"
  psql_su -d postgres -c "DROP DATABASE IF EXISTS \"$PROVA\" WITH (FORCE)" -c "CREATE DATABASE \"$PROVA\""
  dc exec -T db pg_restore -U "$UTENTE_DB" -d "$PROVA" --no-owner --exit-on-error < "$CHIARO"
  info "Ripristino di prova completato. Confronto con il database attuale:"
  join -t '|' -a 1 -e '-' -o '0,1.2,2.2' <(conteggi "$PROVA" | sort -t '|' -k1,1) <(conteggi "$DB" 2> /dev/null | sort -t '|' -k1,1) |
    awk -F '|' 'BEGIN { printf "  %-34s %12s %12s\n", "", "BACKUP", "ATTUALE" } { printf "  %-34s %12s %12s\n", $1, $2, $3 }'
  if [[ "$MODO" == --tieni ]]; then
    info "Il database $PROVA resta (cancellalo con: ./deploy/compose.sh exec db dropdb -U $UTENTE_DB $PROVA)"
  else
    psql_su -d postgres -c "DROP DATABASE \"$PROVA\" WITH (FORCE)"
    info "Database di prova cancellato. PROVA RIUSCITA."
  fi
  exit 0
fi

echo
echo "ATTENZIONE: il database dell'app ($DB) verrà SOSTITUITO con il backup"
echo "  $FILE"
echo "Tutto ciò che è stato registrato dopo quel backup andrà perso."
read -r -p "Per procedere scrivi SOSTITUISCI: " risposta
[[ "$risposta" == SOSTITUISCI ]] || { echo "Annullato, nessuna modifica."; exit 1; }

info "Copia di sicurezza del database attuale"
if ! "$DIR/deploy/backup.sh" manuale; then
  read -r -p "La copia del database attuale non è riuscita. Continuare comunque? Scrivi SI: " risposta
  [[ "$risposta" == SI ]] || { echo "Annullato, nessuna modifica."; exit 1; }
fi

info "Fermo l'app"
dc stop caddy web api
dc up -d db --wait
info "Sostituisco il database $DB"
psql_su -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\""
dc exec -T db pg_restore -U "$UTENTE_DB" -d "$DB" --no-owner --exit-on-error < "$CHIARO"
info "Applico le migrazioni (se il backup è di una versione precedente)"
dc run --rm --no-deps api npm run --silent migra
info "Riavvio l'app"
dc up -d
if attendi_app 180; then
  info "RIPRISTINO COMPLETATO, l'app risponde. Contenuto attuale:"
  conteggi "$DB" | awk -F '|' '{ printf "  %-34s %12s\n", $1, $2 }'
else
  errore "il database è stato ripristinato ma l'app non risponde: ./deploy/compose.sh ps e ./deploy/compose.sh logs api"
  exit 1
fi
