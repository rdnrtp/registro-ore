#!/usr/bin/env bash
# Crea .env.production da .env.production.example e riempie da solo le
# password e le chiavi casuali (i valori "SOSTITUISCI_CON_genera-segreti").
# Rieseguibile: se .env.production esiste già, riempie solo quelle ancora
# vuote e non tocca nient'altro.
#
# Uso: ./deploy/genera-segreti.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESEMPIO="$DIR/.env.production.example"
DEST="${ENV_FILE:-$DIR/.env.production}"
SEGNO='SOSTITUISCI_CON_genera-segreti'

# 36 byte casuali = 48 caratteri, solo lettere, cifre, "-" e "_" (nessun
# carattere che crei problemi nel file o in un indirizzo).
casuale() { head -c 36 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n='; }

umask 077
if [[ ! -f "$DEST" ]]; then
  cp "$ESEMPIO" "$DEST"
  echo "Creato $DEST"
fi
chmod 600 "$DEST"

generati=0
tmp="$(mktemp "$DEST.XXXXXX")"
while IFS= read -r riga || [[ -n "$riga" ]]; do
  if [[ "$riga" =~ ^([A-Z_]+)=${SEGNO}$ ]]; then
    printf '%s=%s\n' "${BASH_REMATCH[1]}" "$(casuale)"
    echo "  generato ${BASH_REMATCH[1]}" >&2
    generati=$((generati + 1))
  else
    printf '%s\n' "$riga"
  fi
done < "$DEST" > "$tmp"
mv "$tmp" "$DEST"
chmod 600 "$DEST"

echo "Valori casuali generati: $generati"
rimasti="$(grep -E '^[A-Z_]+=.*SOSTITUISCI' "$DEST" | cut -d= -f1 || true)"
if [[ -n "$rimasti" ]]; then
  echo
  echo "Da completare a mano in $DEST (nano $DEST):"
  echo "$rimasti" | sed 's/^/  - /'
else
  echo "Nessun valore di esempio rimasto."
fi
