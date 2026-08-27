#!/usr/bin/env bash
# DreamBrothers — mirror della cartella di reference dal PC di Andrea al VPS.
#
# PERCHÉ ESISTE
# Il livello 3 della cascata notturna sono le immagini della cartella
# "…\Instagram DAILY post (Organic)\TOP Brands Inspiration…\Reference", che
# stanno sul PC. L'agente però lavora sul VPS all'01:00, quando il PC può
# benissimo essere spento: se leggesse direttamente dal disco di Andrea, la
# notte dipenderebbe dal fatto che lui non abbia chiuso il portatile.
# Quindi si copia: il VPS tiene una copia locale, e la notte lavora su quella.
# Se il PC è spento la copia resta quella dell'ultima sincronizzazione — la
# notte gira lo stesso, che è tutto il punto.
#
# COSA FA
#   1. elenca i file locali (immagini e video)
#   2. chiede al VPS cosa ha già
#   3. spedisce SOLO i mancanti, in un colpo solo (tar via ssh — su Windows
#      rsync non c'è, e mille scp separati impiegherebbero un'eternità)
#   4. manda alla web app il manifest, così in Bozze si vede quante reference
#      ci sono e quante ne restano da usare
#
# NON cancella niente: i file usati restano dove sono finché Andrea non approva
# la bozza che ne è nata (regola della fase di test, 2026-08-27). Quando si
# passerà alla fase a regime basterà accendere SPOSTA_APPROVATE=true.
#
# Uso:  bash scripts/mirror-reference.sh
# Cron: Windows Scheduled Task "DreamBrothers Mirror Reference", ogni notte 00:30

set -uo pipefail

SRC="${REFERENCE_DIR:-E:/IDriveLocal/ALL FILES -Cloud-Drive_andrea.bilotta00@gmail.com/E-commerce/MARKETING - PNL, Copy & Vendita/Instagram DAILY post (Organic)/TOP Brands Inspiration (Profiles, IG Pages & Influencers)/Reference}"
VPS="${VPS_HOST:-vps}"
DEST="${REFERENCE_DEST:-/home/andrea/reference-social-pc}"
HUB="${HUB_URL:-https://meta-ai-media-buyer-production.up.railway.app}"
REPO_DIR="${REPO_DIR:-$HOME/Documents/GitHub/meta-ai-media-buyer}"
TMP="${TMPDIR:-/tmp}/mirror-reference.$$"

# Il segreto sta nel .env della web app: un posto solo, non una copia in più.
if [ -z "${CARE_WEBHOOK_SECRET:-}" ] && [ -f "$REPO_DIR/.env" ]; then
  CARE_WEBHOOK_SECRET="$(grep -m1 '^CARE_WEBHOOK_SECRET=' "$REPO_DIR/.env" | cut -d= -f2- | tr -d '\r')"
fi

mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

if [ ! -d "$SRC" ]; then
  echo "FATAL: cartella di reference non trovata: $SRC"
  exit 1
fi

echo "===== mirror reference $(date -Is) ====="
echo "da:  $SRC"
echo "a:   $VPS:$DEST"

# 1. Cosa c'è qui. Solo file veri, niente sottocartelle: la cartella è piatta,
#    e _usate/ (che nascerà a regime) va esclusa di proposito.
find "$SRC" -maxdepth 1 -type f \
     \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \
        -o -iname '*.avif' -o -iname '*.heic' -o -iname '*.jfif' -o -iname '*.mp4' \) \
     -printf '%f\n' 2>/dev/null | sort > "$TMP/locali.txt"
N_LOCALI=$(wc -l < "$TMP/locali.txt")
echo "locali: $N_LOCALI file"

if [ "$N_LOCALI" -eq 0 ]; then
  echo "niente da mandare, esco"
  exit 0
fi

