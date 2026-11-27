# Pubblicazione automatica Instagram e Facebook

L'Hub pubblica da solo le bozze che approvi in **Bozze**. Blotato non serve più.

Funziona così: approvi, scegli l'ora, e il post esce entro 5 minuti da quell'ora. Non apri mai Instagram.

---

## 🔑 Cosa serve, una volta sola (circa 20 minuti)

### 1. Controlla Pagina e Instagram nel Business Manager nuovo

Apri **business.facebook.com** → Impostazioni → Account.

- La **Pagina DreamBrothers** deve stare nel Business Manager nuovo, con te come amministratore (controllo totale).
- L'**account Instagram** deve essere un account professionale e collegato a quella Pagina.

Se una delle due è ancora nel Business Manager rubato, fermati qui: prima va recuperata (centro assistenza Meta).

### 2. Crea l'app Meta (modalità sviluppo)

Vai su **developers.facebook.com** → Le mie app → Crea app.

- Tipo: **Business**, collegata al Business Manager nuovo.
- Aggiungi i casi d'uso **"Gestisci tutto sulla tua Pagina"** e **"Instagram API con Facebook Login"**.
- Lasciala in **modalità sviluppo**. Tu sei amministratore dell'app, quindi i permessi funzionano sui tuoi account senza revisione di Meta.

Annota **ID app** e **Chiave segreta** (Impostazioni → Di base).

### 3. Prendi il token dal Graph API Explorer

Vai su **developers.facebook.com/tools/explorer**, scegli la tua app e aggiungi questi permessi:

- `instagram_basic`
- `instagram_content_publish`
- `pages_manage_posts`
- `pages_read_engagement`
- `pages_show_list`
- `business_management` (serve perché la Pagina sta in un Business Manager)

Premi **Generate Access Token**. Nel login spunta la Pagina DreamBrothers e l'account Instagram. Copia il token: dura un'ora.

### 4. Trasformalo in token di Pagina che non scade

Nel repo dell'Hub, su PowerShell:

```powershell
$env:META_APP_ID="ID app"; $env:META_APP_SECRET="chiave segreta"; $env:META_USER_TOKEN="token del passo 3"
```

```powershell
node scripts/meta-page-token.mjs
```

Lo script stampa, per ogni Pagina, `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN` e i permessi mancanti. Deve dire **Scade: mai** e **Permessi mancanti: nessuno**.

### 5. Incolla i valori su Railway

Railway → progetto dell'Hub → **Variables**:

| Variabile | Valore |
|---|---|
| `META_PAGE_ACCESS_TOKEN` | il token stampato dallo script |
| `META_PAGE_ID` | l'id della Pagina |
| `META_IG_USER_ID` | l'id Instagram (facoltativo: se manca lo legge dalla Pagina) |

Il token sta solo lì, come gli altri segreti dell'Hub. Non va mai in chat, Notion o Telegram.

Railway riavvia l'Hub da solo. In **Bozze** compare la riga grigia *"Pubblicazione automatica attiva su @…"*. Se invece compare il riquadro giallo, c'è scritto cosa manca.

---

## ✅ Come si usa

- **Approva e pianifica**: scegli data e ora, il post esce da solo.
- **Pubblica ora**: esce entro pochi secondi (chiede conferma).
- **Annulla**: toglie dalla coda un post non ancora uscito.

Dopo la pubblicazione la card mostra **Apri il post**.

### Se qualcosa va storto

La card mostra l'errore in chiaro. L'Hub riprova **al massimo 3 volte** (dopo 10 e poi 20 minuti), poi si ferma.

Si ferma subito, senza riprovare, quando riprovare non serve: permesso mancante, caption oltre 2200 caratteri, più di 30 hashtag, più di 20 immagini.

Se il server si riavvia proprio mentre pubblica, l'Hub **non riprova da solo** per non fare un doppione: guarda il profilo, e ripianifica solo se il post non c'è.

---

## 📐 Cosa pubblica e come

| Bozza | Instagram | Pagina Facebook |
|---|---|---|
| 1 immagine | post singolo | foto con testo |
| 2–20 immagini | carosello | un post con tutte le foto |
| 1 video | Reel | non ancora supportato |
| formato "story" | storia | — |
| solo testo | non possibile | post di testo |

Le immagini vengono convertite in **JPEG** (Instagram accetta solo quello) e servite a Meta da un indirizzo dell'Hub firmato che scade dopo 6 ore.

**Pinterest** resta fuori: l'app Pinterest è in accesso Trial, quindi lì si continua con l'upload CSV in blocco.

**Regola del Brain**: il prodotto mostrato deve essere reale. L'AI genera contesto ed emozione, mai l'oggetto venduto. L'approvazione in Bozze è il momento in cui lo controlli: niente esce senza il tuo clic.

---

## Note tecniche

- Codice: `server/socialPublish.ts` (chiamate Graph API), `server/socialPublishStore.ts` (coda, scheduler, link alle immagini), test in `server/socialPublish.test.ts`.
- Scheduler: ogni 5 minuti nel processo dell'Hub, solo se `META_PAGE_ACCESS_TOKEN` è impostato.
- Escono solo le bozze messe in coda dai pulsanti nuovi (colonna `publishQueuedAt`). Le bozze vecchie già "Pianificate" prima di questa funzione non partono da sole.
- Versione Graph API: `v23.0` (disponibile fino a ottobre 2027), cambiabile con `META_GRAPH_VERSION`.
- Limite Meta: 100 post via API ogni 24 ore per account Instagram (la doc in un punto dice 50). Siamo a 3 al giorno.
- Fonti verificate il 2026-11-27: developers.facebook.com/docs/instagram-platform/content-publishing, /docs/pages-api/posts, /docs/facebook-login/guides/access-tokens/get-long-lived.
