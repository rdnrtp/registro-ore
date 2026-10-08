#!/usr/bin/env bash
# Preparazione di un server Ubuntu LTS (22.04 o 24.04) appena creato.
# Si lancia come root, una volta; rilanciarlo non fa danni (ogni passo
# controlla prima cosa c'è già).
#
# Uso (da root sul server):
#   bash prepara-server.sh <utente>
#   bash prepara-server.sh <utente> "ssh-ed25519 AAAA... commento"
#
# <utente> è l'utente non root con cui lavorerai (es. registro). La sua
# chiave SSH pubblica è la seconda riga di comando oppure, se manca, quella
# già autorizzata per root (il fornitore la mette lì quando crei il server
# con una chiave SSH).
#
# Cosa fa:
#   - fuso orario Europe/Rome, aggiornamenti del sistema
#   - utente non root con sudo (password chiesta qui, solo per sudo)
#   - SSH: solo con chiave, niente root, niente password
#   - firewall (ufw): aperte solo 22, 80, 443
#   - fail2ban contro i tentativi di accesso SSH ripetuti
#   - aggiornamenti di sicurezza automatici (con riavvio alle 04:30 se serve)
#   - Docker (repository ufficiale) con il plugin Compose
#   - memoria di swap se il server ne è privo, log di sistema limitati
set -Eeuo pipefail

