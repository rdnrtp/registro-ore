#!/usr/bin/env bash
# Installa il backup automatico notturno (timer di systemd) e prepara la
# cartella dei backup. Si lancia con sudo dalla cartella dell'app, dopo aver
# completato .env.production; rilanciarlo non fa danni.
#
# Uso: sudo ./deploy/installa-servizi.sh
#
# Il backup parte ogni notte alle 02:30 (se il server era spento, appena si
# riaccende) come l'utente proprietario della cartella dell'app.
# Controllo:  systemctl list-timers registro-ore-backup.timer
# Registro:   journalctl -u registro-ore-backup
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
[[ $EUID -eq 0 ]] || { errore "va lanciato con sudo"; exit 1; }
richiedi_file_env

UTENTE="$(stat -c %U "$DIR")"
[[ "$UTENTE" != root ]] || { errore "la cartella $DIR deve appartenere all'utente dell'app, non a root"; exit 1; }
CASA="$(getent passwd "$UTENTE" | cut -d: -f6)"
BACKUP_DIR="$(leggi_var BACKUP_DIR)"
[[ -n "$BACKUP_DIR" ]] || { errore "BACKUP_DIR vuoto in $ENV_FILE"; exit 1; }

info "Cartella dei backup $BACKUP_DIR (solo $UTENTE)"
install -d -m 700 -o "$UTENTE" -g "$UTENTE" "$BACKUP_DIR"
install -d -m 700 -o "$UTENTE" -g "$UTENTE" "$CASA/.config" "$CASA/.config/registro-ore" "$CASA/.config/registro-ore/chiavi"
chmod 600 "$ENV_FILE"

info "Servizio e timer del backup"
cat > /etc/systemd/system/registro-ore-backup.service << FINE
# Scritto da deploy/installa-servizi.sh (Registro ore)
[Unit]
Description=Backup del Registro ore
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
User=$UTENTE
Group=$UTENTE
SupplementaryGroups=docker
Environment=HOME=$CASA
WorkingDirectory=$DIR
ExecStart=$DIR/deploy/backup.sh giornaliero
TimeoutStartSec=3h
Nice=10
FINE

cat > /etc/systemd/system/registro-ore-backup.timer << 'FINE'
# Scritto da deploy/installa-servizi.sh (Registro ore)
[Unit]
Description=Backup notturno del Registro ore

[Timer]
OnCalendar=*-*-* 02:30:00
# Se il server era spento alle 02:30, il backup parte all'accensione.
Persistent=true

[Install]
WantedBy=timers.target
FINE

systemctl daemon-reload
systemctl enable --now registro-ore-backup.timer
systemctl list-timers registro-ore-backup.timer --no-pager
info "Fatto. Per un backup subito: sudo systemctl start registro-ore-backup && journalctl -u registro-ore-backup -e"
