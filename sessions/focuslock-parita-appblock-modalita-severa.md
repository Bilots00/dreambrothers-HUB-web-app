# FocusLock Parità AppBlock e Modalità Severa
<!-- externalId: focuslock-parita-appblock-modalita-severa -->

> Sessione Claude Code (desktop Windows), aperta con `/session-import` da
> [[focuslock-desktop-e-apk-android]]. Tre filoni: portare l'**app mobile** alla parità con
> AppBlock (motore + interfaccia), preparare il **dossier Play Store**, e aggiungere la
> **Modalità severa al FocusLock desktop** con timer fino a 90 giorni.
> `[contesto compattato]` — i turni intermedi sono condensati; gli output dei tool sono riassunti.

---

## Punto di partenza

Import della sessione precedente: nessun turno nuovo da mobile. Ripreso dai PROBLEMI APERTI.

Due bug chiusi subito, con causa certa:

- **L'app non compariva in «Accesso ai dati di utilizzo»** — non era un toggle rotto: quella
  lista si popola dal manifest e non dichiaravamo `PACKAGE_USAGE_STATS`. Aggiunto, verificato
  con `aapt dump permissions` sull'APK.
- **Il pulsante «Abilita» apriva l'elenco generale** dei servizi di accessibilità invece della
  nostra pagina. Passati al deep-link con il ComponentName. *(Correzione successiva: l'action
  `ACCESSIBILITY_DETAILS_SETTINGS` è `@hide` e protetta da permesso di firma — rimossa, tenuto
  solo il deep-link con `:settings:fragment_args_key`.)*

---

## Analisi AppBlock vs FocusLock

Workflow con 9 agenti: 51 screenshot trascritti, inventario dell'interfaccia, inventario del
motore nativo, ricerca sui vincoli Android e sulle policy Play.

Esito: **90 gap catalogati**, 10 bug con causa tecnica, in
`FocusLock-Mobile-Android/GAP-ANALYSIS-APPBLOCK.md`.

Le scoperte che hanno cambiato il piano:

| Scoperta | Perché conta |
|---|---|
| Mancava `flagReportViewIds` nella config del servizio | Senza, Android non espone i view id: **nessuna delle 12 ricerche della barra indirizzi ha mai funzionato**, girava sempre l'euristica |
| Il blocco in Chrome non compariva per le **restrizioni di background di Android 10+** | `startActivity` dal servizio fallisce in silenzio; `GLOBAL_ACTION_HOME` funziona → da qui «si chiude e basta» |
| `QUERY_ALL_PACKAGES` è un permesso ristretto | Rifiuto quasi certo su Play → sostituito con `<queries>` mirate |
| Recensioni e numeri inventati nel paywall | Falsa testimonianza: rifiuto su Play |

### Decisioni prese da Andrea

- **Modalità severa**: replica esatta di AppBlock, inclusa l'intercettazione di Impostazioni e
  App recenti — rischio di rimozione da Play illustrato e accettato consapevolmente.
- **Play Console**: non ancora aperto → account personale post-2023 → **12 tester per 14 giorni**.
- **AdMob**: nessun account → ID di test ufficiali con un unico punto da sostituire.
- **Trigger Posizione**: rimandato alla 1.1.

---

## Fase 0 — sblocco

- Manifest unico e completo: `PACKAGE_USAGE_STATS`, via `QUERY_ALL_PACKAGES`, `<queries>`,
  `allowBackup=false` con regole di esclusione, i nuovi receiver e service, meta-data AdMob.
- **Split di `index.html`** (1806 righe) in `css/app.css` + 11 moduli JS caricati come script
  classici. Verificato: 59/59 funzioni sopravvissute, `order` identico, smoke test pulito.

---

## Fase 1 — motore nativo

Sette agenti su file disgiunti. Il contratto di `Rules` scritto per primo, gli altri contro
quello.

- **Overlay `TYPE_ACCESSIBILITY_OVERLAY`** al posto della Activity → il blocco compare davvero
  sopra Chrome. Per gli URL si usa *indietro* invece di *home*, così il browser resta dov'era.
- **`typeViewTextChanged`** + lettura da `event.getText()` → funziona dentro l'app Google e
  YouTube, dove gli id sono offuscati.
- Tipi di corrispondenza delle keyword: dominio / ovunque nell'URL / **nel contenuto**.
- Modalità severa nativa con PIN PBKDF2, timer, attesa, caricabatterie.
- Tombstones per impedire il bypass disinstalla-e-reinstalla.

**La verifica incrociata ha trovato 9 incoerenze fra le corsie**, la peggiore: il servizio
scriveva il battito con la chiave `beatAt`, il bridge lo leggeva come `heartbeat` → l'app
avrebbe detto «concesso ma non in esecuzione» su ogni telefono.

Provato su BlueStacks: 54 test su 54, lint a zero errori, e l'overlay osservato davvero
(`blocking com.android.chrome -> example.com`, `BlockOverlay: shown for Chrome`).

---

## Fase 3 — interfaccia

Sei corsie parallele. Da 22 a **38 schermate**, tutte registrate a runtime dai moduli tramite
un registro nuovo (`registry.js`), così nessuno tocca `index.html`.

Modalità severa completa, tipo di corrispondenza, import/export CSV, quattro opzioni extra dei
programmi, nove modelli, Approfondimenti con dati veri, disclosure obbligatoria per Play.

**Il verificatore ha smascherato una dichiarazione falsa**: la corsia del paywall diceva di aver
rimosso le recensioni inventate — le aveva solo mascherate a runtime, nel sorgente c'erano
tutte. Rimosse davvero, grep finale a zero.

