# FocusLock Desktop e APK Android
<!-- externalId: focuslock-desktop-e-apk-android -->

> Sessione Claude Code (desktop Windows). Due filoni: (1) completare **FocusLock Desktop**,
> il sostituto gratuito di HT Parental Control; (2) produrre l'**APK Android** dell'app mobile
> creata nella sessione [[app-mobile-focuslock]] e dotarla di un motore di blocco reale.
> `[contesto compattato]` — i turni iniziali sono riassunti.

---

## Parte 1 — FocusLock Desktop (Windows)

**Dove vive:** sorgenti in `E:\...\E-commerce\FOCUS - Productivity\FocusLock`
(spostata durante la sessione da `E-commerce\FocusLock`).
App installata in `C:\ProgramData\FocusLock\app\`, dati in `C:\ProgramData\FocusLock\`.
Avvio con **Win+R → `focus`** (launcher `focus.exe` in `%LOCALAPPDATA%\Microsoft\WindowsApps`).

### Bug risolti, con la causa vera

| Sintomo | Causa individuata | Fix |
|---|---|---|
| Win+R `focus` non funzionava | La PowerShell del tool **virtualizza il registro** (hive MSIX): le scritture `HKCU\App Paths` non arrivavano al Windows reale. `reg query` confermava il successo leggendo la vista virtualizzata | Launcher `focus.exe` in una cartella già nel PATH reale, niente registro |
| Redirect non redirigeva | `ValuePattern.SetValue` **ridipinge** la barra indirizzi ma Chromium non naviga; la verifica confrontava la barra con sé stessa → falsi "successo" | URL passato al browser **sulla riga di comando** |
| Blocco intermittente su Opera | **`sizeof(INPUT)` = 32 invece di 40** su x64: mancava `MOUSEINPUT` nella union → `SendInput` rifiutava OGNI tasto con `ERROR_INVALID_PARAMETER (87)`. Diagnosticato chiedendo a Windows quanti eventi accettava: `0/4` | Aggiunta `MOUSEINPUT` alla union |
| Opera: URL non letto | Opera espone **due** campi indirizzo: uno esterno **vuoto** e uno interno con l'URL. Il codice prendeva il primo e lo cacheva | Si scarta il candidato vuoto e si continua la ricerca |
| Regola oraria 22:45–12:00 ignorata | Con **più regole sullo stesso sito**, veniva interrogata solo la prima: bastava una con credito residuo per annullare tutte le altre | `MatchingDenyRules()` valuta **tutte**; basta che una blocchi |
| Parole chiave non prese nelle ricerche | La **query string** veniva scartata prima del confronto | Match su `Full` (host+path+query), con decodifica di `+` e `%20` |
| UI bloccata, bianca o nera | I 3 sorveglianti partivano **sul thread grafico**: COM legava gli oggetti UIA a quell'apartment, e ogni lettura successiva rientrava lì. Il thread che disegna faceva scansioni da 6000 nodi 4 volte al secondo | `Task.Run(...)` per tutti e tre. Misurato: 0 sonde lente su 14, attesa max 10 ms |
| RAM 415 MB a pannello chiuso | La finestra veniva solo **nascosta**: 6 processi WebView2 restavano residenti | `_web.Dispose()` alla chiusura → **80 MB** (‑335 MB) |

### Funzioni consegnate
- Blocco per **dominio / percorso / percorso esatto / parola contenuta / schema `*`**
- **Eccezioni** (allow) che battono i blocchi
- **Limiti orari**: fasce, giorni, **quota oraria + giornaliera** indipendenti, e **griglia settimanale 7×24** con clic e trascinamento (stile HT Screen Time)
- **Blocco programmi** (chiusura processo, con lista di protezione anti-autodistruzione)
- **Ricerca sicura forzata** via file `hosts` → `forcesafesearch.google.com` (40 domini Google + Bing + DuckDuckGo, IPv4+IPv6, risolti a runtime). Non disattivabile dal browser. Richiede UAC solo al momento della modifica
- **Reindirizzo per singola regola** (es. un video YouTube diverso per ogni blocco) + **suono MP3/WAV** alla chiusura scheda (winmm `mciSendString`)
- **Report** stile AppBlock: oggi/settimana, categorie Produttivo/Distrattivo/Neutrale, grafico 7 giorni, pastiglie cliccabili. Conta **solo** app in primo piano con input negli ultimi 60s
- **Chat con Jordan** nel Report: `claude -p` locale (nessun costo API) o endpoint VPS. Prompt via **stdin** (bug Windows già noto nel Brain)
- Palette brand dal Brain: blu `#0075E3`, rosso `#E63946`, navy `#001E44`

