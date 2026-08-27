# Lancio Campagne Google e TikTok
<!-- externalId: lancio-campagne-google-e-tiktok -->

> Sessione lunga: i turni sono ricostruiti in forma condensata dal contesto vivo.
> Gli output dei tool sono riassunti tra parentesi quadre.

## user - 2026-08-21T13:10:00Z
Voglio parlare col mio agente Media Buyer per sfruttare il credito bonus Google Ads (400 EUR). Non voglio bruciare budget su prodotti non ottimizzati: posso concentrare la spesa solo su listing che gia vendono, tipo la felpa Jesus is the light Rhinestone Hoodie?

## assistant - 2026-08-21T13:25:00Z
Si, si fa con Standard Shopping suddividendo per Item ID ed escludendo tutto il resto. ATTENZIONE: l app Google & YouTube di Shopify crea PMax di default, che pesca da tutto il catalogo. E la trappola da evitare.

## user - 2026-08-21T13:40:00Z
Il Media Buyer NON vive nella web app: e un ruolo mappato nel company Brain, paid a 360 gradi su tutte le piattaforme. E i dati prodotti Shopify sono sfalsati: sono auto-ordini di test. L unico bestseller vero e la felpa Gesu.

## assistant - 2026-08-21T14:05:00Z
[Salvato in memoria: media-buyer-ruolo-nel-brain, shopify-ordini-test-falsano-i-bestseller, google-ads-account-e-promo] Confermato dai dati Shopify: ultimi 30gg solo felpa Gesu (3 ordini, 206 EUR) piu Wolf of Wall Street (1).

## user - 2026-08-21T14:20:00Z
La promo e ANCORA ATTIVA e sta su dreambrothers.hub@gmail.com, non su bbrothersdreams.etsy. Avresti dovuto salvartelo.

## assistant - 2026-08-21T14:50:00Z
[Browser] Trovato. Account Google Ads operativo = DreamBrothers 835-843-8168 sotto dreambrothers.hub@gmail.com. Promo VIVA: codice 7NQ6F-QG7LF-C4CK, 400 EUR di credito a fronte di 400 EUR di spesa, riscattata 27 lug 2026, REQUISITI ENTRO IL 25 SETTEMBRE 2026, speso 0 EUR. Metodo pagamento Amex 3006 attivo. VICOLI CIECHI da non riusare: bbrothersdreams.etsy porta a 123-165-5394 (promo SCADUTA 10 mar 2026); andrea.bilotta00 porta a 802-240-5144 (CANCELLATO dal 30/01/2024, saldo aperto 10,20 EUR, probabile causa del fallimento del Google Ads MCP).

## assistant - 2026-08-21T15:10:00Z
[Browser] Sistemato il conversion tracking: era completamente assente. Root cause = canale Google Ads INACTIVE nell app Google & YouTube di Shopify. Merchant Center 5697377647 invece attivo (63k varianti, 59,6k approvate). Andrea ha collegato l account e confermato il mapping Checkout completed verso azione primaria piu enhanced conversions ON.

## assistant - 2026-08-21T15:40:00Z
[Google Ads] CAMPAGNA CREATA: US | Shopping Standard | Jesus Hoodie | ago26, ID 24156452811. Budget 13 EUR/gg, Massimizza clic con tetto CPC 0,60 EUR, solo USA con opzione Presenza, AI Max DISATTIVATO, gruppo AG | Jesus Rhinestone Hoodie filtrato per Item ID sui soli 5 SKU della felpa. Campaign #1 (PMax 15 EUR/gg) lasciata IN PAUSA. TRAPPOLA UI: il Riepilogo pre-pubblicazione mostra Localita Tutti i paesi anche quando e impostato correttamente. Verificare SEMPRE in Impostazioni campagna DOPO la pubblicazione.

## user - 2026-08-21T16:00:00Z
Risolvi i 4 errori del canale Google & YouTube per Leo Zodiac Lion Tee.

