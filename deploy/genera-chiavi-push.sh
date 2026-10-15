#!/usr/bin/env bash
# Crea una coppia di chiavi VAPID per le notifiche push e stampa le due righe
# da copiare in .env.production (vedi RUNBOOK.md, 6.4). Non scrive nessun
# file: le chiavi compaiono solo su questo terminale.
#
# La chiave privata è un segreto: non va mandata a nessuno, va solo in
# .env.production e nella sua copia nel gestore di password.
# Cambiare le chiavi spegne le notifiche su tutti i dispositivi: ognuno
# dovrà riattivarle dalla pagina Notifiche.
#
# Uso: ./deploy/genera-chiavi-push.sh
set -euo pipefail

# Stessa immagine di Node dell'API (già scaricata sul server).
docker run --rm --network none node:24-alpine node -e '
const { generateKeyPairSync } = require("crypto");
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const pubblica = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log("VAPID_PUBLIC_KEY=" + pubblica.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + privateKey.export({ format: "jwk" }).d);
'