**95 test superati.** Diagnostica passo-passo di ogni blocco in `C:\ProgramData\FocusLock\diagnostics.log`.

---

## Parte 2 — App mobile Android

**Progetto:** `C:\Users\utente\FocusLock-Mobile-Android` (Capacitor 6, web app in `www/`)
**Sorgente UI originale:** `C:\Users\utente\FocusLock-Mobile\index.html`
**Toolchain installata:** JDK 21 Temurin, Android SDK in `C:\Android\sdk` (platform-tools,
android-34, build-tools 34.0.0). Licenze accettate scrivendo gli hash in `sdk\licenses\`.

**Build:** `gradlew.bat assembleDebug` → `android\app\build\outputs\apk\debug\app-debug.apk`
**Consegna:** copia sul Desktop + server locale `python -m http.server 8777 --bind 0.0.0.0 -d C:\FocusLock-Download` → il telefono scarica da `http://192.168.1.5:8777`

### Motore nativo scritto (Java)
- `FocusLockService.java` — AccessibilityService: blocca app in foreground e legge la barra
  indirizzi di 13 browser (con fallback euristico per browser sconosciuti)
- `Rules.java` — regole in SharedPreferences (fonte di verità), 25 termini adulti precaricati
- `BlockActivity.java` — schermata di blocco con contatore tentativi, back disabilitato
- `BlockedNotificationListener.java` — silenzia le notifiche delle app bloccate
- `FocusLockPlugin.java` — ponte Capacitor: `isServiceEnabled`, `openAccessibilitySettings`,
  `isUsageAccessGranted`, `openUsageAccessSettings`, `isNotificationAccessGranted`,
  `getScreenTimeToday`, `getInstalledApps`, `getRules`, `setRules`, `setEnabled`, `getStats`
- `Stats.java` — conteggio blocchi giorno/totale

### Analisi comparativa AppBlock (BlueStacks, v7.x IT)
Mappata schermata per schermata e replicata la **struttura**:
- **Bottom nav vera:** `Blocco | Modalità severa | Approfondimenti | Profilo`
  (la nostra aveva `Utilizzo | Progressi` — sbagliata)
- **Home:** banner "Il blocco non può funzionare" + Abilita → Blocco rapido (contatori,
  Start, Timer/Pomodoro) → **Programmi + "+ Inserisci"** → Modelli
- **Crea nuovo blocco:** 5 tipi (Ora, Limite di utilizzo, Numero di avvii, Posizione, Wi-Fi)
  \+ combinazione personalizzata. Noi: Ora, Limite, Permanente
- **Editor:** nome, Condizione (dropdown+card), Blocco (Lista di blocco/consentiti),
  righe App / Siti web con contatori, "Crea"
- **Lista di blocco:** 3 schede **App | Web | Parole chiave**
- Menu scheda programma: Edit / Duplicate / Pause / Delete
- **Le parole chiave di AppBlock agiscono solo sull'URL** — la nostra versione desktop
  legge anche il contenuto della pagina: differenziatore già in mano
- "Le tue battaglie" (6 categorie) era una nostra invenzione: rimossa