## assistant - 2026-08-21T16:30:00Z
3 su 4 risolti. Age group e gender: scritti i metafield mm-google-shopping (age_group=adult, gender=unisex, condition=new). Lo store NON ha le definizioni shopify.target-gender ne age-group, quindi quella e l unica strada. Spedizioni BG/HR/MT: creata policy in Merchant Center (All products, 11-17gg, Free, EUR). Le shipping policy MC sono SEPARATE da Shopify. Corea: NON risolvibile, serve un numero di registrazione impresa coreano; rimossa la Corea del Sud dal mercato International. [Salvato: merchant-center-spedizioni-e-attributi]

## user - 2026-08-21T17:00:00Z
Automatizza i metafield e la pubblicazione su tutti i canali per ogni nuovo prodotto, tramite l agente SEO.

## assistant - 2026-08-21T17:30:00Z
[VMF-Agent-Local/agent/core.mjs] Aggiunti task 7 e 8: writeGoogleShoppingAttrs (solo apparel, deduce age_group e gender da titolo e tag) e publishToAllChannels (TUTTI i prodotti). Provati in produzione. Backup in core.mjs.pre-gshop.bak. BLOCCANTE: il listener non era in ascolto sulla porta 8788, parte da vmf-listener.vbs all avvio automatico. Finche non gira, i task non scattano.

## user - 2026-08-21T18:00:00Z
Crea la prima campagna di test su TikTok Ads per la Focus Box (Timed Phone Locking Box).

## assistant - 2026-08-21T21:00:00Z
[TikTok] Account operativo DreamBrothers Store 7537704704961167378 (pixel Shopify 7668256569129320466 attivo). Tre blocchi trovati: saldo 0 (poi caricati 100 EUR), zero identita con can_use_custom_identity=false, zero video. ECONOMIA CORRETTA: unitCost Shopify (4,12 EUR) contiene SOLO il prodotto. Costo reale Zendrop = 15,10 USD verso USA e 10,96 USD verso UK. Il Regno Unito rende 4 EUR in piu a vendita degli USA. VINCOLO STRUTTURALE: account registrato in Italia NON puo targetizzare US/CA/AU. Risposta ufficiale del supporto: servono managed-account eligibility oppure un ad account registrato in un paese supportato. Non e un ticket da riaprire.

## assistant - 2026-08-21T22:50:00Z
[TikTok] CREATE: campagna UK | TikTok | Purchase | Focus Box | ago26 ID 1874144334715185 piu gruppo AG | UK 18-44 | Broad | Purchase ID 1874144557275601. 20 EUR/gg, Complete Payment, Maximum Delivery, solo placement TikTok, UK, 18-44, broad, IN PAUSA. Identita: creato account TikTok DreamBrothers 7676564807169490961 e ASSEGNATO all ad account (ora 1 asset). BLOCCO RESIDUO: i 4 video NON caricabili da automazione, TikTok crea l input file solo al click e apre la finestra di sistema. Deve caricarli Andrea da Creative Library. Creativi scelti uno per angolo: Andwer Call demonstration, BEST Honest & Human Script for UGC, ADHD Angle (TRY This), USA - American GIRL Avatar. SCARTATO: TikTok Students AUDIENCE perche 360x640, sotto il minimo.

## user - 2026-08-22T09:50:00Z
Analizza la campagna Google partita stanotte. Non vedo l importo speso e non so se 1,64% di CTR sia buono.

