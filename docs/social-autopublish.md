# Pubblicazione automatica su Instagram

L'Hub pubblica da solo le bozze che approvi in **Bozze**. Blotato non serve più, e nemmeno la Pagina Facebook.

Approvi, scegli l'ora, e il post esce entro 5 minuti da quell'ora. Instagram non lo apri mai.

---

## 🔑 Cosa serve, una volta sola

Si usa **Instagram API con Instagram Login**: secondo la documentazione Meta *"non richiede una Pagina Facebook collegata all'account Instagram professionale"*.

**Non c'è nessuna approvazione da aspettare.** L'app resta in modalità sviluppo e pubblica sul tuo account, che è collegato all'app. La revisione di Meta (App Review) serve solo per pubblicare su account di altre persone.

### 1. L'app Meta

Su **developers.facebook.com** → Le mie app → Crea app, con il caso d'uso **"Gestisci messaggi e contenuti su Instagram"**. Niente portfolio business: non serve.

### 2. Collega l'account Instagram

Nell'app: **Instagram → Configurazione dell'API con l'accesso a Instagram → Genera token d'accesso → Aggiungi account**. Entri con Instagram e premi **Consenti**.

L'account deve essere **professionale** (Business o Creator) e **pubblico**.

### 3. Il token su Railway

La dashboard mostra il token: dura 60 giorni. Copialo e incollalo su Railway → progetto dell'Hub → **Variables**:

| Variabile | Valore |
|---|---|
| `META_IG_ACCESS_TOKEN` | il token della dashboard |

Basta questo. L'Hub legge da solo l'id dell'account e **rinnova il token ogni settimana**, quindi non scade.

Il token sta solo lì e in una tabella del server. Non va mai in chat, Notion o Telegram.

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

| Bozza | Instagram |
|---|---|
| 1 immagine | post singolo |
| 2–20 immagini | carosello |
| 1 video | Reel |
| formato "story" | storia |

Le immagini vengono convertite in **JPEG** (Instagram accetta solo quello) e servite a Meta da un indirizzo dell'Hub firmato che scade dopo 6 ore.

**Pinterest** resta fuori: l'app Pinterest è in accesso Trial, quindi lì si continua con l'upload CSV in blocco.

**Regola del Brain**: il prodotto mostrato deve essere reale. L'AI genera contesto ed emozione, mai l'oggetto venduto. L'approvazione in Bozze è il momento in cui lo controlli: niente esce senza il tuo clic.

---

## Facebook (facoltativo, più avanti)

La Pagina vecchia è persa. Quando ne crei una nuova, e solo se ti serve:

1. Nell'app aggiungi il caso d'uso **"Gestisci tutto sulla tua Pagina"**.
2. Dal **Graph API Explorer** genera un token con `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
3. Trasformalo nel token di Pagina che non scade:

```powershell
$env:META_APP_ID="ID app"; $env:META_APP_SECRET="chiave segreta"; $env:META_USER_TOKEN="token dell'Explorer"
```

```powershell
node scripts/meta-page-token.mjs
```

4. Su Railway: `META_PAGE_ACCESS_TOKEN` e `META_PAGE_ID`. In Bozze compaiono anche i pulsanti per i post Facebook.

---

## Note tecniche

- Codice: `server/socialPublish.ts` (chiamate Graph API), `server/socialPublishStore.ts` (coda, scheduler, token, link alle immagini), test in `server/socialPublish.test.ts`.
- Instagram passa da `graph.instagram.com` con `META_IG_ACCESS_TOKEN` (permessi `instagram_business_basic`, `instagram_business_content_publish`). Se manca, Instagram può passare anche dalla Pagina, con `META_PAGE_ACCESS_TOKEN`.
- Rinnovo: `GET graph.instagram.com/refresh_access_token` (token vivo e vecchio di almeno 24 ore). Controllo ogni giorno alle 04:10, rinnovo se sono passati 7 giorni. Il token rinnovato sta nella tabella `social_tokens`, mai in `user_settings` (che il client legge). Se su Railway incolli un token nuovo, vince quello.
- Scheduler: ogni 5 minuti, solo se c'è almeno un canale collegato.
- Escono solo le bozze messe in coda dai pulsanti nuovi (colonna `publishQueuedAt`). Le bozze vecchie già "Pianificate" non partono da sole.
- Versione Graph API: `v23.0` (disponibile fino a ottobre 2027), cambiabile con `META_GRAPH_VERSION`.
- Limite Meta: 100 post via API ogni 24 ore (la doc in un punto dice 50). Siamo a 3 al giorno.
- Fonti verificate il 2026-11-27: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login, /content-publishing, /instagram-api-with-instagram-login/business-login, /get-started, /create-an-instagram-app; /docs/pages-api/posts.
