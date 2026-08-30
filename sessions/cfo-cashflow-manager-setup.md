# CFO Cashflow Manager Setup
<!-- externalId: cfo-cashflow-manager-setup -->

## user — 2026-08-30T11:01:00Z
Ho creato il bot Telegram per parlare con l'agente Cashflow Manager mappato nel company brain.
BotFather ha dato il token del bot `@CFO_Cashflow_manager_bot` (id 8425308430) — [segreto omesso].
Allegato: `HR_ Dream_TEAM/CFO/cfo-cashflow-manager-1percent-mansioni.md`.
Richiesta: accendere il bot come gli altri agenti, con la voce dell'agente descritta nel markdown.

## assistant — 2026-08-30T11:12:00Z
Acceso seguendo l'infrastruttura esistente del Dream Team sul VPS (nessun codice nuovo).

1. **Voce**: la scheda-ruolo copiata nel Brain come
   `areas/hr-training/ruoli/cfo-cashflow-manager.md`, con frontmatter nel formato delle altre
   schede. Committata e pushata su `dreambrothers-brain` (`3b99f11`). Il bot la legge **live**:
   se cambia il file, cambia l'agente.
2. **Squadra**: voce nuova in `~/claude-bot-workspace/dreamteam/squadra.json`
   (`id: cfo`, emoji 💶, `env: TOKEN_CFO`), con nel campo il vincolo di privacy
   (nel gruppo passa solo segnali aggregati, mai saldi o conti). Backup fatto prima.
3. **Token**: in `~/.dreamteam.env` come `TOKEN_CFO`, file a `chmod 600`. Un solo posto.
   Verificato con `getMe` e `getWebhookInfo`: nessun webhook, nessun poller fantasma.
4. **Avvio**: `systemctl --user restart dreamteam` → log
   `in squadra: CFO - Cashflow Manager @cfo_cashflow_manager_bot` /
   `Run polling for bot @CFO_Cashflow_manager_bot` / `Dream Team in ascolto (4 membri)`.
5. **Verifica vera**: fatto rispondere l'agente offline con il motore `claude -p`
   (scheda caricata: 13.608 caratteri). Si è presentato con la sua voce — patto operativo
   (contanti la sera ad Andrea, tutto il resto all'agente), "non decido mai al posto tuo",
   lente asset/passività — e ha chiesto se Overview-Conti e BUDGET erano già aggiornati.

Trappola nota confermata: sotto shell non-login `claude` non è nel PATH
(`~/.local/bin`); il service unit lo imposta esplicitamente, quindi in produzione va.

Rimaste a mano: aggiungere il bot al gruppo Dream Team (`getChatMember` → "chat not found",
quindi non è ancora membro). Non riuscito: il push di `squadra.json` sul repo di backup
`claude-bot-workspace` (chiave SSH del VPS non autorizzata su quel repo) — commit locale fatto.

## user — 2026-08-30T11:45:00Z
Procediamo per gradi: prima scegliere un aggregatore bancario (scegli tu).
Contesto: in una chat precedente avevo proposto di dare all'agente le credenziali
dell'homebanking via variabili env, e mi era stato spiegato perché è sbagliato
(prompt injection, eccezioni alla SCA, decadenza della protezione antifrode dei contratti
bancari) e che la strada giusta è l'open banking AISP in sola lettura.

Il bot su Telegram risponde: dice che gli mancano i dati perché il canale di alimentazione
non è attivo, e chiede accesso ai due spreadsheet + i contanti del giorno.

Link forniti (condivisione alzata da viewer a editor):
- Overview-Conti: `docs.google.com/spreadsheets/d/13X-UgN_mE45KU4oYllbTEblaLn3NMmrz`
- BUDGET: `docs.google.com/spreadsheets/d/1DQzYG7M1Kjcd69l46qPRsRTSRxQ02j3uDvf14M4tCvM`

Richiesta: **un solo documento**, fusione dei due — la tabella mensile di Overview-Conti
dentro ogni scheda-mese di BUDGET. Aggiornamenti: non più Deliveroo ma **Amazon** (corriere),
non più Intesa Sanpaolo ma **Isybank**, non più Etsy/Ebay ma **Shopify** (brand DreamBrothers).

Elenco abbonamenti e costi fissi mensili fornito: rimborso mamma 200 €, P.IVA 250 €,
benzina 80 € (dato vecchio), rata BBVA 72 € (finisce a novembre), Loox 8,72 € (disdetto,
ora Trustoo gratis; piano 50 €), Shopify Basic 27 € / Growth 74 € (rinnovo giorno 8),
Claude Pro 18 / Max 90 / Max x20 ~200 € (attuale), Railway 25 €, Canva 12 € (in pausa),
Wind Tre 6,99 €, Gemini AI Plus 4,99 € (rinnovo giorno 9), Microsoft 365 6,99 €,
AI API token 18 €, HT Parental Control / Appblock / Stayfocusd (?), iDrive 65,30 €/anno.
Altre piattaforme: Hostinger VPS, OpenAI GPT image 2.0, Higgsfield, Similarweb, Semrush,
Zendrop (annuale ~300$ da promo). Totali stimati da Andrea: 693,71 € e 497 €.

## assistant — 2026-08-30T12:05:00Z
**Aggregatore scelto: Enable Banking**, modalità *restricted production*, con il gate
economico del Brain applicato (numero + fonte + cosa succede quando finisce):

- **Costo 0 €** — la restricted production è per "evaluation in real-life scenarios […]
  as well as individual non-commercial use" (`enablebanking.com/docs/api/linked-accounts/`).
- **4 letture automatiche al giorno per conto** senza SCA (RTS PSD2 art. 35(5)(b));
  fabbisogno reale 1/giorno → margine 4×.
- **Ogni 180 giorni** serve che Andrea rifaccia l'SCA dall'app della banca (EBA, 90→180 gg):
  non è un costo ma se salta il ledger si ferma in silenzio → l'agente avvisa a 170 giorni.
- **Copertura**: Isybank (changelog Enable Banking aprile 2026), BBVA Italia, Revolut.

Scartati: GoCardless/Nordigen (iscrizioni nuove chiuse da luglio 2025), Tink/TrueLayer/
Yapily/Fabrick (solo contratto enterprise), open-banking.io (3 €/mese ma ~20 istituti).

Fuori dall'open banking: Amex (estratto mensile), Bondora e crypto (API sola lettura con
prelievi disabilitati), Shopify (MCP già collegato), contanti (Andrea).

