# Agente Social e Watchlist Instagram
<!-- externalId: agente-social-e-watchlist-instagram -->

## user - 2026-08-20T18:40:00Z
I design prodotti stanotte dal Product Artist sono COMPLETAMENTE diversi dalla reference fornita, e vengono ancora usate le frasi del lessico avatar invece del testo della reference. Mi avevi detto di aver fixato questa cosa e invece persiste. Individua la causa e risolvi una volta per tutte.

## assistant - 2026-08-20T19:10:00Z
[Causa dimostrata coi file: la regola ERA gia' corretta dal 19/08 sia in TASK-NIGHTLY.md sia nella scheda-ruolo del Brain, e il VPS le aveva (verificato con git show <commit-notturno>:TASK-NIGHTLY.md). Lo stadio 1 l'ha ignorata: 0 job su 12 con l'apertura obbligatoria, 12 su 12 con 'Do not copy the reference' - ricopiata dai jobs.json delle notti 14-19/08 che stanno nella stessa repo che l'agente legge. LEZIONE: una regola scritta in prosa perde contro i dati della repo. Fix: engine/valida-jobs.mjs, cancello che BLOCCA fra stadio 1 e stadio 2, con campo obbligatorio reference_text (le parole trascritte APRENDO l'immagine), blacklist delle formule vecchie e controllo che nessuna frase extra venga stampata. tests/valida-jobs.test.mjs tiene il batch bocciato del 20/08 come test di regressione. state/history.json marcata come cronaca, non normativa.]

## user - 2026-08-20T19:30:00Z
Perche' 'meglio zero design'? Testa subito, non alle 2:00 di notte. E il mio avatar non comprerebbe MAI una maglietta 'THE WOMAN I'M BECOMING' - quello semmai e' un titolo di un video YouTube. Il lessico avatar viene usato a caso, con immagini (aquila, lupo, orso) che non c'entrano niente con la frase. Se fosse un vero artista avrebbe spirito critico e si autocorreggerebbe.

## assistant - 2026-08-20T20:10:00Z
[Ragione su entrambi i punti. Il lessico VoC del Brain e' la lingua con cui l'avatar CERCA e SCROLLA (il file stesso avverte 'diapason di tono, non da copiare verbatim'), non un catalogo di frasi da stampare. Creato CRITICA-BRIEF.md: secondo cancello, un claude -p SEPARATO a contesto pulito con 4 test (frase da prodotto e non da contenuto / il soggetto incarna la frase / il compratore paga davvero / tenuta sulla reference). engine/leggi-critica.mjs: un job senza verdetto NON passa. PROVA A FREDDO eseguita subito, non rimandata: 5 bocciati su 12 al primo giro, 1 su 12 al secondo; tutti i job con le parole della reference (BORN TO LEAD, it's all waiting there for you, ALWAYS LATE BUT WORTH THE WAIT), zero frasi dal lessico. Il test ha fatto emergere due difetti miei, corretti: 3 tentativi invece di 2, e consegna PARZIALE dei promossi invece di tutto-o-niente.]

## user - 2026-08-20T21:00:00Z
Non vedo le immagini. Voglio vedere i lavori generati ORA. E non devi sindacare se la reference e' bestseller o meno: se te la carico io, la usi.

## assistant - 2026-08-20T21:40:00Z
[Rimossa la regola che contestava le reference (era mia, aggiunta quel giorno, e bocciava i suoi stessi caricamenti). Precedenza reference caricate a mano sopra il catalogo store in raccogli-reference.mjs. Immagini generate pilotando il Chrome di Andrea su Gemini (skill nano-banana): leone BORN TO LEAD.]

## user - 2026-08-20T22:10:00Z
Fa cagare: la scritta 'Born to Lead' e' troppo piccola e la finestra dietro non c'entra una minchia. E ti avevo chiesto di ripartire dalle ALTRE reference, non dal BORN TO LEAD che ho gia' pubblicato.

## assistant - 2026-08-20T22:40:00Z
[Passato alle altre reference. Generati 'it's all waiting there for you' (tee navy) e 'ALWAYS LATE BUT WORTH THE WAIT' (tee gialla), con lettering enorme e fondo pulito.]

## user - 2026-08-20T23:10:00Z
Il font va bene ma le righe sono troppo attaccate, le lettere si accavallano. E le lune che c'entrano? Le stelle erano sensate. Hai anche cambiato la divisione della frase rispetto alla reference. Stai generando tu a mano o lo sta facendo l'agente col suo ruolo?

## assistant - 2026-08-20T23:40:00Z
[Ammesso: quei prompt li avevo scritti IO a mano, non l'agente - percio' gli errori non li imparava lui. Tre regole incise in TASK-NIGHTLY.md e CRITICA-BRIEF.md: (1) reference_text diventa UNA VOCE PER RIGA, perche' la divisione della frase e' parte del design che vende; (2) l'interlinea si DICHIARA con un valore ('almeno il 40% dell'altezza delle maiuscole'), non si spera; (3) gli ornamenti si cambiano di FORMA, mai di SIGNIFICATO (di lune ce n'e' una, di stelle tante). Piu': su un design tipografico il testo E' il soggetto e va enorme - OEOF non ha mai voluto dire 'rimpicciolisci la frase'.]

## user - 2026-08-21T00:30:00Z
Carica quei design nel batch di oggi. Poi costruiamo un'automazione che ogni notte all'01:00 faccia generare al mio agente dei post organici, che finiscano nella sezione BOZZE, con la possibilita' di caricare reference dalla UI come nella sezione Approva Design.

## assistant - 2026-08-21T02:00:00Z
[Design aggiunti a mano dentro batch.json: rigenerarlo con build-batch.mjs avrebbe cancellato i blocchi stampa/pubblicazioni gia' scritti sui design approvati. Creata repo Bilots00/dreambrothers-creative-director-AUTO con TASK-NIGHTLY-SOCIAL.md, CRITICA-POST.md, engine/valida-post.mjs, leggi-critica.mjs, pubblica-bozze.mjs, gemini-driver.mjs, scripts/run-nightly-social.sh. Installata sul VPS in ~/agents/creative-director, cron all'01:00. Web app: server/socialReferences.ts, procedure nel router social, blocco 'Materiale per la prossima notte' in SocialDrafts.tsx. Scelte di Andrea: IG 3 / Pinterest 2 / Facebook 1 (X e blog esclusi), reference = post altrui che funzionano (struttura si', parole MAI), carosello IKONICK ogni 50-100 post, bozze con testo + immagine Gemini. Profilo Chrome di lavoro separato per non collidere col Product Artist delle 02:00. Nota sui ruoli: per il Brain chi scrive i post e' il Social Media Manager, il Creative Director da' la forma estetica.]

## user - 2026-08-21T21:00:00Z
In modalita' automatico voglio che prenda i post da un profilo Instagram che gli indico io, non dal lessico. Non devo reinventarmi la ruota: si parte sempre da qualcosa che esiste gia'.

## assistant - 2026-08-21T22:30:00Z
[Tre modalita': caricate / profilo (@handle, aggiunto alla Watchlist) / auto (tutti i canali IG della Watchlist). Riusata la Watchlist esistente invece di costruire un secondo scraper: postDiRiferimento() legge caption, views e outlierScore. GET /api/social/reference-posts per l'agente, engine/raccogli-post.mjs come stadio 0. Anteprima in Bozze dei post da cui partira' la notte, cosi' si controlla prima. Se non c'e' nessuna reference l'agente si FERMA invece di inventare.]

## user - 2026-08-21T23:30:00Z
La Watchlist non si aggiorna da sola, devo farlo a mano aprendo Instagram con l'estensione Tampermonkey. Fallo fare al VPS.

## assistant - 2026-08-22T00:30:00Z
[Misurazioni vere sul VPS, non ipotesi: fetch di node -> 429 SEMPRE (impronta TLS di undici riconosciuta); curl anonimo -> il primo profilo passa poi 401 su tutti (0 riusciti su 12); browser LOGGATO -> l'unica via che regge, ed e' esattamente cio' che fa lo userscript. Creati engine/ig-browser.mjs (Chrome persistente, scrape identico allo userscript: web_profile_info -> id utente -> feed/user/<id>) e scripts/login-instagram.sh (Xvfb + noVNC, stessa procedura gia' collaudata per Gemini). Agganciato come stadio 0a del run notturno.]

## user - 2026-08-22T02:30:00Z
Manca la barra calendario, e va sotto le impostazioni non sopra. Il bot dice 4 bozze pronte ma in Bozze non vedo niente. E 'ssh vps' mi da 'Could not resolve hostname'.

## assistant - 2026-08-22T03:10:00Z
[Tre cause distinte. (1) draftsList andava in ERRORE 500: SELECT * con le immagini come data URI da ~1,4MB nella colonna assets; fix con colonne esplicite senza assets, social.draftAssets per bozza singola, e la card ORA mostra l'immagine (prima l'agente la generava e la pagina non la faceva vedere), piu' tetto 3MB lato agente. (2) Barra calendario spostata SOTTO il blocco Materiale, come in Approva Design. (3) 'ssh vps' falliva perche' era gia' DENTRO il VPS: l'alias sta solo nel ~/.ssh/config del PC.]

## user - 2026-08-22T09:10:00Z
Il tunnel noVNC mi da ERR_CONNECTION_REFUSED. E secondo me il metodo Tampermonkey e' fragile: se si cancellano i cookie devo rifare il login e la watchlist smette di aggiornarsi. Inoltre non voglio che Meta veda un accesso dalla Germania e mi restringa il profilo del brand. Sei sicuro che questi siano i metodi migliori a lungo termine?

## assistant - 2026-08-22T10:00:00Z
[Tunnel: bug vero - il LocalForward puntava a 'localhost', che sul VPS risolve prima su IPv6, ma websockify ascolta solo IPv4; corretto in 127.0.0.1 nel ~/.ssh/config (anche per la riga di Gemini). Ora basta 'ssh vps'. Sui cookie: ipotesi giusta, lo userscript ha due punti di rottura (gira solo con instagram.com aperto in una scheda, e muore in silenzio se la sessione salta). Sul brand: consigliato un account di servizio invece del brand. Trovato che nella web app esiste gia' fetchInstagramViaMeta (Graph API business_discovery) come via ufficiale.]

## user - 2026-08-26T10:30:00Z
Perche' la watchlist non e' stata aggiornata e le thumbnail non si vedono? Il Business Manager mi e' stato sottratto quindi le API Meta non le posso piu' usare. Trova una soluzione.

## assistant - 2026-08-26T11:00:00Z
[Diagnosi dai log: il login Instagram sul VPS non era MAI stato fatto (sessionid assente) E la sessione noVNC dimenticata aperta teneva il lock del profilo Chrome, quindi lo stadio 0a moriva ogni notte con 'profilo occupato' - segnalato solo come WARN nel log, quindi watchlist ferma 4 giorni senza che nessuno lo sapesse. Fix: run-nightly chiude d'ufficio la sessione di login prima del sync, e ogni fallimento manda un Telegram. REGOLA: un fallimento notturno non deve MAI essere solo un WARN nel log. Thumbnail: gli URL CDN di Instagram scadono e bloccano l'hotlink, percio' inlineThumbnails le scarica e le salva come data URI.]

## user - 2026-08-26T11:10:00Z
Ho fatto il login. Procedi ad aggiornare la watchlist di tutti i profili seguiti.

## assistant - 2026-08-26T12:00:00Z
[Sessione verificata viva come @dreambrothers.store, backup cookie scritto. Sync completo: 13 canali aggiornati con post e thumbnail, 9 falliti con HTTP 400. Poco dopo Instagram ha REVOCATO la sessione. Costruita l'architettura durevole perche' il login si faccia UNA volta: MASTER (solo login manuale) + LAVORO (copia usa-e-getta rigenerata a ogni run) + backup cookie in ~/.instagram-session.json + guardiano controlla-sessione.mjs con ripristino automatico. Trovato e corretto un falso positivo grave: sessioneAttiva() diceva VIVA su un profilo mai loggato perche' si accontentava del 200 (Instagram risponde 200 anche ai non loggati).]

## user - 2026-08-26T13:00:00Z
Chi ti ha detto di mettere quelle regole (6 canali, 6 ore)? QUELLI NON SONO I MIEI NUMERI. Io ti ho chiesto di aggiornare TUTTI i profili. E ikonick non mostra niente.

## assistant - 2026-08-26T14:00:00Z
[Ammesso: quel 6 veniva dallo userscript, che pero' avevo scritto IO in una sessione precedente - attribuirglielo come 'i suoi numeri' e' stato scorretto. Tetto RIMOSSO: tutti i canali ogni notte. Trovata la vera causa del 400 leggendo il CORPO della risposta invece del solo status: 'Asset asset://laser.provider/ig_business_category_subvertical has been deleted. You cannot use this schema' - un BUG DI INSTAGRAM sui profili business con categoria impostata, che colpisce anche da sloggati e anche su i.instagram.com. Aggiunto ripiego: id via ricerca interna o HTML della pagina, poi feed. LEZIONE: leggere sempre il corpo della risposta, non solo lo status.]

## user - 2026-08-26T14:30:00Z
Non aspettare stasera. TESTA SUBITO, non fare il procrastinatore che dice di aver risolto senza fare un giro di prova live.

## assistant - 2026-08-26T15:30:00Z
[Trovato il bug che bloccava tutto: il reinnesto dei cookie non funzionava perche' passavo dal file di Chrome, che durante la pausa IG non viene riscritto in modo affidabile. Fix: addCookies DIRETTAMENTE nel context di runtime - e NON rifare page.goto dopo, perche' quel goto riceve un redirect al login che cancella il cookie appena iniettato. TEST LIVE PASSATO: poeta_della_serra -> 1 aggiornati, 0 falliti, 12 post, con sessione reinnestata dal solo backup e SENZA login. Aggiunta la persistenza dell'user id permanente in platformChannelId (campo gia' in schema, mai popolato dall'ingest) cosi' i business saltano l'endpoint rotto la volta dopo. Ammesso: martellando l'IP con troppe sonde ho allungato io stesso la pausa di Instagram.]

## user - 2026-08-27T02:36:00Z
Ho attivato il toggle e non si e' sincronizzato niente. La watchlist di ikonick e' rimasta vuota. Individua la causa e risolvi.

## assistant - 2026-08-27T03:10:00Z
[CAUSA IMMEDIATA della notte a zero: la fonte era 'profilo -> ikonick' (impostata il 22/08) e ikonick e' l'account business rotto, quindi 0 post -> 0 reference -> l'agente si e' fermato, MENTRE in Watchlist c'erano decine di post di altri canali usabili. Fix su due fronti: raccogli-post.mjs e postDiRiferimento() ripiegano su TUTTA la watchlist se il profilo scelto non ha post. CAUSA DI FONDO: Instagram ha chiuso web_profile_info agli anonimi OVUNQUE (429 anche dall'IP residenziale del PC di Andrea, non solo dal VPS) e la sessione @dreambrothers.store del VPS e' sotto pausa prolungata. SCOPERTA DECISIVA: il Chrome di Andrea e' loggato come @dream.brothers_ (account vissuto) e risponde 200 su tutto. Usato quello per popolare la watchlist: 5 canali x 6 post ingestati (insultiluminosi, ascesamentale, ispirazione.ita, poeta_della_serra, noxplanation), con thumbnail convertite in data URI via canvas per aggirare il blocco CORS sul POST diretto. Watchlist ora: 47 post su 11 canali, 39 thumbnail permanenti. Confermato che ikonick da 400 ANCHE dal Chrome vissuto = bug Instagram, non nostro.]

## user - 2026-08-27T03:20:00Z
Esporta la sessione cosi' posso riprendere in una nuova da questo esatto punto, visto che abbiamo quasi raggiunto il limite della finestra di contesto.

## assistant - 2026-08-27T03:25:00Z
[Sessione esportata su GitHub (sessions/agente-social-e-watchlist-instagram.md) e nella tab Claude Sessions della web app.

PUNTO DI RIPRESA - cosa resta aperto:
1) La sessione IG del VPS (@dreambrothers.store) e' in pausa prolungata. Il reinnesto dal backup funziona (testato live), ma serve un IP freddo. Da valutare: spostare la sessione del VPS su @dream.brothers_ (vissuto, risponde 200 su tutto) invece dell'account di servizio nuovo, che Instagram tratta con molto piu' sospetto.
2) I 9 canali business (ikonick, independent.republic, scassacuori, backprintz.clothing, andy.okay, filmfactory__, albertocramarossa, werenotreallystrangers, reelsbyfogarty) entrano solo quando il loro id permanente viene risolto UNA volta e salvato in platformChannelId: il codice c'e', va validato a IP libero.
3) Interruttore notturno in Bozze: ON, orario 01:00. Il giro usa PAUSA 90s e TUTTI i canali (nessun tetto).
4) Gia' deployati: thumbnail data URI, ripiego 'profilo vuoto -> tutta la watchlist', persistenza platformChannelId, guardiano che distingue pausa da logout.
5) REGOLA IMPARATA: durante una pausa Instagram NON martellare - ogni sonda la allunga. Fermarsi e lasciare UN giro gentile e' piu' veloce di dieci test.]

## user - 2026-08-27T05:00:00Z
Analizza il riassunto dell'episodio Huberman Lab #39 'Controlling Your Dopamine' su recall.it e l'articolo che ti ho incollato. Voglio usare il metodo di Andrew Huberman e Carol Dweck per ottimizzare il rilascio di dopamina e premiare/motivare gli utenti dei social a seguire il mio profilo, con contenuti, post, video e caroselli che li facciano DESIDERARE di consumare fino alla fine (ultima slide, fine del video, prossimo episodio della serie in stile Netflix), cosi' da costruire community e social proof. In particolare: come rendo le ricompense intermittenti come un casino' senza cadere in schemi riconoscibili tipo 'ogni domenica'?

## assistant - 2026-08-27T05:45:00Z
[Analisi consegnata come artifact 'Progettare l'Attesa'. I 4 meccanismi che contano: (1) il picco scava la buca - dopo un rilascio la dopamina scende SOTTO la base in proporzione all'altezza del picco (anfetamine 10x = crollo peggiore, freddo 2,5x ma resta sopra la base per 3 ore), quindi un gancio enorme su un contenuto medio non e' neutro, e' dannoso: chi legge chiude il post peggio di come l'ha aperto e associa quella sensazione al profilo; (2) la dopamina sta nella caccia, non nella preda - cio' che tiene incollati e' la tensione irrisolta; (3) la ricompensa PRIMA toglie piacere al DURANTE - il colpo migliore in slide 1 fa leggere in calo tutte le altre; (4) la ricompensa DOPO svuota il DURANTE - esperimento delle stelline di Stanford: la stellina d'oro ha distrutto la motivazione intrinseca dei bambini a disegnare, quindi 'il vero segreto e' nell'ultima slide' rende le slide di mezzo un corridoio, e fuori dal contenuto giveaway e concorsi sono la stessa stellina.

L'INVERSIONE: Huberman insegna a difendersi dal casino', noi vogliamo costruirlo - ma applicare la ricetta alla lettera (massimo picco, massima frequenza) produce gente che guarda tanto per due settimane e poi non sopporta piu' il profilo. 2,5x che resta sopra la base per tre ore batte 10x che crolla.

SULLA DOMANDA DELLE RICOMPENSE INTERMITTENTI: l'errore e' randomizzare la PUBBLICAZIONE. Netflix esce di venerdi': e' l'EPISODIO a non essere prevedibile, non il giorno. Giorno, ora e cornice del format restano FISSI (devono trovarci, e la cornice e' cio' che rende riconoscibile una serie); variano l'intensita' del contenuto, la posizione del pagamento migliore e quanto la puntata chiude l'anello. E il sorteggio lo deve fare una MACCHINA, non una persona: chi cerca di essere casuale a mente produce schemi (alterna troppo, evita le ripetizioni, distribuisce troppo uniformemente) e in un mese il pubblico ha imparato il ritmo. Serve un tiro a rapporto variabile ~1 su 7, cosi' a volte escono due jackpot vicini e a volte quindici post normali di fila.

STRATO DWEKE: la mentalita' di crescita e' la capacita' di rilasciare dopamina DURANTE la fatica invece che dopo. Applicata ai contenuti: cose che chiedono tre secondi di sforzo cognitivo e li ripagano con uno scatto di comprensione. Non allena le persone ad associarci a uno stimolo, le allena ad associarci alla sensazione di capire qualcosa - molto piu' difficile da replicare per un concorrente.]

## user - 2026-08-27T06:00:00Z
Salva tutto nel company brain 'dreambrothers-brain' e portalo in produzione (tre di queste regole si possono scrivere direttamente nel mansionario del Social Media Manager notturno, e diventano vincoli che la critica verifica prima che io veda le bozze). Poi esporta la sessione.

## assistant - 2026-08-27T07:10:00Z
[BRAIN (commit 844b710, pushato): areas/marketing/social-media/dopamina-e-attesa.md, messo SOTTO viral-playbook come strato neuroscientifico (il playbook dice QUALI format funzionano, questo dice PERCHE'), con link aggiunto in _hub-social-media.md. Dentro: i 4 meccanismi, l'inversione 'non essere l'anfetamina, sii l'acqua fredda', l'architettura del carosello a 6 passi, la tabella delle leve fisse vs variabili, il sorteggio 1 su 7, le regole del format a puntate e lo strato Dweck.

PRODUZIONE (dreambrothers-creative-director-AUTO, commit e1ae85c, pushato e gia' su VPS):
- R1 (il gancio non promette piu' di quanto il contenuto paghi) e R2 (ogni slide chiude un micro-anello e ne apre uno) sono giudizi di merito: passo 3-bis di TASK-NIGHTLY-SOCIAL.md + test 5 e 6 di CRITICA-POST.md, che ora ha SETTE test invece di quattro.
- R3 NO: 'il pagamento migliore non sta sempre nello stesso punto' e' un confronto fra dati, e un confronto fra dati lo deve fare il codice - altrimenti si ripete la lezione del 20/08 sul Product Artist, dove il modello dichiarava la regola giusta e poi ricopiava la notte prima. Quindi in engine/valida-post.mjs: posizionePagamento obbligatorio, confrontato con state/history.json PER CANALE (stessa posizione dell'ultima volta = rifiutato), e tutto il batch nello stesso punto = rifiutato. Aggiunto anche il divieto sui premi esterni (giveaway, concorso, discount code): e' la stellina d'oro, porta chi segue il premio e non il brand.
- engine/sorteggio-jackpot.mjs: tiro a rapporto variabile 1 su 7 allo stadio 0b del run notturno, esito in state/contatore.json, letto dal mansionario al passo 3-ter. Non si ritira due volte nella stessa notte.
- Il passo 6 ora impone di scrivere posizionePagamento nello storico, altrimenti domani R3 non ha con cosa confrontarsi.

VERIFICA LIVE, non promesse: tests/valida-post-attesa.test.mjs (6/6 verdi sul PC e sul VPS) e i controlli fatti prima diventare ROSSI di proposito su un batch rotto - batch con tutti i post in ultima slide + discount code = RIFIUTATO con i due motivi giusti; stesso batch con posizioni variate = conforme. Sul VPS: git pull fatto, bash -n verde, sorteggio eseguito dal vivo, cron intatti.]