## assistant - 2026-08-22T10:20:00Z
Costo E la spesa. CTR 1,64% su Shopping e il DOPPIO della media (0,8-1%), il benchmark 3-6% e della Rete di Ricerca non di Shopping. SPESA REALE: 16,64 EUR ad agosto (13,17 il 21/8 in 7 ore quindi budget saturato, 3,47 il 22/8 alle 10). Il 383,71 EUR spesi dal credito e una traduzione SBAGLIATA di Google: e quanto MANCA da spendere. Crediti concessi = nessuno. PROBLEMA VERO, i termini di ricerca: aerial photo of manhattan (2 clic), jesus hoodie (2), disneyland pictures (1), phone lock box (1 clic e 30 impr). Solo 0,53 EUR su 3,47 su intento reale. INSIGHT DECISIVO: quelle query NON sono spazzatura, sono query da WALL ART e lui ha il NYC Sunset Skyline Poster. Google trova le persone giuste e mostra il prodotto sbagliato. Quindi PRIMA aggiungere i prodotti, POI le negative: mettere le negative adesso taglierebbe l 85% della spesa e farebbe perdere il bonus da 400 EUR, che comunque rientra come credito.

## assistant - 2026-08-22T10:35:00Z
[contesto quasi saturo, export della sessione]

---

## STATO AL MOMENTO DELL EXPORT

### Google Ads - account DreamBrothers 835-843-8168 (dreambrothers.hub@gmail.com)
- Campagna `US | Shopping Standard | Jesus Hoodie | ago26` **ID 24156452811** - ATTIVA, 13 EUR/gg
- Promo `7NQ6F-QG7LF-C4CK`: 400 EUR a fronte di 400 EUR **entro il 25 set 2026**. Spesi **16,64 EUR**. Crediti concessi: nessuno.
- Proiezione: a 13 EUR/gg la soglia si centra intorno al **21 settembre**. A 11 EUR/gg si sfora.
- Merchant Center **5697377647**

### TikTok Ads - account DreamBrothers Store 7537704704961167378
- Campagna `UK | TikTok | Purchase | Focus Box | ago26` **ID 1874144334715185** - IN PAUSA
- Gruppo `AG | UK 18-44 | Broad | Purchase` **ID 1874144557275601** - 20 EUR/gg, Complete Payment
- Identita TikTok DreamBrothers **7676564807169490961**, assegnata all ad account
- Credito caricato: 100 EUR. Pixel 7668256569129320466

## PROSSIMI PASSI (in ordine)

1. **Google - aggiungere i prodotti wall art e apparel** al gruppo. Andrea deve dare la lista (i 7 shortlistati con inventario: BET on Yourself Canvas e Poster, NYC Skyline, No pressure Framed, Lion B&W Canvas, Take the Risk, Leo Zodiac Tee, oppure la sua lista Etsy).
2. **Google - negative keywords** SOLO DOPO il punto 1, e solo su query che non corrispondono a nessun prodotto. `phone lock box` va TENUTA perche e la Focus Box.
3. **Google - titolo feed** della felpa via **regola di feed in Merchant Center**. Il titolo sul sito NON va toccato, condizione posta da Andrea. Proposta: `Christian Rhinestone Hoodie - Jesus Is The Light - Faith Sweatshirt`.
4. **TikTok - Andrea carica i 4 video** in Creative Library con Smart Fix. Poi vanno creati i 4 annunci nel gruppo esistente (testi e CTA gia pronti, Shop Now, landing sul prodotto).
5. **TikTok - cancellare la bozza** di gruppo annunci vuota con targeting Italia.
6. **VMF agent** - verificare che il listener sulla 8788 sia partito, altrimenti i task 7 e 8 non scattano.

## TRAPPOLE DA RICORDARE

- Il Riepilogo pre-pubblicazione di Google Ads mente sulla localita: verificare dopo la pubblicazione.
- `unitCost` di Shopify non include la spedizione: per i margini usare i costi Zendrop reali.
- Le shipping policy di Merchant Center sono separate da quelle di Shopify.
- I dati vendite Shopify sono inquinati da auto-ordini di test.
- L account TikTok italiano non puo targetizzare US/CA/AU: non insistere coi ticket.

---

