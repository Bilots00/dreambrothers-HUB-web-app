# Wall art: pubblicazione Manuale / Automatica da "Approva Design"

Data: 2026-09-01 · Richiesta di Andrea: poter approvare un quadro dal telefono e
vederlo pubblicato su Gelato + Shopify senza PC acceso e senza passare dal
Bulk Creator a mano.

## Il problema

Oggi l'approvazione di una wall art si ferma a "file pronti da scaricare":
l'upscale (3x4)/(5x7) lo fa SOLO il PC (Topaz, task pianificato ogni 15') e la
creazione del prodotto su Gelato/Shopify la fa Andrea nel Bulk Creator, dal
browser del PC. Dal telefono il giro non si chiude.

## La scelta (nuova impostazione)

Nella pagina **Approva Design**, un'impostazione a 2 radio, salvata nel DB
(chiave `wallart.publishMode`, quindi vale da qualsiasi dispositivo):

- **Manuale** (default, = oggi): file (3x4)/(5x7) consegnati come download,
  prodotto creato da Andrea nel Bulk Creator.
- **Automatica**: approvare È pubblicare. Il server fa tutto da solo.

## Come funziona la modalità automatica

1. **Approvazione** → `pubblicaDesign` (veste wallart) legge la modalità.
2. **File mancanti** → il server scrive la coda `state/upscale-wallart.json`
   nella repo dell'agente (stesso schema di `fronti-da-rifare.json`) e marca la
   pubblicazione `in_corso` + `attesaFile`.
3. **VPS**: cron ogni 5' (`scripts/upscale-wallart.sh`) legge la coda, lancia
   `engine/upscale-batch.mjs <data> --solo-wallart` con Real-ESRGAN
   (`.venv` con torch CPU + spandrel + modello: verificati presenti), committa i
   PNG e svuota la coda. Se il PC è acceso il watchdog Topaz può arrivare prima:
   chi arriva primo vince, l'altro salta i file già esistenti.
4. **Web app (Railway)**: poller ogni 3' (`riprendiWallartAuto` nello
   scheduler) vede i file e chiama `eseguiWallartAuto`, che replica ESATTAMENTE
   le chiamate del Bulk Creator al worker Cloudflare `gelato-backend`:
   upload multipart su R2 (chunk 6MB) coi nomi `<Titolo> (3x4).jpg` /
   `<Titolo> ISO (5x7).jpg`, poi `gelato-get-template` + `gelato-bulk-create`
   (publish, salesChannels shopify, settings mostPopular/priceRef/inventoryRef,
   combine Material/Frame). Titolo e descrizione dal copy del design
   (`titoloProdotto`/`descrizioneProdotto`), non dal nome file.
5. **Esito** dentro `batch.json` (`pubblicazioni.wallart`): `pubblicato` con
   gli esiti per template, oppure `errore` con "riprova". Timeout attesa file:
   3 ore, poi errore parlante.

## Impostazioni del Bulk Creator → DB

Template scelti e automazioni (`gelato.templates`, `gelato.automation`) oggi
vivono solo nel localStorage del browser: il Bulk Creator ora le specchia nel
DB (debounce 1.5s) e le rilegge da lì al mount. La modalità automatica le usa
dal server. Senza template salvato, la pubblicazione automatica si ferma con
l'istruzione di aprire il Bulk Creator una volta.

## Fix incluso

`pubblicaDesign` abbinava i file `(3x4)`/`(5x7)` col primo match nella cartella
della notte: con 2+ wall art nello stesso batch poteva consegnare il file di un
ALTRO design. Ora si cerca prima il nome esatto (`titoloFileWallart`, specchio
di `titoloDa` in upscale-batch.mjs), col vecchio `includes` solo come ripiego.

## Env / prerequisiti

- Railway: riusa `VITE_WORKER_KEY`, `VITE_GELATO_STORE_ID` (già presenti),
  `PRODUCT_ARTIST_GITHUB_TOKEN`. Nessuna variabile nuova.
- VPS: nessun pacchetto nuovo (venv già pronto). Cron nuovo installato.
- Nessun servizio a pagamento nuovo (gate economico: ok).
