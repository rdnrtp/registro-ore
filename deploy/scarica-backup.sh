#!/usr/bin/env bash
# Backup dalla copia FUORI dal server (BACKUP_REMOTO).
#
# Uso:
#   ./deploy/scarica-backup.sh                 elenca le copie remote
#   ./deploy/scarica-backup.sh ultimo          scarica l'ultima copia giornaliera
#   ./deploy/scarica-backup.sh <percorso>      scarica quella copia (come nell'elenco)
#
# Il file scaricato va in ~/ripristino/ e si prova con
#   ./deploy/ripristina.sh ~/ripristino/<file>
# Serve sia per la prova periodica dei backup sia per rifare il server da zero.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
richiedi_file_env

REMOTO="$(leggi_var BACKUP_REMOTO)"
[[ -n "$REMOTO" ]] || { errore "BACKUP_REMOTO è vuoto in $ENV_FILE"; exit 1; }
RCLONE_IMMAGINE="$(grep -E '^RCLONE_IMMAGINE=' "$DIR/deploy/backup.sh" | cut -d'"' -f2)"
DEST="$HOME/ripristino"
mkdir -p "$DEST" "$HOME/.config/registro-ore/chiavi"
chmod 700 "$DEST"

rclone() {
  docker run --rm --network host \
    --env-file <(grep -E '^RCLONE_[A-Z0-9_]+=' "$ENV_FILE") \
    -v "$DEST:/ripristino" \
    -v "$HOME/.config/registro-ore/chiavi:/chiavi:ro" \
    --user "$(id -u):$(id -g)" \
    "$RCLONE_IMMAGINE" "$@" --contimeout 30s --timeout 5m --retries 3 2> >(grep -v 'Config file .* not found' >&2)
}

case "${1:-}" in
  "")
    rclone lsl "$REMOTO" | sort -k4
    ;;
  ultimo)
    file="$(rclone lsf --files-only "$REMOTO/giornalieri" | grep '\.dump\.age$' | sort | tail -n 1)"
    [[ -n "$file" ]] || { errore "nessuna copia giornaliera in $REMOTO/giornalieri"; exit 1; }
    rclone copyto "$REMOTO/giornalieri/$file" "/ripristino/$file"
    info "Scaricato $DEST/$file"
    ;;
  *)
    file="$(basename "$1")"
    rclone copyto "$REMOTO/$1" "/ripristino/$file"
    info "Scaricato $DEST/$file"
    ;;
esac