## user - 2026-08-22T22:10:00Z
/session-import — riprendi da dove avevi lasciato, e aggiungi alla campagna Google Ads anche i prodotti che sto marcando col tag `google_ads` (wall art).

## assistant - 2026-08-22T22:25:00Z
Nessun turno nuovo da mobile. Trovati 3 prodotti taggati. Bivio posto ad Andrea: aggiungere per Item ID a mano oppure via `custom_label_0` automatica. Sceglie custom label + partire subito. Scritto `mm-google-shopping.custom_label_0=google_ads` su 3 prodotti + felpa Gesu. Aggiunto **task 9 `writeGoogleAdsLabel`** a VMF-Agent-Local/agent/core.mjs (traduce il tag Shopify in custom label per TUTTI i prodotti, non solo apparel). Listener 8788 verificato attivo.

## user - 2026-08-22T22:50:00Z
Non fare il pignolo: NON aspettare il sync di Merchant Center, aggiungi i prodotti direttamente alla campagna. Solo quelli che ho taggato io, non quelli che supponi tu dalle keyword: quelle product page hanno problemi di fondo.

## assistant - 2026-08-22T23:20:00Z
[Google Ads] Aggiunti per Item ID. **SCOPERTA: il feed usa il prefisso `shopify_zz_`, NON `shopify_US_`.** Formato: `shopify_zz_<productId>_<variantId>`. Percorso: Gruppi di annunci > tab Gruppi di prodotti > hover riga "Tutti i prodotti" > matita > "Aggiungi valori manualmente" > "Salva senza modificare le offerte". Il campo Cerca filtra per ID, non per titolo. Totale 22 Item ID.
**SCOPERTA CRITICA**: il nodo **"Tutto il resto in Tutti i prodotti" era ATTIVO** e aveva preso 1.319 impressioni e 11,03 EUR su 13,17 EUR totali. Non erano le keyword il problema: la campagna serviva l'intero catalogo.

## user - 2026-08-22T23:35:00Z
Escludi tutti i prodotti che non sono quelli che ti ho indicato: gli altri non sono pronti, hanno problemi di fondo che devo ancora risolvere.

## assistant - 2026-08-22T23:45:00Z
"Tutto il resto" escluso, verificato dopo ricarica (stato "Pagina esclusa").

## user - 2026-08-24T13:30:00Z
Ne ho taggati altri, aggiorna.

## assistant - 2026-08-24T14:00:00Z
Da 22 a **51 Item ID**. **TRAPPOLA TROVATA**: i nuovi Item ID entrano ereditando lo stato del padre, cioe' come "Pagina esclusa", e non servono un solo annuncio. Vanno riattivati (checkbox testata > Modifica > Includi), ma quell'inclusione di massa **ri-attiva anche "Tutto il resto"**, che va ri-escluso subito dopo. Ordine obbligato: aggiungi ID > includi tutto > ri-escludi "Tutto il resto" > ricarica e verifica.

## user - 2026-08-24T21:00:00Z
Come vedo le prestazioni di oggi? Voglio sapere esattamente quali keyword hanno avuto clic, su quali prodotti sono atterrati, e se ha senso tenerla accesa o spostare tutto su TikTok.