# 2. Cosa ha già il VPS.
ssh -o ConnectTimeout=20 "$VPS" "mkdir -p '$DEST' && ls -1 '$DEST' 2>/dev/null" | sort > "$TMP/remoti.txt" || {
  echo "FATAL: non riesco a raggiungere $VPS"
  exit 1
}
echo "sul VPS: $(wc -l < "$TMP/remoti.txt") file"

# 3. I mancanti, in un unico tar. Un file per riga, con -T: i nomi hanno spazi
#    e parentesi, e passarli come argomenti li spezzerebbe.
comm -23 "$TMP/locali.txt" "$TMP/remoti.txt" > "$TMP/mancanti.txt"
N_MANCANTI=$(wc -l < "$TMP/mancanti.txt")
echo "da spedire: $N_MANCANTI file"

if [ "$N_MANCANTI" -gt 0 ]; then
  if tar -C "$SRC" -czf - -T "$TMP/mancanti.txt" | ssh "$VPS" "tar -C '$DEST' -xzf -"; then
    echo "spediti $N_MANCANTI file"
  else
    echo "WARN: invio fallito, il manifest riporterà solo quello che è arrivato davvero"
  fi
fi

# 4. Il manifest: nome, dimensione e GRUPPO.
#
#    Il gruppo è come si riconosce un carosello. Instagram scarica le slide con
#    il nome `<handle>_<timestampDelPost>_<idMedia>_<idUtente>.<ext>`: le slide
#    dello stesso post condividono handle e timestamp. Senza questo, un carosello
#    da 8 slide conterebbe come 8 reference e l'agente ne userebbe una sola
#    slide per volta — mentre è UN post e va letto tutto insieme.
#    Il manifest elenca quello che c'e' DAVVERO sul VPS, non quello che c'e' sul
#    PC: se un invio fallisce a meta', la web app non deve promettere reference
#    che l'agente poi non trova.
ssh -o ConnectTimeout=20 "$VPS" "ls -1 '$DEST' 2>/dev/null" | sort > "$TMP/remoti-dopo.txt"

python - "$SRC" "$TMP/remoti-dopo.txt" > "$TMP/manifest.json" <<'PY'
import json, os, re, sys
src, elenco = sys.argv[1], sys.argv[2]
sul_vps = {r.strip() for r in open(elenco, encoding="utf-8", errors="replace") if r.strip()}
esiti = []
for nome in sorted(sul_vps):
    if os.path.splitext(nome)[1].lower() not in (
        ".jpg", ".jpeg", ".png", ".webp", ".avif", ".heic", ".jfif", ".mp4"):
        continue
    p = os.path.join(src, nome)
    size = os.path.getsize(p) if os.path.isfile(p) else 0
    base = os.path.splitext(nome)[0]
    # handle_timestamp_media_user -> le slide di uno stesso carosello
    m = re.match(r"^(.+?_\d{9,})_\d+_\d+$", base)
    esiti.append({"nome": nome, "size": size, "gruppo": m.group(1) if m else None})
print(json.dumps({"file": esiti}))
PY

if [ -z "${CARE_WEBHOOK_SECRET:-}" ]; then
  echo "WARN: CARE_WEBHOOK_SECRET assente, salto l'invio del manifest alla web app"
else
  python - "$TMP/manifest.json" "$SRC" "$DEST" > "$TMP/payload.json" <<'PY'
import json, sys
dati = json.load(open(sys.argv[1], encoding="utf-8"))
dati["cartellaPc"] = sys.argv[2]
dati["cartellaVps"] = sys.argv[3]
print(json.dumps(dati))
PY
  RISP=$(curl -sf -X POST "$HUB/api/social/cartella-manifest" \
    -H "x-care-secret: $CARE_WEBHOOK_SECRET" \
    -H "content-type: application/json" \
    --data-binary "@$TMP/payload.json") \
    && echo "manifest inviato: $RISP" \
    || echo "WARN: invio del manifest alla web app fallito"
fi

echo "===== fine $(date -Is) ====="
