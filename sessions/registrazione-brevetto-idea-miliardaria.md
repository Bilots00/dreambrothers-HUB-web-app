# Registrazione brevetto IDEA Miliardaria
<!-- externalId: registrazione-brevetto-idea-miliardaria -->

> ## ⚠️ ISTRUZIONE PER CHI RIPRENDE QUESTA SESSIONE
>
> Andrea ha chiuso questa sessione dicendo che **la vera idea miliardaria non è ancora
> stata raccontata**. Quello che è stato discusso qui (bloccare Reels/Shorts/Stati dentro
> le app) è solo la punta: lui sostiene di aver inventato qualcosa che **AppBlock,
> StayFocused, NoScroll, Opal e nessun altro ha mai fatto**, e che **si estende ben oltre
> l'app di blocco delle distrazioni** — ed è per questo che vuole brevettarla.
>
> **La PRIMA domanda della nuova sessione deve essere:**
>
> *"Qual è la vera idea miliardaria che nessuno ha mai inventato prima e di cui saresti il
> primo al mondo? Quella che va oltre l'app di blocco delle distrazioni."*
>
> Ascoltala **prima** di dare qualunque giudizio su brevettabilità o prior art. La
> valutazione fatta in questa sessione riguardava solo la funzione anti-Reels, non l'idea
> vera, che non era stata ancora esposta.

---

## Contesto di partenza

- App: **FocusLock** — `com.dreambrothers.focuslock`, in `C:\Users\utente\FocusLock-Mobile-Android`
- Versione lavorata: 0.9.28, versionCode 36, targetSdk 36
- Obiettivo iniziale della sessione: pubblicare un MVP sul Play Store il prima possibile

---

## user — 2026-09-10T01:15:00Z

Chiede se è possibile dare a FocusLock un vantaggio competitivo sui concorrenti, che bloccano
solo app/siti/parole chiave. In particolare:

1. bloccare **gli Stati dentro WhatsApp**, **i Reels dentro Instagram**, **gli Shorts dentro
   YouTube** — come fa l'app **NoScroll**, già sul Play Store (quindi è dimostrato fattibile);
2. far valere le **parole chiave anche dentro la barra di ricerca** di YouTube e Instagram.

## assistant — 2026-09-10T01:25:00Z

Analisi fatta leggendo il codice prima di rispondere.

**Keyword nelle barre di ricerca: già metà implementato.**
`res/xml/accessibility_service_config.xml` ha già `typeViewTextChanged`; YouTube è già in
`CONTENT_APPS` (`FocusLockService.java:186`) e ogni testo digitato passa da `blocksSearch()`.
Instagram non è nella lista, quindi a riga 418 (`if (!browser && !contentApp) return;`) i suoi
eventi vengono scartati: aggiungerlo è ~una riga, da verificare sul dispositivo.

**Reels / Shorts / Stati: fattibile ma è un lavoro diverso** — serve riconoscere *quale
schermata* è aperta, non leggere testo.
- WhatsApp Stati: facile e solido, `StatusPlaybackActivity` arriva in chiaro da `event.getClassName()`
- Instagram Reels / YouTube Shorts: una sola Activity, servono i view id del pager — fragili e offuscati
- serve un'azione nuova: `GLOBAL_ACTION_BACK` invece di `HOME` (l'utente resta nell'app)

**Due avvertenze:** il costo di manutenzione è ricorrente (gli id cambiano a ogni versione di
Instagram/YouTube); e questa funzione porta alla **parità** con NoScroll, non a un vantaggio —
il vantaggio vero è la combinazione con programmi, Modalità severa e condizioni Wi-Fi/posizione.

## user — 2026-09-10T01:40:00Z

Vuole pubblicare **subito** sul Play Store, un MVP, senza aspettare la perfezione. Autorizza a
pilotare il browser e a pagare il necessario.

## assistant — 2026-09-10T02:00:00Z

Ricognizione. Trovati sei blocchi reali (cause di rifiuto meccanico, non rifiniture):

1. URL privacy → **404**
2. ID AdMob = quelli **di test** di Google, `AD_TESTING = true`
3. paywall che mostra 29,99 € ma `buy()` risponde `not-configured` → **Broken Functionality**
4. `www/blocco.html` (seconda UI tecnica) dentro l'AAB
5. AAB vecchio (8 settembre) rispetto al codice
6. screenshot e grafica dello Store inesistenti

