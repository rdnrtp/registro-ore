#!/usr/bin/env bash
# Crea la coppia di chiavi che cifra i backup e scrive la chiave PUBBLICA in
# .env.production. La chiave PRIVATA (serve solo per ripristinare) viene
# mostrata a video UNA VOLTA e non viene salvata da nessuna parte: copiala
# subito nel gestore di password e su carta (vedi RUNBOOK.md, "Chiave dei backup").
#
# Uso: ./deploy/crea-chiave-backup.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/comune.sh"
richiedi_file_env
command -v age-keygen > /dev/null || { errore "age non è installato (sudo apt install age)"; exit 1; }

attuale="$(leggi_var BACKUP_CHIAVE_PUBBLICA)"
if [[ "$attuale" =~ ^age1 ]]; then
  echo "In $ENV_FILE c'è già una chiave pubblica: $attuale"
  echo "Una chiave nuova vale solo per i backup futuri; quelli già fatti si"
  echo "aprono SOLO con la chiave privata vecchia (non buttarla)."
  read -r -p "Crearne comunque una nuova? Scrivi NUOVA per confermare: " risposta
  [[ "$risposta" == "NUOVA" ]] || { echo "Nessuna modifica."; exit 0; }
fi

# La chiave privata resta solo in questa variabile, mai su disco.
privata="$(age-keygen 2> /dev/null | grep '^AGE-SECRET-KEY-')"
pubblica="$(age-keygen -y <<< "$privata")"

clear || true
cat << FINE
==================================================================
 CHIAVE PRIVATA DEI BACKUP — copiala ORA, non verrà mostrata più

 $privata

 Salvala in DUE posti:
  1. nel gestore di password (voce "Registro ore - chiave backup");
  2. stampata o scritta a mano, in un luogo sicuro fuori dall'ufficio.
 Senza questa chiave i backup NON si possono aprire, da nessuno.
 Non metterla sul server, non mandarla per email o chat.
==================================================================
FINE
echo
fine="${privata: -6}"
for tentativo in 1 2 3; do
  read -r -p "Per conferma, scrivi gli ULTIMI 6 caratteri della chiave privata: " controllo
  [[ "$controllo" == "$fine" ]] && break
  echo "Non corrispondono, ricontrolla la copia."
  [[ $tentativo == 3 ]] && { echo "Nessuna modifica: rilancia lo script."; exit 1; }
done
clear || true

if grep -qE '^BACKUP_CHIAVE_PUBBLICA=' "$ENV_FILE"; then
  sed -i "s|^BACKUP_CHIAVE_PUBBLICA=.*|BACKUP_CHIAVE_PUBBLICA=$pubblica|" "$ENV_FILE"
else
  echo "BACKUP_CHIAVE_PUBBLICA=$pubblica" >> "$ENV_FILE"
fi
echo "Chiave pubblica scritta in $ENV_FILE:"
echo "  $pubblica"
echo "Salva anche questa riga nel gestore di password, accanto alla privata."