## assistant - 2026-08-24T21:40:00Z
Termini di ricerca (dall'inizio): `phone lock box` 5 clic / `jesus hoodie` 3 / `aerial photo of manhattan` 2 / `clearance photo frames` 2 / `jesus is light hoodie` 2 / `new york pictures` 2 / `picture framing supplies` 2. Piu' 32 clic su termini non rivelati. Prodotti piu' cliccati: Custom Picture Framing Service (9 clic, 9 USD), NYC Travel Poster (5), felpa Gesu L/M/XXL (13 totali), Phone Lock Box (11 su 3 colori). CPC medio 0,31 EUR.
Analisi: le query erano informative, non commerciali. Il CPC bassissimo lo conferma. **Insight**: la Focus Box stava gia' catturando `phone lock box` a 0,34 EUR - il canale caldo del prodotto su cui vuole andare all-in - ed era finita fuori con l'esclusione di "Tutto il resto".

## user - 2026-08-24T22:55:00Z
Perche' su "Jesus is the light" Google dice "Eta mancante" e "Genere mancante"? E' il prodotto di punta.

## assistant - 2026-08-24T23:05:00Z
Su Shopify i metafield **ci sono gia'** (`age_group=adult`, `gender=unisex`, `condition=new`, scritti dall'agente VMF). Il problema e' che **non sono ancora nel feed**: in Merchant Center l'ultimo aggiornamento delle varianti era del 22 ago 2:09 di notte, i metafield sono stati scritti dopo. Google Ads mostra lo stato del feed, non di Shopify. Le varianti risultano comunque **Approved**; "Idoneo (limitato)" penalizza il ranking, non esclude.

## user - 2026-08-25T09:30:00Z
Mi sembra di star bruciando soldi. Analizza perche' nessuno ha ancora acquistato e se ha piu' senso spostare tutto su TikTok per la Focus Box.

## assistant - 2026-08-25T10:15:00Z
Dati: 87 clic, 26,79 EUR, **0 conversioni, 0 checkout iniziati, 0 carrelli abbandonati** su 173 sessioni in 3 giorni. Landing: felpa 17 sessioni, Focus Box 11, framing service 8. Economia Focus Box: prezzo 37,50 EUR, unitCost 4,12 EUR.
Verdetto: non e' il canale sbagliato, e' che la campagna serviva il catalogo sbagliato. Google raccoglie domanda esistente (`phone lock box` a 0,34 EUR), TikTok la crea. TikTok non puo' partire finche' Andrea non carica i 4 video a mano. Il bonus da 400 EUR (373 EUR di spesa entro il 25 set) esiste solo su Google.

## user - 2026-08-25T10:40:00Z
La felpa singola costa 67 USD, non 95. Comunque aggiungi la Focus Box alla campagna Google.

## assistant - 2026-08-25T11:30:00Z
Correzione accettata: il feed manda `price 95` e `sale_price 67`, Google Ads mostra il listino nella colonna Prezzo, il cliente vede 67. Scarto reale con l'EUR ~10%, non 56%: **ipotesi prezzo depennata**.
Focus Box taggata + custom label + 3 Item ID aggiunti (`shopify_zz_16094249255237_*`). Totale **54**.
**PROBLEMA RISOLTO**: Google Ads rimbalzava sull'account Etsy. Causa: sul PC ci sono **DUE Chrome collegati all'MCP**. `a0fca0e6-2abc-4d5d-829f-992f028940b8` e' quello con dreambrothers.hub (euid 6549212057); l'altro e' bbrothersdreams.etsy. Non era un logout. Salvato in memoria. Regola: MAI usare `authuser=N`, usare `ocid=8435206061&euid=6549212057&__u=5992421393`.

## user - 2026-08-25T12:00:00Z
Errore upload TikTok "Upload error. Make sure this isn't renamed, edited, or open in other apps". Individua la causa. E stoppa la campagna Google: 173 sessioni, zero carrelli e un solo like e' ridicolo. Analizza come un senior media buyer: forse e' il redirect .com -> .it da IP americano, o forse la causa sta altrove.

