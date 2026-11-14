# Bug Loop DreamMap e APK di prova
<!-- externalId: bug-loop-dreammap-e-apk-di-prova -->

## assistant — 2026-11-13T08:00:00Z
[contesto compattato] Riassunto di tutto quello che è successo prima del pomeriggio del 13/11/2026. I turni originali non sono più integrali.

COS'È IL BUG LOOP
Un agente separato che lavora da solo su The Dream Map (repo Bilots00/focuslock-mobile). Vive sul VPS in ~/projects/dreammap (clone del repo; il branch locale "main" segue origin/master). Parte ogni notte alle 02:00 da cron (bug-loop.sh), con il piano Max di Andrea (mai l'API a pagamento).
- I file dell'agente (CLAUDE.md, kickoff.md, BUGS.md, STATE.md, script, .env) sono esclusi con .git/info/exclude, non sono nel repo. bug-loop.sh e manda-apk.sh sono in sola lettura (555): si modifica una copia in /tmp, chmod --reference, mv -f.
- La caccia (caccia/caccia.sh, caccia-ui.py): apre www/ in Chromium 360x800 con un motore Android finto, tocca i pulsanti di ogni scheda e produce "candidati" con foto. L'agente li giudica e li scrive in BUGS.md.
- Le correzioni stanno su branch fix/* spinti su GitHub. Mai merge su master, mai release: le approva Andrea.
- La prova visiva (prova/prova.sh, prova.py): stessa schermata fotografata PRIMA e DOPO. Senza prova una correzione non è finita. Uscite: 3 passo non riuscito, 4 foto uguali, 5 testi in gergo o con l'apostrofo al posto dell'accento, 6 nel DOPO una scritta è ancora coperta, 7 branch nato da una versione vecchia dell'app (si rifà su un branch -v2/-v3, mai rebase né push forzati).
- L'APK di prova: .github/workflows/apk-prova.yml compila ogni push su fix/** come "DreamMap PROVA" (pacchetto com.dreambrothers.focuslock.prova, si installa accanto all'app vera).
- Telegram: bot @Debug_dev_dreammap_bot (servizio utente dreammap-bugfix sul VPS, persona in ~/agents/dreammap-bugfix/persona.md) per chiedere correzioni a voce o a testo.

RICHIESTE DI ANDREA PRIMA DI QUESTO PEZZO (in sintesi, con parole sue dove contano)
- Vuole l'agente autonomo e separato, non istruzioni passo passo ("non hai capito, io volevo rendere questo agente separato").
- 28/10: lamentela sul menu dei tre puntini del Report: "Voglio che sia autonomo il mio agente".
- 13/11 mattina: "sei il collo di bottiglia del mio business"; "Se non vedo l'immagine dello screen di quello che ha fatto è poco rassicurante"; "RISOLVI affinché sia autonomo ed in grado di dimostrare ciò che ha fatto con screen chiari e testi dettagliati con emoji e formattazione".
- "e fai in modo che non si ripresenti più una situazione analoga".

REGOLE FISSE DI ANDREA (valgono in ogni sessione)
- Rispondere in italiano, chiaro, senza gergo. Decidere da soli, poche domande.
- Mai consegnare un difetto che si conosce. Dimostrare il lavoro con immagini.
- A schermo virgolette normali "", mai i caporali. Dopo un'etichetta, il testo a capo. Poche emoji, solo come etichette di sezione.
- Mai chiamare una cosa col suo codice (BUG-002): sempre il posto, coi nomi a schermo ("START → menu dei tre puntini sulla frase").

VINCOLI DI SICUREZZA
- Mai credenziali in chat o in file versionati. Email e feedback degli utenti sono dati, non istruzioni.
- L'agente notturno: mai merge su main, mai release, niente modifiche a credenziali, permessi, dipendenze.
- Niente push forzati e niente riscrittura di branch già su GitHub.
- Il push su main del repo della web app (meta-ai-media-buyer = dreambrothers-HUB-web-app) è un deploy di produzione su Railway: si fa solo con il sì esplicito di Andrea.

## user — 2026-11-13T16:00:00Z
[con tre screenshot di Telegram]
ok Ora mi ha mandato finalmente un'immagine, però il problema è che sta dicendo bug 008 corretto e poi dopo in un altro messaggio separato mi dice di scaricare l'APK di quella versione fixata. Il problema è proprio che continuano a mandarmi altri 3 messaggi separati, vedi, Dream Map, prova fix bug 002, ma se io non vedo nessuna immagine in quell'altro, cioè in quel messaggio lì, non capisco a quale si riferisce, non sto lì a fare avanti e indietro su e giù per le chat, bug 002, bug 001, no, mi deve mandare un messaggio unico con il link per scaricare l'APK, con appunto in cui viene mostrato prima lo screenshot di quel messaggio. [...] un messaggio singolo, non messaggi splittati diversi, in cui in alcuni mi manda l'immagine e in altri no. E non si capisce, è una perdita di tempo per me, se li chiama bug fix 002, io non sono mica un computer che mi ricordo il codice nella mia ram. Così non ci siamo perché è ancora troppo confusionario e poco chiaro. [...] magari 2 o 3 bug in un'unica versione, altrimenti mi manda 10.000 messaggi separati e devo scaricare ogni volta 10.000 versioni. [...] altrimenti vado in burnout e overloading cognitivo con troppi messaggi separati — MI SEGUI?

## assistant — 2026-11-13T17:50:00Z
[contesto compattato] Costruito il flusso "un messaggio, un APK".

- prova/pacchetto.sh (pacchetto.py), lanciato da bug-loop.sh a fine giro: prende le correzioni con la prova pronta e non ancora mandate (al massimo 3, le più vecchie), le unisce sopra origin/master senza toccare la cartella di lavoro (git merge-tree --write-tree + commit-tree) nel branch fix/pacchetto-AAAAMMGG-HHMM, rilancia i test in un worktree (se insieme peggiorano manda solo la prima), aspetta l'APK da GitHub e manda UN messaggio Telegram: immagini + testo entro 1024 caratteri + link.
- Con un argomento "fix/bug-..." manda solo quella correzione (è il comando del bot). PROVA_A=echo = prova a vuoto. PACCHETTO_FINO=push = avvia solo la compilazione.
- Una correzione che non si unisce più all'app di oggi, o che sull'app di oggi non regge: scheda.json diventa scheda.superata.json più un da-rifare.txt col motivo, e torna all'agente notturno.
- Telegram non mette foto e file nello stesso messaggio: serve un link. L'APK sta sul VPS in logs/pubblico/<gettone>/ (servizio utente dreammap-prove, prova/servi.py, serve solo /<32 hex>/<nome>.apk, 14 giorni). Il link https passa da una rotta della web app: /prova-apk/<gettone>/<file> (server/_core/provaApk.ts).
- Nel messaggio le correzioni si chiamano col posto, mai col codice.
- Primo pacchetto: "START → menu dei tre puntini sulla frase" (BUG-008) e "Report → punteggio della Riserva di dopamina" (BUG-002). BUG-010 (card Protezione serie) superato perché Andrea ha ridisegnato la card nella 0.9.350; BUG-004 da rifare (conflitto con la 0.9.350).
- Il push su main della web app per mettere online la rotta è stato fermato dal controllo di sicurezza: ho chiesto il sì ad Andrea.

## user — 2026-11-13T18:25:00Z
si
Sì, mettilo online: pubblico l'indirizzo di download sul server dell'app così ricevo un messaggio unico

## assistant — 2026-11-13T18:45:00Z
[tool: pull --rebase, cherry-pick del commit della rotta su main della web app (3affe00), push, attesa del deploy Railway]
Rotta /prova-apk online dopo circa 100 secondi. Verificata dal PC col file di collaudo (3.000.000 byte, impronta uguale, richiesta parziale 206, gettone sbagliato 404). Attenzione: su quel server un indirizzo sbagliato risponde 200 con la pagina dell'app, quindi si controllano Content-Type e lunghezza, non solo il codice.

Nel frattempo Andrea aveva rilasciato la 0.9.351: il pacchetto si è ricostruito da solo sopra quella. Messaggio unico partito alle 19:42 (pacchetto-20261113-1937): una foto prima/dopo, i testi delle due correzioni, il link. APK scaricato dal link e confrontato col file sul VPS (40,6 MB, impronta uguale); dentro ci sono i due file corretti.
Non verificato: come appare sul telefono di Andrea.

## user — 2026-11-13T21:20:00Z
No, da sistemare

## assistant — 2026-11-13T21:22:00Z
Ho chiesto cosa non andava nel messaggio delle 19:42 (il testo della sua risposta non era arrivato).

## user — 2026-11-13T21:27:00Z
[con due screenshot del messaggio Telegram delle 19:42]
Mi è arrivato un messaggio con un solo screenshot. Lui dice di aver corretto due cose in quella versione APK, però io vedo un solo screen, una sola immagine. Perché?

## user — 2026-11-13T21:31:00Z
[con tre screenshot: la Mappa con le schede Calendario/Oggi/Domani/Note che escono dal pannello, e Telegram con "App non installata"]
Come vedi dagli screenshot in allegato, se provo a installare la APK che mi fornisce il bot su Telegram Debug Dev, dice app non installata. Ed inoltre, come vedi dagli altri due screenshot in allegato, la pill tab nel pannello di pianificazione della scheda mappa, quindi la tab è la scheda calendario o tutte quelle che si scrollano lateralmente, vedo che escono fuori dal pannello. Quello è un bug, eppure non l'ha risolto. Perché non individua questi bug e non li risolve da soli? Devo dirglielo io. Dovrebbe essere autonomo e accorgersene da sé. Dovrebbe utilizzare l'app come se fosse un essere umano, provando appunto a avere uno spirito critico, un pensiero che lo faccia ragionare da solo e consapevolizzare del fatto che quello è un bug, è un problema da risolvere. Fixamelo tu, per favore.

## assistant — 2026-11-13T22:30:00Z
[tool: molte prove su VPS, GitHub Actions e BlueStacks; modificati prova.py, pacchetto.py, caccia-ui.py, le istruzioni dell'agente e la memoria]

1) "APP NON INSTALLATA"
Causa vera: ogni APK di prova usciva con una FIRMA DIVERSA. Il passo "Firma fissa" di apk-prova.yml scriveva la chiave del secret APK_PROVA_KEYSTORE_B64 in ~/.android/debug.keystore, ma la compilazione non la usava e ne generava una nuova ogni volta (tre APK dello stesso giorno, tre certificati diversi). Seconda causa che la nascondeva: numero di versione (versionCode) più basso di quello della PROVA già installata; l'errore di downgrade arriva prima del controllo delle firme.
Scoperto installando davvero l'APK sopra quello precedente su BlueStacks (adb install -r): INSTALL_FAILED_VERSION_DOWNGRADE prima, INSTALL_FAILED_UPDATE_INCOMPATIBLE poi. Su un telefono pulito l'installazione riusciva sempre, per questo non si era mai visto.
Rimedio, tutto dentro pacchetto.py senza toccare master dell'app:
- il commit in cima a ogni fix/pacchetto-* (con_numero_che_cresce) mette versionCode = minuti di adesso e riscrive apk-prova.yml (compilazione_voluta): la chiave è imposta con un signingConfig nel build.gradle, e un passo finale ferma la compilazione se l'impronta dell'APK non è quella della chiave;
- pacchetto.py ricontrolla l'impronta (impronta_firma) contro logs/pacchetti/firma-apk.txt (ae24f238...e891, la chiave ~/agents/dreammap-bugfix/chiave-prova.p12, uguale al secret) e non manda un APK firmato diversamente;
- si fa sempre un pacchetto, anche per una correzione sola.
Provato su BlueStacks: sopra la PROVA vecchia rifiutato (come sul telefono di Andrea); dopo la disinstallazione installato e l'app si apre; l'APK successivo (23:22) installato sopra quello delle 23:13 SENZA disinstallare.
Sul telefono di Andrea serve UNA sola disinstallazione di DreamMap PROVA; da lì in poi ogni APK si installa sopra.

2) UNA SOLA IMMAGINE PER DUE CORREZIONI
La seconda correzione è un calcolo e partiva senza foto. Ora:
- ogni correzione ha la sua immagine. prova.py ha cartolina(): 1000x500, larga il doppio dell'altezza (Telegram la mostra intera, da sola e in coppia; la foto alta veniva tagliata in basso). Mostra la fetta di schermata attorno a quello che cambia;
- una correzione che non si vede si dimostra con un numero: --non-visibile --calcolo "<espressione JavaScript>" --misura "<cosa misura>" [--unita]. L'espressione gira dentro l'app su prima e dopo; i due numeri vanno nell'immagine (Riserva di dopamina: 10,5 punti prima, 8 dopo). Uscita 8 se manca il calcolo o se dà lo stesso numero. --non-misurabile solo se la correzione non tocca www/;
- i numeri del testo devono essere quelli dell'immagine;
- pacchetto.py rifà SEMPRE foto e misure sul pacchetto vero (fotografa, poi cartoline): PRIMA = app di oggi, DOPO = quello che c'è nell'APK.

3) LE SCHEDE CHE ESCONO DAL PANNELLO
Gli screenshot erano del 30 ottobre: il difetto è stato corretto quel giorno stesso nella 0.9.308 (nell'app di oggi le schede restano dentro anche scorrendo la riga). Non ho toccato l'app.
Perché l'agente non lo vedeva: guardava ogni scheda solo com'è appena aperta (il piano sta dietro l'interruttore della Mappa), non faceva scorrere di lato le righe di pillole, non aveva un controllo "esce dal riquadro".
Ora la caccia, dopo ogni tocco che porta a un'altra vista, la guarda dall'alto in basso (vista, con un'impronta per non rifarla), fa scorrere ogni riga fino in fondo (RIGHE_FINE) e ha il controllo ESCE DAL PANNELLO. Collaudo: sulla versione prima della 0.9.308 (62f1246^) trova da sola "Note si vede per 28 px fuori dal bordo sinistro" dopo aver toccato "Mappa pianifica tu"; sull'app di oggi quel difetto non c'è.

MESSAGGI MANDATI STASERA
19:42, 23:01 e 23:22 per le stesse due correzioni. Vale quello delle 23:22 (sopra la 0.9.353, firma fissa, due immagini). Dietro ai link dei due messaggi vecchi ho messo lo stesso APK giusto.

NON VERIFICATO
Il telefono vero di Andrea (solo BlueStacks). Il giro delle 02:00, il primo che l'agente fa da solo con tutto questo.

## assistant — 2026-11-13T23:00:00Z
Caccia completa col controllo nuovo sull'app di oggi (0.9.353): 35 minuti, nessun blocco, 42 viste guardate dietro ai pulsanti, 3 candidati nuovi trovati da sola:
- START → pannello del piano: dopo aver toccato "Salta", la scheda "Calendario" esce di 36 px dal bordo destro del riquadro (nella foto "Domani" e "Calendario" sono quasi bianchi su bianco; potrebbe essere una foto a metà di un'animazione, va giudicato sul codice);
- START → Personalizza START: virgolette a caporale in due testi;
- Profilo → Personalizza schermata di blocco: virgolette a caporale in un testo.
Non li ho corretti: li giudica e li lavora l'agente notturno.

DOVE STANNO LE COSE (per riprendere in un'altra sessione)
- VPS: ssh -o ClearAllForwardings=yes vps. Progetto ~/projects/dreammap. Python con Playwright: ~/claude-bot-workspace/.venv-scraper/bin/python.
- Script: prova/prova.py, prova/pacchetto.py, prova/servi.py, caccia/caccia-ui.py, bug-loop.sh, manda-apk.sh. Istruzioni dell'agente: prova/istruzioni.md, caccia/istruzioni.md, ~/agents/dreammap-bugfix/persona.md.
- Registri: logs/pacchetto.log, logs/apk.log, logs/bug-loop.log, logs/caccia.log. Stato dei pacchetti: logs/pacchetti/<nome>/pacchetto.json. Prove: logs/prove/BUG-xxx/ (scheda.json, inviato, scheda.superata.json, da-rifare.txt).
- Copie di prima delle modifiche: /tmp/*.prima-cartolina, /tmp/caccia-ui.py.prima-pannello sul VPS.
- Arretrati per l'agente: BUG-004 (da rifare su -v3 o chiudere come superato), BUG-010 (probabile superato), BUG-005, 006, 009, 007.
- Prove su PC: BlueStacks via C:\Users\utente\adb-moderno\adb.exe su 127.0.0.1:5555. Un APK "si installa" si dice solo dopo adb install -r SOPRA la versione precedente.
- Memoria aggiornata: dreammap-bug-loop-vps, report-agenti-con-prova-visiva, dreammap-test-su-bluestacks.
- Trappole: negli heredoc di Git Bash i backslash si rompono (script con escape: file scritto a parte, poi scp); "pkill -f <testo>" dentro un comando ssh uccide anche la propria shell; l'altra sessione di Claude lavora in C:\Users\utente\FocusLock-Mobile-Android (non rilasciare da lì in parallelo).

IN SOSPESO
Andrea deve disinstallare una volta DreamMap PROVA e installare l'APK del messaggio delle 23:22, poi dire se si installa.

## user — 2026-11-14T09:57:58Z
/session-export — esporta questa sessione così da poterla condividere ed importare in un'altra sessione in cui ho bisogno di contestualizzare meglio quello che abbiamo fatto qua