---

## Fase 4 — pubblicazione

- Keystore di release in `C:\Users\utente\FocusLock-Keystore\` *(password nel file
  `keystore.properties` accanto — [segreto omesso])*. **Se si perde, l'app pubblicata non si
  aggiorna mai più.**
- `minifyEnabled` + `shrinkResources` con le regole `-keep`. Verificato che R8 non rinomini
  `FocusLockService`, il cui `isEnabled()` confronta il nome della classe.
- **Target alzato ad API 36**: dal 31/08/2026 Play rifiuta il caricamento sotto quella soglia.
- Dossier `PLAY-STORE/`: procedura, dichiarazione accessibilità (+ traccia del video), data
  safety, scheda store, rischi e checklist.

### Nome dell'app — ricerca ASO

Ricerca sulle SERP italiane di Play. Risultati:

- «blocco app» in italiano è una **query sporca**: 5 dei primi 7 risultati sono app *AppLock*
  (password sulle app), intento completamente diverso.
- `dream` + `block` restituisce **14 giochi puzzle su 14**; `Dream Block` esiste già.
- Sul cluster «concentrazione» **nessun blocker compete** nelle prime 14 posizioni.

**Raccomandazione: `Focus Box: Blocca App e Siti`** (28 caratteri), pacchetto
`com.dreambrothers.focusbox`, nome sviluppatore `DreamBrothers` (campo indicizzato, gratis).
Comporta il sacrificio di «dream» nel titolo. **Decisione ancora aperta.**

---

## Correzioni successive, dal collaudo di Andrea

| Sintomo | Causa vera |
|---|---|
| Il blocco non scattava | Il banner diceva «Protezione attiva» **senza mai controllare se esistesse una regola**. Zero regole = niente da bloccare |
| Keyword ignorate nell'app Google | Una query digitata rispondeva solo alle keyword `CONTENT`. Aggiunto `blocksSearch`: una ricerca risponde a **tutti** i tipi |
| Icone delle app assenti | `getInstalledApps` codificava 150+ icone in base64 in un colpo solo |
| Selettore orario aperto all'avvio, vuoto | **Mancava la regola CSS che nasconde `#blkTime`.** Gli altri fogli l'avevano, quello no |
| «Apri le informazioni dell'app» → vicolo cieco | La guida diceva di toccare **⋮**, che su One UI recente **non esiste**: l'opzione è una voce nella pagina, e Android la nasconde finché l'app resta nelle recenti |

Altre lavorazioni: OEOF applicato alla scheda parole chiave (via il `+`, tipo di corrispondenza
solo mentre si digita, CSV spostato in fondo), tolte le tre card dei livelli dalla severa,
demo dell'onboarding col telefono da 298px invece di 238, ordine dell'onboarding corretto
(stima → rivelazione, non due domande in mezzo), Timer e Pomodoro rimossi.

**Scritta nel Brain la regola OEOF** (`areas/design/oeof-one-element-one-focus.md`): non c'era,
e la lezione 6 dice che una regola di contenuto assente va scritta con la fonte.

---

## FocusLock desktop — Modalità severa

Aggiunta al programma Windows, con timer fino a **90 giorni** (massimo 365, preset
1/7/14/30/60/**90**/180/365).

- Nuovo `FocusLock.Core/StrictMode.cs`: stato + logica pura.
- **Il divieto sta in `Persist`**, il punto unico da cui passa ogni modifica del pannello:
  una guardia che va ricordata in dodici handler è una guardia che verrà dimenticata.
- Mentre è attiva: regole non eliminabili, non disattivabili, non modificabili nella sostanza;
  livello non abbassabile; scadenza non anticipabile; metodo d'uscita non cambiabile; password
  non rimovibile. **Aggiungere blocchi resta sempre permesso.**
- Tre uscite: solo alla scadenza, dopo un'attesa, o con PIN.
- **23 test nuovi, 71 totali.** Gli 8 test sui rifiuti sono stati **visti fallire di proposito**
  disarmando la guardia (63/71) e poi rimessi verdi — lezione 11.

### Regola AI Mode, dai log

I log di FocusLock hanno risolto una domanda aperta: **AI Mode porta `udm=50` nell'URL**, le
ricerche normali no. La regola `PageContent` su «AI Mode» matchava invece *ogni* pagina di
risultati, perché quelle parole sono l'etichetta di una scheda: **9 blocchi, 6 dei quali erano
ricerche normalissime**. Regola corretta: `udm=50`, nell'indirizzo, contiene.

---

## Stato e cose aperte

**Consegnato:** FocusLock mobile **0.9.10**, desktop compilato con la severa (71 test verdi).

| Aperto | Nota |
|---|---|
| Nome e pacchetto dell'app | `Focus Box` raccomandato; **il pacchetto è irreversibile dopo la pubblicazione** |
| Backup delle regole | Su file (subito) o Google Drive (serve autenticazione) — da decidere |
| Acquisti Premium | Finti: serve Play Console |
| Slide della severa mobile | Più immagini, meno testo |
| Posizionamento «ladri di sogni» | Copy dell'onboarding da riscrivere sul tema DreamBrothers |
| 12 tester × 14 giorni | Da avviare **per primi**: il contatore parte quando ci sono tutti |

**Riferimenti:** gap analysis in `FocusLock-Mobile-Android/GAP-ANALYSIS-APPBLOCK.md`, dossier in
`PLAY-STORE/`, resoconti delle corsie in `docs-fase1/` e `docs-fase3/`, desktop in
`E:\…\FOCUS - Productivity\FocusLock`.
