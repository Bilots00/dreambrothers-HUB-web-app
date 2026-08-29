# App Mobile FocusLock
<!-- externalId: app-mobile-focuslock -->

> Sessione Claude Code (desktop Windows). Obiettivo: creare l'app mobile FocusLock
> collegata al software desktop FocusLock già esistente, replicando l'onboarding di
> AppBlock (leader di mercato, l'unica con ads attive su Meta Ads Library) ma con il
> branding DreamBrothers.

## user — 2026-08-29T09:05:00Z

Agisci come il Digital Product Developer più forte al mondo, esperto di design UI/UX
specializzato in app mobile da milioni di download sul Play Store.

`/best-skills`

Voglio che mi crei la MIA APP per smartphone collegata all'app FocusLock che mi hai
già sviluppato per PC desktop, così da aiutare i miei utenti a risolvere le seguenti
dipendenze:

* Dipendenza dai Social Network
* Dipendenza da sport gambling e giochi d'azzardo
* Dipendenza dai videogiochi (mobile e PC)
* Dipendenza dalla pornografia
* Doomscrolling nel feed di Google Search & Discovery
* Dipendenza dal Binge Watching (Netflix, YouTube, Prime Video, Disney+)
* Dipendenza dalla Musica (dopamina cheap in QUALSIASI momento morto) e dal rumore
  digitale in generale (WhatsApp, Facebook) → Digital Detox per ripristinare la
  baseline di dopamina

Prendi il controllo del mio PC, guarda dentro BlueStacks l'onboarding dell'app
AppBlock e REPLICA LO STESSO ONBOARDING E LA STESSA INTERFACCIA il più possibile.
AppBlock è l'app leader che vende in abbonamento da anni ed è l'UNICA con le ads
attive su Meta Ads Library: evidentemente c'è qualcosa che funziona, non possiamo
permetterci di reinventare niente da zero. Mantieni però i colori e il branding
coerenti con quelli del mio brand.

## assistant — 2026-08-29T09:06:00Z

[skill `/best-skills` invocata → poi `frontend-design` + `hooked-ux`]

**Controllo del PC (computer-use MCP) e analisi di AppBlock in BlueStacks.**

Ostacoli risolti durante l'analisi:
- BlueStacks partiva in orizzontale e con finestre sovrapposte (Gestione attività
  elevato non chiudibile). Risolto spostando/ridimensionando la finestra via
  PowerShell + Win32 `MoveWindow` (script helper `move-bs.ps1` nello scratchpad).
- ADB (`HD-Adb.exe`) si connetteva ma la shell restava `error: closed` anche dopo
  aver attivato il bridge nelle impostazioni → analisi proseguita interamente via UI.
- Display BlueStacks portato a **Verticale 720x1280** per leggere la UI mobile.

**Onboarding AppBlock v7.19.2 (IT) mappato schermata per schermata — 16 step:**

1. Welcome: logo animato + "Riprendi il controllo sul tempo trascorso davanti allo
   schermo" + CTA "Avanti!" + "Sei già iscritto?"
2. Auth: Google / Facebook / Apple / Email + **"Continua senza account"** in fondo
3. Quiz intro: "Adatteremo AppBlock alle tue esigenze" + chip "Policy sui dati" +
   opzione salta
4. Q1: slider ore/giorno al telefono (1 → 12+)
5. Permesso usage access: grafico a barre con "?" (curiosity gap) + "Concedi
   l'autorizzazione" / "Continua senza rapporto"
6. Transizione: "Esploriamo cosa succede quando riprendi il controllo"
7. Demo 1: mockup telefono pieno di app, "Immagina il momento in cui scegli di
   concentrarti"
8. Demo 2: icone si spengono tranne Instagram — "Decidi tu: Instagram può aspettare"
9. **Demo INTERATTIVA**: "premi senza pensarci" → l'utente tocca l'icona → appare
   "Bloccato da AppBlock" con contatore tentativi (2x oggi, 23x totale) ← il momento
   "aha" simulato PRIMA del paywall
10. Blocco personalizzato: "Vai ad abbracciare Emma e Liam"
11. Recap 5 benefici + micro-interazione **"trascina il logo per continuare"**
12. **PAYWALL**: 7 giorni gratis → 2,33 EUR/mese fatturazione annuale, 15M+ utenti,
    4.8 stelle, carosello recensioni, "Nessun pagamento dovuto ora", X per chiudere
13. Post-rifiuto: si prosegue comunque → "Creiamo il tuo primo blocco"
14. Metodo di blocco: 4 card (Ora / Limite di utilizzo / Numero di avvii / Posizione
    che è gated Premium)
15. Config orari: 12:00-14:00 default, toggle "tutto il giorno", giorni L-D,
    "Altri intervalli" gated **Premium**, preview "attivo per 2h"
16. Selezione app → schermata autorizzazioni (usage + notifiche, pulsanti "Abilita"
    separati) → recap "2h a settimana guadagnate, inizia tra 20m" → home

**Home AppBlock**: banner permessi mancanti, Blocco rapido 1-tocco, Timer & Pomodoro
gated Premium, sezione Programmi, sezione Modelli, banner "7 giorni Premium gratuiti",
bottom nav (Blocco / Utilizzo / Approfondimenti / Profilo).

**Consegna v0.1**: creato `C:\Users\utente\FocusLock-Mobile\index.html`, prototipo
interattivo di 18 schermate + `docs/analisi-onboarding-appblock.md` con la lettura
Hook Model del funnel. Testato schermata per schermata nel browser via server HTTP
locale (porta 8123); trovato e corretto un bug: l'overlay di blocco invisibile
intercettava i click (fix: `pointer-events:none` sullo stato nascosto).

⚠️ ERRORE COMMESSO in v0.1: usato il **verde #128274** preso da `blocked.html`
dell'app desktop, invece del brand kit DreamBrothers.

## user — 2026-08-29T11:40:00Z

Il colore del mio brand non ha nulla a che vedere con il verde. Io uso il **blu e il
rosso**, come da brand identity DreamBrothers. Non può esserci incoerenza.

Avreste dovuto usare i colori e i gradienti del mio brand anche per l'app FocusLock,
dato che a differenza di AppBlock io con l'abbonamento includerò accesso sia all'app
mobile che al software/programma Desktop.

E poi il problema è che quando si cambia tab (Blocco → Utilizzo → Progressi →
Profilo) non si sta switchando niente: appare solo il testo in overlay "statistiche
di utilizzo" senza switchare. Inoltre non mi pare tu abbia completato l'app con
Google OAuth o Facebook OAuth per permettere agli utenti di accedere con i loro
account senza doversi registrare e senza dover immettere la propria email. E non vedo
la **modalità severa** che permetteva di disattivare/bypassare i blocchi che aveva
AppBlock.

Risolvi queste cose e poi impacchettami l'app pronta per essere scaricata sul mio
telefono e sul Google Play Store come AppBlock, per poterla testare subito e fare un
confronto con AppBlock.

## assistant — 2026-08-29T12:15:00Z

Recuperato il brand kit vero dal Brain (`areas/design/brand-kit.md` via MCP
`brain_read`):

- Primary blue `#0075E3` · Contrast red `#E63946` · Navy `#001E44`
- Light blues `#F0FBFF` `#C8EFFD` `#3F9FF4`
- **Dream Gradient** (firma del brand): rosa tenue → lavanda → blu → ciano
- Font: Montserrat Extra Bold Italic (display) + Poppins (body)

**FocusLock v0.2 — riscritto `index.html` da zero. Le 5 correzioni:**

1. **Rebrand completo DreamBrothers**: blu #0075E3 primario, rosso #E63946 per stati
   attivi / badge PRO / CTA paywall / indicatore tab, Navy per superfici scure, Dream
   Gradient su hero + banner trial + card streak. Montserrat italic + Poppins.
2. **4 tab realmente funzionanti** (`switchTab()` + `.tabpage.on`, non più toast):
   - *Blocco*: trial band, chip Modalità Severa, Blocco rapido, Programmi, 6 categorie
     "Le tue battaglie", Modelli
   - *Utilizzo*: 2h47m tempo schermo, -38% vs 7gg, grafico settimanale (oggi in rosso),
     17 tentativi bloccati / 1h12m recuperate, classifica app con barre
   - *Progressi*: streak 5 giorni con weekdots, 9h40m recuperate, 6 traguardi
     (3 sbloccati / 3 grigi), card "La tua dopamina sta guarendo"
   - *Profilo*: account, card PRO mobile+desktop, Modalità Severa, impostazioni
3. **OAuth Google / Facebook / Apple / Email**: bottom sheet stile nativo (account
   chooser Google con logo SVG reale, "Continua come Andrea" per Facebook, Face ID +
   "Nascondi la mia email" per Apple, magic link per Email). Stato utente persistito
   in `localStorage`, riflesso nel Profilo, logout funzionante.
   NOTA: è un mock UI — in produzione va collegato Firebase Auth / Credential Manager
   con i client ID dei progetti developer Google e Meta.
4. **Modalità Severa a 3 livelli** (era la funzione mancante di AppBlock):
   - *Normale*: libertà totale, pausa/disattivazione sempre possibile
   - *Severa*: PIN + 10 minuti di attesa per disattivare (blocca le decisioni d'impulso)
   - *Estrema*: blocchi NON disattivabili e app non disinstallabile fino a fine
     programma, con warning rosso dedicato (pensata per gambling e porn)
   Stato persistito, chip di accesso rapido in home.
5. **Paywall col differenziatore**: banner "Un solo abbonamento: app mobile E
   programma Desktop inclusi" — cosa che AppBlock non ha. 7 giorni gratis →
   2,49 EUR/mese (29,99 EUR/anno), placeholder da validare.

**Packaging PWA**: creati `manifest.json` (standalone, portrait, theme #0075E3),
`sw.js` (service worker network-first con fallback offline), `icons/icon-192.png` e
`icons/icon-512.png` generati via System.Drawing (lucchetto bianco su gradiente blu
con pallino rosso).

**Verifiche fatte nel browser** (server locale porta 8123, screenshot per ogni step):
welcome rebrandizzata, sheet OAuth Google → login → avanzamento automatico al quiz,
switch delle 4 tab (titolo header + contenuto + indicatore rosso cambiano davvero),
Modalità Estrema selezionabile con warning. Trovato e corretto un bug CSS: le barre
del grafico settimanale non si estendevano (fix: `align-items:stretch` + `height:100%`
sulle colonne).

**Come installarla sul telefono**: PC e telefono sulla stessa Wi-Fi → Chrome su
`http://192.168.1.3:8123` → menu → "Aggiungi a schermata Home". Se non carica, serve
aprire il firewall (comando dato ad Andrea da eseguire lui come amministratore,
`netsh advfirewall firewall add rule ... localport=8123`).

**Play Store — chiarito**: non esiste pubblicazione "in un click". Serve account
Google Play Console (25 USD una tantum + verifica identità) e una build firmata.
Percorso concordato: (1) test PWA da telefono → (2) impacchettamento **Capacitor**
in APK installabile diretto → (3) AAB firmato + schede store + privacy policy, e per
i blocchi reali `UsageStatsManager` + `AccessibilityService` +
`NotificationListenerService` (le stesse API usate da AppBlock).

---

## STATO DEL LAVORO (per riprendere da un'altra chat)

**File prodotti**
| Path | Cosa |
|---|---|
| `C:\Users\utente\FocusLock-Mobile\index.html` | App completa v0.2, 18 schermate onboarding + home a 4 tab. Self-contained (no build step) |
| `C:\Users\utente\FocusLock-Mobile\manifest.json` | Manifest PWA |
| `C:\Users\utente\FocusLock-Mobile\sw.js` | Service worker |
| `C:\Users\utente\FocusLock-Mobile\icons\icon-192.png` / `icon-512.png` | Icone brand |
| `C:\Users\utente\FocusLock-Mobile\docs\analisi-onboarding-appblock.md` | Analisi del funnel AppBlock, tabella 16 schermate + lettura Hook Model |

**Avvio locale**: `python -m http.server 8123 -d C:/Users/utente/FocusLock-Mobile`
(già registrato come `focuslock-mobile` in `C:\Users\utente\.claude\launch.json`)

**Brand (non negoziabile)**: blu `#0075E3`, rosso `#E63946`, navy `#001E44`,
Dream Gradient, Montserrat Extra Bold Italic + Poppins. NIENTE verde.

**Le 7 dipendenze target** (categorie native del quiz e dei blocchi): Social network ·
Gambling/Betting · Videogiochi · Contenuti per adulti · Doomscrolling/Google Discover ·
Binge watching · Musica & rumore digitale (Digital Detox).

**Differenziatore vs AppBlock**: un solo abbonamento copre app mobile + programma
desktop (FocusLock Desktop vive in `C:\ProgramData\FocusLock`, regole in `rules.json`).

**COSA MANCA / PROSSIMI PASSI**
1. Impacchettamento **Capacitor** → APK installabile sul telefono di Andrea (step
   concordato subito dopo il test della PWA)
2. OAuth reale: Firebase Auth + client ID Google e Meta (ora è mock UI)
3. Motore di blocco Android nativo: `UsageStatsManager`, `AccessibilityService`,
   `NotificationListenerService`; per la Modalità Estrema serve Device Admin per
   impedire la disinstallazione
4. Sync col desktop: condividere `rules.json` via cloud (claim cross-device)
5. Play Console (25 USD, verifica identità) → AAB firmato, schede store, screenshot,
   privacy policy
6. Validare copy e prezzi del paywall (2,49 EUR/mese è placeholder)