## assistant - 2026-08-25T13:00:00Z
**Video TikTok**: il file e' integro (decodifica senza errori, moov in testa, codec identici a quelli riusciti: H.264 High 576x1024 30fps AAC). La causa e' **dove sta**: `E:\IDriveLocal\...`, cartella sincronizzata cloud, path 204 caratteri. IDrive lo tocca durante l'upload e il lock lo fa fallire. Risolto copiando i 4 video in `C:\Users\utente\Desktop\TikTok-Upload` con nomi corti.
**Campagna messa IN PAUSA**. Totali finali: 8.792 impressioni, 150 clic, 39,76 EUR, 0 conversioni.
Ipotesi eliminate con i dati: prezzo (scarto 10%); **redirect .com -> .it** (l'header Shopify dice `country="IT"`: e' geo, scatta sull'IP italiano di chi testa. `dream-brothers.com` e' il dominio del mercato primario "(Inches)" = USA, un americano resta li').
**Dato che sposta tutto**: segmentazione per dispositivo - Cellulari 7.679 impr / **139 clic (93%)**, Computer 565/9, Tablet 548/2.
Misure pagina prodotto: DOM interattivo 3,60s, DOMContentLoaded 4,85s, load 7,68s, 177 richieste, 68 script, **512 immagini nel DOM**, 7.154 nodi.

## user - 2026-08-25T12:45:00Z
Ho testato con PageSpeed e Lighthouse: performance basse. Pero' sul mio telefono carica in meno di 3 secondi. Voglio la metrica drop-off su Google Ads come su Facebook, e voglio salire a 70-80. Credo che il collo di bottiglia siano le immagini non compresse, forse serve un'automazione che le comprima a ogni nuovo prodotto.

## assistant - 2026-08-25T13:20:00Z
**CORREZIONE IMPORTANTE a quanto avevo detto prima**: il drop-off NON e' il problema. Con i dati completi (sessioni da Google: 32+39+21+24+21 = **137**) contro **150 clic**, il drop-off e' circa il **9%** - fisiologico, come su Facebook. La stima precedente ("meta' se ne va") era sbagliata, calcolata su due giorni e su un confronto mal fatto. **Le persone sul sito ci arrivano.**
**Le immagini NON sono il collo di bottiglia**: foto prodotto **15 KB in WebP**, gia' con `loading="eager"`, `fetchpriority="high"` e srcset corretto. L'automazione di compressione non servirebbe a nulla.
**Gli script non sono il collo di bottiglia**: TBT 300-460ms, gia' differiti (Andrea aveva ragione).
**Causa vera**: HTML compresso 163 KB (scarica veloce) ma **1.192 KB da parsare**. Il killer e' il parsing + 7.154 nodi DOM. Origine: `header.liquid` (riga 456), `footer.liquid` (276), `mobile-menu.liquid` (501) hanno ciascuno `{%- for country in localization.available_countries -%}` che renderizza **ogni paese del mondo** con la sua bandiera: **465 img locale-flag (93% delle immagini) e 483 button**, nel DOM anche a popover chiuso. Ogni paese genera un form Shopify completo: oltre 3.700 nodi.

## user - 2026-08-25T13:50:00Z
Risolvi partendo dai selettori paese, su una copia del tema per fare il confronto. Sull'intervento 2 valuta tu. Ma il preload sulla prima immagine della gallery mi risulta gia' presente in theme.liquid — o sbaglio?

## assistant - 2026-08-25T14:40:00Z
**Risposta sul preload**: quei preload non sono dell'immagine. Nella pagina live ce ne sono 6: `as="style"`, `as="script"` (theme.js), `as="fetch"` (JSON prodotto), `as="script"` (flickity.js), 2 font. **Nessuno `as="image"`.** Prova decisiva: `{%- assign selected_media = ... -%}` a riga 63 di theme.liquid **compare 0 volte nell'HTML generato** - nel tema Focal originale serviva a generare il preload, la riga che la consumava e' andata persa in una personalizzazione. Gemini aveva ragione sul principio: il tag img ha gia' fetchpriority high ma sta **dopo ~1 MB di HTML**, quindi il browser lo scopre troppo tardi.
**Tema copia creato**: `PERF-TEST selettori paese lazy`, ID **204993593669**, non pubblicato.
**Intervento 1** su 4 file (ce n'era un quarto, `mobile-menu-simple.liquid`, sfuggito al primo giro): header 455-603, footer 275-303, mobile-menu 500-649, mobile-menu-simple 348-486. Liste avvolte in `<template data-lazy-countries>` (contenuto inerte: niente layout, niente richieste immagine), montate al primo click, con `requestIdleCallback` come rete di sicurezza.
**Intervento 2** su `layout/theme.liquid`: aggiunta la riga che consuma `selected_media` e genera `<link rel="preload" as="image" fetchpriority="high">` con `imagesrcset` e `imagesizes` identici al tag img.
**Risultati misurati**: HTML da parsare 1.192 -> **853 KB (-28%)**; form 354 -> **12 (-96%)**; bandiere 465 -> 123; img 500 -> 158. **Non-regressione verificata**: dopo il montaggio 462 bottoni paese cliccabili, selettore funzionante.
**Metrica drop-off**: chiarito che GA4 e' piu' approssimativo (attribuzione e soglie proprie); il metodo preciso e' azione di conversione "Landing Page View" (categoria Visualizzazione di pagina, secondaria) + Pixel personalizzato Shopify su `page_viewed` + colonna `(Clic - LPV) / Clic`.

---

## STATO AL 25 AGOSTO 2026

### Google Ads - campagna `US | Shopping Standard | Jesus Hoodie | ago26` ID 24156452811
- **IN PAUSA** su decisione di Andrea
- Totali: 8.792 impressioni, 150 clic, 39,76 EUR, CPC 0,27 EUR, **0 conversioni**
- 54 Item ID attivi (felpa 5, wall art 46, Focus Box 3), "Tutto il resto" **escluso**
- Bonus 400 EUR: servono 373 EUR di spesa entro il **25 settembre 2026**
- Account: ocid 8435206061, euid 6549212057, adGroupId 194720362690

### Diagnosi performance product page (il tema aperto)
- Drop-off reale **~9%** (137 sessioni su 150 clic): NON e' il problema
- 93% del traffico e' **mobile**
- Immagini gia' ottimizzate (15 KB WebP): niente da comprimere
- Script gia' differiti (TBT 300-460ms)
- Collo di bottiglia: **1,2 MB di HTML da parsare + 7.154 nodi DOM**, causati dai 4 selettori paese
- PageSpeed mobile prima del fix: 49-56 (LCP 9,0-16,7s, FCP 3,2-4,9s)

### Tema di test - DA VALIDARE
- `PERF-TEST selettori paese lazy` ID **204993593669**, non pubblicato
- Preview: `https://dream-brothers.it/en/products/jesus-is-the-light-rhinestone-hoodie?preview_theme_id=204993593669`
- Va testato con Lighthouse da DevTools (PageSpeed pubblico non puo' leggere un preview: serve il cookie)

## DOMANDA APERTA PER IL MEDIA BUYER

Con drop-off al 9% e le persone che sul sito ci arrivano davvero, **137 sessioni con 0 carrelli e 1 solo like** spostano il sospetto a valle della velocita': offerta, prodotto o qualita' del traffico. La velocita' va sistemata comunque (su TikTok l'attenzione e' piu' bassa), ma non e' scontato che da sola faccia comparire i carrelli. Serve una revisione di questa lettura.

## TRAPPOLE NUOVE

- Feed Shopify: prefisso **`shopify_zz_`**, non `shopify_US_`
- Item ID aggiunti a un gruppo con "Tutto il resto" escluso entrano **gia' esclusi**; riattivarli in blocco **ri-attiva anche "Tutto il resto"**
- Colonna "Prezzo" di Google Ads mostra il **listino**, non il `sale_price` che vede il cliente
- **Due Chrome** collegati all'MCP: usare il deviceId `a0fca0e6-...`, mai `authuser=N`
- Upload TikTok da cartelle sincronizzate cloud (IDrive) fallisce per lock: copiare in locale
- `dream-brothers.com` -> `.it` e' un redirect **geo**, non un bug: un utente USA resta su `.com`