UTENTE="${1:-}"
CHIAVE="${2:-}"
passo() { echo; echo "==> $*"; }
fine() { echo "ERRORE: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fine "va lanciato come root (sudo bash $0 ...)"
[[ -n "$UTENTE" ]] || fine "uso: bash $0 <utente> [\"chiave SSH pubblica\"]"
[[ "$UTENTE" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || fine "nome utente non valido: solo minuscole, cifre e -"
[[ "$UTENTE" != root ]] || fine "serve un utente diverso da root"
source /etc/os-release
[[ "$ID" == ubuntu ]] || fine "previsto per Ubuntu, trovato $ID"
export DEBIAN_FRONTEND=noninteractive
APT_OPZ=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

passo "Fuso orario Europe/Rome"
timedatectl set-timezone Europe/Rome
timedatectl show -p Timezone --value

passo "Aggiornamento del sistema e pacchetti di base"
apt-get update -q
apt-get "${APT_OPZ[@]}" upgrade
apt-get "${APT_OPZ[@]}" install ca-certificates curl git ufw fail2ban python3-systemd \
  unattended-upgrades age gnupg

passo "Utente $UTENTE"
if ! id "$UTENTE" &> /dev/null; then
  adduser --disabled-password --gecos "" "$UTENTE"
fi
usermod -aG sudo "$UTENTE"
CASA="$(getent passwd "$UTENTE" | cut -d: -f6)"
install -d -m 700 -o "$UTENTE" -g "$UTENTE" "$CASA/.ssh"
AUTORIZZATE="$CASA/.ssh/authorized_keys"
touch "$AUTORIZZATE"
if [[ -n "$CHIAVE" ]]; then
  [[ "$CHIAVE" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\ [A-Za-z0-9+/=]+ ]] || fine "la chiave indicata non sembra una chiave SSH pubblica"
  grep -qxF "$CHIAVE" "$AUTORIZZATE" || echo "$CHIAVE" >> "$AUTORIZZATE"
elif [[ ! -s "$AUTORIZZATE" && -s /root/.ssh/authorized_keys ]]; then
  # Solo le righe di chiave, senza le opzioni che alcuni fornitori aggiungono per root.
  grep -oE '(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+) [A-Za-z0-9+/=]+( .*)?$' /root/.ssh/authorized_keys >> "$AUTORIZZATE" || true
fi
chown "$UTENTE:$UTENTE" "$AUTORIZZATE"
chmod 600 "$AUTORIZZATE"
# Senza una chiave autorizzata, chiudere l'accesso con password chiuderebbe fuori tutti.
[[ -s "$AUTORIZZATE" ]] || fine "nessuna chiave SSH per $UTENTE: rilancia indicando la chiave pubblica come secondo parametro"
echo "Chiavi autorizzate per $UTENTE: $(wc -l < "$AUTORIZZATE")"
# Password solo per sudo (l'accesso SSH resterà solo con chiave).
if passwd -S "$UTENTE" | awk '{ exit !($2 == "L" || $2 == "NP") }'; then
  echo "Scegli la password di $UTENTE: servirà solo per i comandi con sudo."
  echo "Salvala nel gestore di password."
  until passwd "$UTENTE"; do echo "Riprova."; done
fi

passo "SSH: solo con chiave, niente root, niente password"
# "00-" perché sshd usa il primo valore che trova: questo file vince sugli
# altri della cartella (es. 50-cloud-init.conf che a volte riattiva le password).
cat > /etc/ssh/sshd_config.d/00-registro-ore.conf << FINE
# Scritto da prepara-server.sh (Registro ore)
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers $UTENTE
FINE
sshd -t || fine "configurazione SSH non valida: nessuna modifica applicata"
systemctl reload ssh 2> /dev/null || systemctl restart ssh

passo "Firewall: aperte solo 22 (SSH), 80 e 443 (app)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (reindirizza a HTTPS, certificati)'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTPS (HTTP/3)'
ufw --force enable
ufw status verbose

passo "fail2ban: blocco di un'ora dopo 5 accessi SSH falliti in 10 minuti"
cat > /etc/fail2ban/jail.d/registro-ore.local << 'FINE'
# Scritto da prepara-server.sh (Registro ore)
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
FINE
systemctl enable fail2ban
systemctl restart fail2ban

passo "Aggiornamenti di sicurezza automatici"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'FINE'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
FINE
cat > /etc/apt/apt.conf.d/52registro-ore << 'FINE'
// Scritto da prepara-server.sh (Registro ore).
// Oltre agli aggiornamenti di sicurezza di Ubuntu (predefiniti), quelli di Docker.
Unattended-Upgrade::Allowed-Origins {
        "Docker:${distro_codename}";
};
// Se un aggiornamento richiede il riavvio, avviene alle 04:30 (dopo il
// backup delle 02:30). L'app ripart da sola.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
FINE
systemctl enable --now unattended-upgrades

passo "Docker"
if ! command -v docker &> /dev/null || [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
fi
apt-get "${APT_OPZ[@]}" install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
if [[ ! -f /etc/docker/daemon.json ]]; then
  # Log dei container limitati anche per quelli fuori dal Compose.
  cat > /etc/docker/daemon.json << 'FINE'
{
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
FINE
  systemctl restart docker
fi
systemctl enable --now docker
# Il gruppo docker equivale a root: solo per l'utente che gestisce l'app.
usermod -aG docker "$UTENTE"
docker --version
docker compose version

passo "Memoria di swap e log di sistema"
if [[ -z "$(swapon --show --noheadings)" ]]; then
  # La costruzione delle immagini può superare la RAM di un server piccolo.
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-registro-ore-swap.conf
  sysctl -p /etc/sysctl.d/90-registro-ore-swap.conf
fi
swapon --show
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/registro-ore.conf << 'FINE'
[Journal]
SystemMaxUse=500M
FINE
systemctl restart systemd-journald

passo "Cartella dell'app"
install -d -m 755 -o "$UTENTE" -g "$UTENTE" /opt/registro-ore

cat << FINE

==================================================================
 Server preparato.

 PRIMA di chiudere questa sessione, apri un NUOVO terminale sul tuo
 PC e controlla di riuscire a entrare con:

     ssh $UTENTE@<IP del server>

 e che "sudo whoami" risponda root. Se non funziona, NON chiudere
 questa sessione: da qui puoi ancora correggere.
 Da adesso root non può più entrare via SSH, e nessuno con una password.
==================================================================
FINE
if [[ -f /var/run/reboot-required ]]; then
  echo
  echo "Gli aggiornamenti richiedono un riavvio: dopo la verifica, lancia  sudo reboot"
fi