**Il muro vero:** l'account Play Console **non esiste**; la Console rimanda alla pagina di
creazione. Da lì partono orologi di Google non comprimibili: verifica identità 2-7 giorni,
**12 tester × 14 giorni**, richiesta produzione fino a 7 giorni, revisione 1-7 giorni.
Creare l'account, pagare i 25 $ e caricare il documento sono cose che deve fare Andrea.

Poste due domande. Risposte: **account personale subito**, **togliere il paywall**.

## assistant — 2026-09-10T02:40:00Z

Paywall rimosso (schermata s11 svuotata, entrambe le porte d'ingresso chiuse, `rebuildPaywall()`
neutralizzata, badge 💎 Premium tolti da due metodi della Modalità severa, `blocco.html`
eliminata). Trappola evitata: gli indici `go(12)`…`go(17)` sono cablati ovunque, quindi **s11 è
rimasta nell'array `order`** e sono state chiuse solo le entrate.

Errore trovato e corretto da solo: i `.bak` erano finiti **dentro l'AAB** (`index.html.bak`
conteneva ancora i prezzi) perché `cap sync` copia tutta `www/`. Spostati fuori e ricompilato.

## user — 2026-09-10T03:20:00Z

Chiede cosa succede se dopo i 14 giorni Google non approva: deve rifare l'app da zero con un
altro nome? Fornisce i dati legali (Andrea Bilotta, Via Prima Strada 19, 20045 Lainate MI,
info@dreambrothers.it). Chiede di creare lui l'account AdMob con ID veri.

## assistant — 2026-09-10T03:30:00Z

**Sul rifiuto:** si può ritentare, non si perde app né nome. Tre cose diverse — richiesta di
produzione respinta (ripresentabile), release bocciata (si corregge), **terminazione
dell'account** (quella sì definitiva, ma arriva per violazioni ripetute e ostinate).

**Su AdMob:** creare l'account no — richiede i suoi dati fiscali e di pagamento. Offerta la
guida clic per clic + la configurazione una volta che l'account esiste.

Pagine legali pubblicate su GitHub Pages (`Bilots00/dreambrothers-HUB-web-app`, cartella
`focuslock/`, `.nojekyll` in radice) → entrambi gli URL rispondono **200**.

Difetto trovato rileggendo il documento pubblicato: privacy e termini **promettevano ancora
abbonamenti, rinnovo automatico, rimborsi e carte regalo Premium** vendute su dream-brothers.com,
roba che nella v1 non esiste più. Era un difetto introdotto togliendo il paywall poche ore prima:
riscritte le sezioni, rimossa quella sulle carte regalo, corretti i link `/pages/...` rotti.

## user — 2026-09-11T20:58:00Z

Manda gli screenshot: **account AdMob approvato**. Dice di procedere con la pubblicazione.

## assistant — 2026-09-11T21:15:00Z

Configurato AdMob pilotando il browser:

- App registrata (Android, non ancora sullo store) → **App ID** `ca-app-pub-7654891718335397~1944676985`
- **Interstitial** `ca-app-pub-7654891718335397/2703582701` ← l'unico usato dall'app
- Banner creato ma inutilizzato (il banner era già stato tolto per scelta di Andrea)
- ID sostituiti in `strings.xml` e `ads.js`, `AD_TESTING = false`

**Passo che il codice stesso segnalava come obbligatorio (n. 5):** creato e **pubblicato il
messaggio GDPR/UMP** in console. Senza, `requestConsentInfo()` torna `isConsentFormAvailable:false`
e il modulo di consenso non appare mai. Italiano + inglese, "Nega il consenso" attivo su tutti i
paesi UE (AdMob avvisa che riduce il tasso di consenso, ma l'informativa pubblicata promette una
scelta vera). Collegato all'URL della privacy.

Verificato l'App ID **dentro l'AAB compilato**, non solo nel sorgente: se è sbagliato l'app va in
crash all'avvio. AAB finale 5,3 MB, firmato `CN=DreamBrothers`, zero ID di test residui.

Ricontrollata la Console: **l'account Play Console continua a non esistere**. AdMob e Play Console
sono due account diversi.

## user — 2026-09-11T21:19:00Z

È arrivato a una pagina che gli chiede un **numero D-U-N-S** e non sa cosa sia. Chiede aiuto.

## assistant — 2026-09-11T21:25:00Z

