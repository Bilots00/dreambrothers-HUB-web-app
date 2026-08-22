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