### Bug mobile risolti
- App che **si resettava all'onboarding** a ogni avvio: non salvava mai il completamento → `fl_onboarded`
- **Striscia bianca + taglio in alto:** la home scorreva due volte → `#s-home{overflow:hidden}`
- Pulsanti "Abilita" con **spunta finta**: ora aprono le impostazioni vere e rileggono lo stato dal sistema
- **Stima ore non verificata:** ora rivela il tempo schermo reale e lo confronta con la stima
- Tasto **indietro fisico** via `@capacitor/app`

---

## PROBLEMI APERTI (per la prossima sessione)

### 1. CRITICO — I permessi non si possono concedere (CAUSA INDIVIDUATA)

**Sintomo:** in Impostazioni → Accessibilità, `FocusLock — blocco distrazioni` è **grigia**,
sottotitolo **"Gestita tramite impostazioni con restrizioni"**, pallino arancione. Toccandola:
*"All'app è stato negato l'accesso"*. L'app compare **solo** nell'autorizzazione notifiche.

**Causa:** **Restricted Settings di Android 13+**. Un'app installata fuori dal Play Store
(sideload) è automaticamente esclusa dai permessi considerati pericolosi — Accessibilità e
Accesso ai dati di utilizzo — mentre l'accesso alle notifiche NON è ristretto, il che spiega
esattamente perché quello è l'unico che funziona. AppBlock non ha il problema perché viene dal
Play Store.

**Soluzione (nessuna modifica al codice):**
Impostazioni → App → FocusLock → menu **⋮** in alto a destra → **"Consenti impostazioni con
restrizioni"** → poi attivare il servizio in Accessibilità.

**Da fare nell'app:** aggiungere una schermata guidata che spieghi questi 4 passaggi quando
rileva che il servizio non è concedibile, invece di limitarsi ad aprire una pagina dove il
pulsante è grigio.

### 2. Discrepanze grafiche con AppBlock ancora aperte
- Il carattere della **freccia indietro** `←` è diverso dal loro
- La **Modalità severa** è ancora molto diversa: AppBlock ha un flusso introduttivo
  (Esplora → 4 schermate esplicative → scelta del metodo di sblocco), noi solo 3 card
- **Confronto non fatto affiancato:** va aperta una seconda istanza BlueStacks con la nostra
  app accanto ad AppBlock per il diff pixel per pixel

### 3. "Ho già un account" non salta l'onboarding
Selezionando l'accesso da `s1`, il flusso prosegue con le domande invece di andare alla home.

### 4. Altro
- Schede Progressi e grafico settimanale ancora dimostrativi (serve storico)
- OAuth è mock UI (serve Firebase Auth + client ID Google/Meta)
- Play Protect blocca l'installazione: "Altri dettagli" → "Installa comunque"
- Per la Modalità Estrema serve Device Admin (impedire disinstallazione)

---

## Riferimenti rapidi

| Cosa | Dove |
|---|---|
| Desktop sorgenti | `E:\...\E-commerce\FOCUS - Productivity\FocusLock` |
| Desktop installata | `C:\ProgramData\FocusLock\app\` |
| Regole desktop | `C:\ProgramData\FocusLock\rules.json` |
| Diagnostica blocchi | `C:\ProgramData\FocusLock\diagnostics.log` |
| Mobile progetto | `C:\Users\utente\FocusLock-Mobile-Android` |
| APK consegnato | `C:\Users\utente\Desktop\FocusLock-v0.6.apk` |
| Download per telefono | `http://192.168.1.5:8777` (server python su `C:\FocusLock-Download`) |
| Android SDK | `C:\Android\sdk` · JDK `C:\Program Files\Eclipse Adoptium\jdk-21*` |
| Package | `com.dreambrothers.focuslock` |

**Brand (non negoziabile):** blu `#0075E3`, rosso `#E63946`, navy `#001E44`, Dream Gradient,
Montserrat Extra Bold Italic + Poppins. Niente verde.

**Nota su copyright:** replicata struttura/flusso/funzioni (non protetti); testi e colori sono
già nostri, così la differenziazione successiva non richiede di rifare 40 schermate.
