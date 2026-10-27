#!/usr/bin/env bash
# Backup del database: copia compressa e cifrata, conservata sul server e
# copiata fuori dal server.
#
# Uso:
#   ./deploy/backup.sh               backup giornaliero (lo lancia il timer
#                                    di systemd ogni notte, vedi installa-servizi.sh)
#   ./deploy/backup.sh rilascio      copia prima di un rilascio (rilascia.sh)
#   ./deploy/backup.sh manuale       copia a mano, fuori dalla rotazione
#
# Cosa fa:
#   1. pg_dump del database (formato "custom" di PostgreSQL, già compresso);
#   2. controlla che la copia sia leggibile (pg_restore --list) e contenga i
#      dati di ogni tabella (ricevute delle spese e file inviati compresi:
#      stanno nel database, non ci sono altri file da salvare);
#   3. la cifra con age e la CHIAVE PUBBLICA (BACKUP_CHIAVE_PUBBLICA): sul
#      server non c'è la chiave privata, quindi nemmeno chi entrasse nel
#      server potrebbe leggere i backup;
#   4. conserva 7 copie giornaliere, 4 settimanali (la prima di ogni
#      settimana), 6 mensili (la prima di ogni mese); 5 copie prima dei
#      rilasci e 10 manuali;
#   5. copia tutta la cartella fuori dal server (BACKUP_REMOTO, con rclone);
#   6. se qualcosa va storto manda un'email ad ALLARMI_EMAIL.
set -Eeuo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"

TIPO="${1:-giornaliero}"
case "$TIPO" in
  giornaliero | rilascio | manuale) ;;
  *) echo "Uso: $0 [giornaliero|rilascio|manuale]" >&2; exit 2 ;;
esac

GIORNALIERE=7
SETTIMANALI=4
MENSILI=6
RILASCI=5
MANUALI=10
# Immagine di rclone (copia fuori dal server): versione fissa.
RCLONE_IMMAGINE="rclone/rclone:1.71"

LOG="$(mktemp)"
CHIARO=""
exec > >(tee "$LOG") 2>&1

pulisci() {
  [[ -n "$CHIARO" ]] && rm -f "$CHIARO"
  rm -f "$LOG"
}
trap pulisci EXIT

fallito() {
  local riga=$1
  errore "backup non riuscito (riga $riga di backup.sh)"
  local host
  host="$(hostname)"
  {
    echo "Il backup ($TIPO) del Registro ore sul server $host NON è riuscito."
    echo
    echo "Cosa fare: entra nel server e guarda il registro con"
    echo "  journalctl -u registro-ore-backup --since today"
    echo "oppure rilancia a mano: ./deploy/backup.sh manuale"
    echo
    echo "Ultime righe del registro:"
    tail -n 30 "$LOG"
  } | avviso_email "Backup NON riuscito su $host" || errore "anche l'email di avviso non è partita"
  local ping
  ping="$(leggi_var BACKUP_PING_URL)"
  [[ -n "$ping" ]] && curl -fsS -m 10 --retry 3 "$ping/fail" > /dev/null 2>&1 || true
  exit 1
}
trap 'fallito $LINENO' ERR

richiedi_file_env
command -v age > /dev/null || { errore "age non è installato (sudo apt install age)"; false; }

BACKUP_DIR="$(leggi_var BACKUP_DIR)"
CHIAVE="$(leggi_var BACKUP_CHIAVE_PUBBLICA)"
REMOTO="$(leggi_var BACKUP_REMOTO)"
DB="$(leggi_var POSTGRES_DB)"
UTENTE_DB="$(leggi_var POSTGRES_USER)"
[[ -n "$BACKUP_DIR" ]] || { errore "BACKUP_DIR vuoto in $ENV_FILE"; false; }
[[ "$CHIAVE" =~ ^age1[a-z0-9]{58}$ ]] || { errore "BACKUP_CHIAVE_PUBBLICA non è una chiave age (crea la coppia con ./deploy/crea-chiave-backup.sh)"; false; }
[[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || { errore "la cartella $BACKUP_DIR non esiste o non è scrivibile (sudo ./deploy/installa-servizi.sh)"; false; }

umask 077
mkdir -p "$BACKUP_DIR"/{giornalieri,settimanali,mensili,rilasci,manuali}

# Un backup alla volta.
exec 9> "$BACKUP_DIR/.blocco"
flock -n 9 || { errore "un altro backup è in corso"; false; }

ADESSO="$(date '+%Y-%m-%d_%H%M%S')"
NOME="registro-ore_${ADESSO}.dump.age"
case "$TIPO" in
  giornaliero) CARTELLA="giornalieri" ;;
  rilascio) CARTELLA="rilasci" ;;
  manuale) CARTELLA="manuali" ;;
esac
DEST="$BACKUP_DIR/$CARTELLA/$NOME"

info "Backup $TIPO del database $DB"