[Aggiunte alla scheda-ruolo nel Brain le sezioni "V. Canale dati" e "VI. Lo strumento unico",
committate e pushate (`90a0aae`). Verificato su Telegram: l'agente risponde già citando
Enable Banking, i 180 giorni e l'avviso a 170.]

[Creato `HR_ Dream_TEAM/CFO/DreamBrothers-Cashflow-2026.xlsx` con uno script openpyxl
(`build-cashflow-2026.py`): Dashboard, Abbonamenti, Categorie, 12 fogli mese, Archivio 2023.
Verificato con un controllo strutturale prima fatto fallire di proposito su un file rotto.]

**Numeri emersi**: i costi fissi non sono 693,71 € ma **921,41 €/mese** (890,97 mensili +
30,44 di annuali spalmate). Su ~1.100 € di entrate restano **178,59 €**, non 407 €.
Al netto dell'accantonamento P.IVA (che è cassa vincolata, non spesa) la spesa vera è 671,41 €.
Da dicembre finisce la rata BBVA: +72 €/mese. Conseguenza: Semrush e Shopify Growth **non ora**.

**Segnalato**: i due Google Sheets erano condivisi come "anyone with the link can **edit**" —
dati finanziari modificabili da chiunque abbia il link. Va rimesso su accesso limitato e dato
accesso solo all'identità dell'agente sul VPS.

## user — 2026-08-30T12:15:00Z
Link del documento importato su Drive:
`docs.google.com/spreadsheets/d/1Y4FO7QAbkfBuUNnFc1DqtlweAPpYKgRPhWwsGccHl3E`

Critica: il file fa cagare. Non avevo chiesto di rifare tutto da zero ma di **modificare
BUDGET**: mancano i grafici che c'erano (torta guadagni vs spese, barre entrate, barre spese
per categoria), il layout e lo stile sono approssimativi. I grafici andrebbero messi nella
dashboard accanto o sotto alla tabella con l'overview di tutti i mesi.

Inoltre: non è chiaro a quali "8 importi mancanti" mi riferissi.
Info nuova: lo stipendio Amazon è di circa **1.100 € al mese**.

Poi: `/session-export`.

## assistant — 2026-08-30T12:22:00Z
Critica accettata: la richiesta era **aggiungere** la tabella dentro BUDGET, non ricostruire.
Rifacendo da zero ho perso i grafici e lo stile che già funzionavano.

**Piano per il prossimo giro** (da riprendere da qui):
1. Partire dalla copia di BUDGET importata su Drive
   (`1Y4FO7QAbkfBuUNnFc1DqtlweAPpYKgRPhWwsGccHl3E`) — oppure dal BUDGET originale —
   tenendo Dashboard, grafici e stile verde esistenti.
2. Innestare in ogni scheda-mese la tabella dei saldi giornalieri
   (Isybank, BBVA, Revolut, Bondora, Crypto, Cash, Shopify, Amazon, Amex, TOTALE, Δ),
   sotto o accanto ai blocchi già presenti, senza toccare i grafici.
3. Aggiungere nella Dashboard i grafici nuovi (andamento saldo/patrimonio nei 12 mesi)
   accanto o sotto la tabella annuale, nello stesso stile dei grafici esistenti.
4. Riportare il foglio Abbonamenti (registro costi fissi con stato, rinnovo, annualizzato)
   e il registro transazioni con i menu a tendina.
5. Correggere Zendrop: ~300 **dollari**, non euro (~275 €).

**Gli 8 importi mancanti** (voci senza cifra, in rosso nel foglio Abbonamenti):
Hostinger VPS, Semrush, Similarweb, Higgsfield Marketing Studio, OpenAI GPT image 2.0,
HT Parental Control, Appblock, Stayfocusd.

**Stato aperto**: bot CFO da aggiungere al gruppo Dream Team; condivisione pubblica in
scrittura dei due fogli vecchi da revocare; onboarding Enable Banking sui tre conti da fare.