Aveva cliccato il pulsante sbagliato: era finito nel percorso **"Per un'organizzazione"**. Il
D-U-N-S è il codice che Dun & Bradstreet assegna alle aziende registrate e richiede giorni o
settimane. Nel percorso **"Per te"** non serve. Aperto il percorso corretto.

Scoperto che Andrea aveva già iniziato la registrazione personale ed era più avanti del previsto:
Identità, Nome sviluppatore e Profilo pagamenti già completati.

## user — 2026-09-11T21:40:00Z

Dice di aver fatto tutto e chiede di compilare la fase in cui si trova, perché non sa cosa mettere.

## assistant — 2026-09-11T21:55:00Z

Compilati tre step:

- **Informazioni personali** — testo esperienza di 990 caratteri (tenuto onesto e al ribasso:
  dichiara che è la prima app e che non c'è esperienza pregressa), "Altri Account Google" = **No**
  (risposta data da Andrea, non inventata), sito = `https://dream-brothers.com`
- **App** — 1 app, monetizzazione **Sì → Annunci**, categorie **Nessuna delle precedenti**
  (in particolare *non* "bambini o famiglie", che farebbe scattare la Families Policy)
- **Come ti contatta Google** — Andrea Bilotta, info@dreambrothers.it (già verificata), Italiano

Scoperto per strada che **`dreambrothers.com` non è suo**: rimanda a johnhumphrey.com. I domini
veri sono `dream-brothers.com` (col trattino) e `dreambrothers.it`.

Lasciati ad Andrea: il **numero di telefono** (dato personale non in possesso) e i **Termini**
(firma su un contratto). Avvisato che, avendo risposto Sì alla monetizzazione, **l'indirizzo di
casa diventerà pubblico** sulla scheda.

## user — 2026-09-16T00:00:00Z

Chiede di controllare nel browser se quello che è stato fatto è già stato approvato o è ancora in
revisione, perché **non vuole pubblicare adesso**: vuole prima registrare l'idea all'ufficio
brevetti, essendo un'idea da miliardi di dollari.

## assistant — 2026-09-16T00:10:00Z

Verificato in due modi indipendenti:

| Verifica | Risultato |
|---|---|
| Play Console | rimanda ancora alla creazione account → **mai completato** |
| `play.google.com/store/apps/details?id=com.dreambrothers.focuslock` | **404 Non trovato** |

**Niente pubblicato, niente in revisione, account sviluppatore inesistente.** Nessun orologio che
gira, nessuna coda, niente da ritirare.

Sui brevetti è stata data una valutazione **riferita alla funzione anti-Reels discussa
all'inizio**: in Europa il software "in quanto tale" è escluso dall'art. 52 CBE; e NoScroll —
citato da Andrea stesso nel primo messaggio — già fa quella cosa ed è pubblico, quindi è prior
art che azzera la novità. Suggeriti invece **marchio** (l'unica protezione realistica) e
**diritto d'autore sul codice** (già automatico).

## user — 2026-09-16T00:20:00Z

**Corregge:** la valutazione è sbagliata perché **la vera idea non è stata ancora raccontata**.
Ha inventato qualcosa che AppBlock, StayFocused, NoScroll, Opal e nessun altro ha mai fatto, che
**va ben oltre l'app e il programma PC di blocco delle distrazioni**, e ne parlerà nella prossima
sessione. Chiede di esportare questa sessione con questo nome e che la prossima si apra
chiedendogli qual è quell'idea.

---

## Stato al momento dell'export

**Pronto e fermo in attesa:**
- AAB firmato `app-release.aab` (5,3 MB) in `android/app/build/outputs/bundle/release/`
- AdMob configurato con ID reali + messaggio GDPR pubblicato
- Pagine legali online: `https://bilots00.github.io/dreambrothers-HUB-web-app/focuslock/privacy.html`
- Moduli "Contenuti dell'app" già scritti in `FocusLock-Mobile-Android/PLAY-STORE/`

**Mancante:**
- account Play Console: telefono + accettazione Termini (da fare ad Andrea)
- screenshot e grafica dello Store (2 screenshot + icona 512 + banner 1024×500)
- decisione di Andrea sul brevetto **prima** di pubblicare

**Da NON dimenticare:** prima di ogni `bundleRelease`, togliere i `.bak` da `www/` — `cap sync`
copia tutta la cartella e finiscono dentro l'AAB.