# 1-2. Copia in chiaro solo in memoria (/dev/shm), per il controllo.
CHIARO="$(mktemp -p /dev/shm registro-ore.XXXXXX)"
dc exec -T db pg_dump -U "$UTENTE_DB" -d "$DB" --format=custom --compress=6 > "$CHIARO"
ELENCO="$(dc exec -T db pg_restore --list < "$CHIARO")"
TABELLE="$(grep -c ' TABLE DATA ' <<< "$ELENCO" || true)"
(( TABELLE > 0 )) || { errore "la copia non contiene tabelle"; false; }
# Ogni tabella del database deve avere i suoi dati nella copia: anche le
# ricevute delle spese e i file inviati, che stanno nel database.
while IFS= read -r tabella; do
  [[ -z "$tabella" ]] && continue
  grep -q " TABLE DATA public $tabella " <<< "$ELENCO" || { errore "la copia non contiene i dati della tabella $tabella"; false; }
done < <(dc exec -T db psql -U "$UTENTE_DB" -d "$DB" -At -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
RICEVUTE="$(dc exec -T db psql -U "$UTENTE_DB" -d "$DB" -At -c \
  "SELECT CASE WHEN to_regclass('public.expense_attachments') IS NULL THEN 'nessuna' ELSE (SELECT count(*) FROM expense_attachments)::text END")"
info "Copia letta correttamente: $TABELLE tabelle (ricevute delle spese: $RICEVUTE), $(du -h "$CHIARO" | cut -f1)"

# 3. Cifratura; il file compare con il nome definitivo solo se è completo.
age -r "$CHIAVE" -o "$DEST.parziale" "$CHIARO"
mv "$DEST.parziale" "$DEST"
rm -f "$CHIARO"
CHIARO=""
info "Salvato $DEST ($(du -h "$DEST" | cut -f1))"

# 4. Copie settimanali e mensili: collegamenti allo stesso file (niente spazio in più).
if [[ "$TIPO" == giornaliero ]]; then
  SETTIMANA="$(date '+%G-W%V')"
  MESE="$(date '+%Y-%m')"
  if ! compgen -G "$BACKUP_DIR/settimanali/${SETTIMANA}_*" > /dev/null; then
    ln "$DEST" "$BACKUP_DIR/settimanali/${SETTIMANA}_$NOME"
    info "Copia settimanale $SETTIMANA"
  fi
  if ! compgen -G "$BACKUP_DIR/mensili/${MESE}_*" > /dev/null; then
    ln "$DEST" "$BACKUP_DIR/mensili/${MESE}_$NOME"
    info "Copia mensile $MESE"
  fi
fi

# Tiene le N più recenti di una cartella (i nomi iniziano con la data).
tieni() {
  local cartella="$BACKUP_DIR/$1" n=$2
  find "$cartella" -maxdepth 1 -type f -name '*.dump.age' -printf '%f\n' | sort -r | tail -n +$((n + 1)) |
    while IFS= read -r f; do
      rm -f -- "$cartella/$f"
      info "Eliminata copia vecchia $1/$f"
    done
}
tieni giornalieri $GIORNALIERE
tieni settimanali $SETTIMANALI
tieni mensili $MENSILI
tieni rilasci $RILASCI
tieni manuali $MANUALI

# 5. Copia fuori dal server.
if [[ -z "$REMOTO" ]]; then
  info "ATTENZIONE: BACKUP_REMOTO è vuoto, la copia resta SOLO su questo server."
else
  # sync rende la destinazione uguale alla cartella locale (anche le
  # eliminazioni della rotazione). --max-delete: se la cartella locale
  # risultasse svuotata per errore, non svuota anche la copia remota.
  info "Copia fuori dal server verso $REMOTO"
  # Chiavi per SFTP (facoltative), vedi RUNBOOK.md.
  mkdir -p "$HOME/.config/registro-ore/chiavi"
  # Tempi massimi: con una destinazione irraggiungibile rclone ritenterebbe
  # a lungo; così il backup fallisce (e avvisa) in pochi minuti.
  timeout 2h docker run --rm --network host \
    --env-file <(grep -E '^RCLONE_[A-Z0-9_]+=' "$ENV_FILE") \
    -v "$BACKUP_DIR:/backup:ro" \
    -v "$HOME/.config/registro-ore/chiavi:/chiavi:ro" \
    "$RCLONE_IMMAGINE" sync /backup "$REMOTO" \
    --exclude '.*' --exclude '*.parziale' --max-delete 10 --stats-one-line -v \
    --contimeout 30s --timeout 5m --retries 3 --low-level-retries 3
  info "Copia fuori dal server completata"
fi

PING="$(leggi_var BACKUP_PING_URL)"
if [[ -n "$PING" ]]; then
  curl -fsS -m 10 --retry 3 "$PING" > /dev/null || info "ATTENZIONE: BACKUP_PING_URL non raggiungibile"
fi
info "Backup completato"
