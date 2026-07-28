# Setup Campagna Google Ads
<!-- externalId: setup-campagna-google-ads -->

[contesto compattato — sessione lunghissima del 26-28/07/2026, transcript riassunto per fasi]

## user — 2026-07-26T18:30:00Z
Voglio lanciare la mia prima campagna Google Ads (PMax) per i prodotti wall art, dato che il BM Meta e' hackerato. Agisci come il mio AI Media Buyer del company brain. Ho una lista prodotti su Notion e il Merchant Center risultava sospeso.

## assistant — 2026-07-26T19:00:00Z
[Fase 1 — Diagnosi] Ruolo = Senior Media Buyer (roster: definito, non attivo come agente runtime). Scoperti TRE Merchant Center "DreamBrothers" (login bbrothersdreams.etsy@gmail.com): 5708728628 SOSPESO (era collegato a Shopify, 4657 item 0 approvati), 5697377647 PULITO (122 prodotti, scelto come base), un terzo mai ispezionato. Lista Notion (45 prodotti) valutata: core dreamer + citta' OK, blocco IP a rischio. Andrea (dopo verifica USPTO) tiene Blockbuster/Van Gogh/Banksy/Monopoly-style ecc.; rimuove solo: Usa la Forza (Star Wars), Lando Norris x3, Chanel Set of 2, Ralph Lauren + 3 prodotti demo Shopify "Sample Product" = 9 SKU taggati no-google-feed (poi rimossi dal canale Google manualmente da Andrea). Margini: solo poster nudi >=33 EUR in campagna (ROAS BE ~1.5-1.75); framed/canvas esclusi dal lancio. Shortlist 30 SKU (8 dreamer, 9 NYC, 6 citta' USA, 4 Giappone/Europa, 3 Set of 3).

## assistant — 2026-07-26T21:00:00Z
[Fase 2 — Fix Shopify] 37 varianti di 16 prodotti ACTIVE erano tracked con qty<=0 (invisibili su Google, es. Rockfeller Center 4/4 taglie esaurite): riportate disponibili e poi ri-tracciate a qty 20 per preservare la scarcity (scelta di Andrea). Design automazione scarcity APPROVATO ma NON ancora costruito: cron VPS claude -p, metafield custom.sold_out_since, restock a 20 dopo 7gg sold-out, guardia anti sold-out-totale. Duplicati prezzi (BET on Yourself x3, Your Dreams x5...) li gestisce Andrea da solo.

## assistant — 2026-07-27T00:30:00Z
[Fase 3 — Account Google Ads] Creato account 835-843-8168 sotto dreambrothers.hub@gmail.com (dentro il wizard "prima campagna"): fatturazione attiva, PROMO 400 EUR agganciata (spendi 400 ricevi 400, scadenza spesa 25 set 2026). Campaign #1 (wizard, targeting IT sbagliato) messa in PAUSA con 0 EUR spesi. Budget corretto da 208,50 proposto da Google a 15 EUR/giorno. Strategia: Massimizza conversioni SENZA tCPA. Loghi creati da me (quadrato 1200x1200 + landscape 4:1) caricati, salvati anche in BRANDS/DreamBrothers/Logo/GOOGLE ADS. Verifica inserzionista INVIATA (Andrea Bilotta ditta individuale, Via Prima Strada 19, 20045 Lainate MI): revisione 1-10 giorni, account "in pausa" finche' non passa. Merchant 5697377647 collegato ad Ads 835-843-8168 (richiesta inviata da Ads, approvata da Andrea lato Merchant).

## assistant — 2026-07-28T09:00:00Z
[Fase 4 — Blocchi API/MCC] Link MCC 355-222-1790 -> 835-843-8168 fallisce silenziosamente: console rivela AUTH_ERROR_REAUTH_PROOF_TOKEN_REQUIRED (CHILD_ACCOUNT_LINKING, riskyAction). Serve passkey: creata da Andrea alle 08:55 del 28/07 ma con ritardo di sicurezza Google — link NON completato (riprovare, ora dovrebbe passare). Non critico: l'MCP google-ads e' comunque bloccato dal developer token a livello "Account di prova" — serve richiesta accesso Basic dal Centro API del manager. hub@ e' gia' amministratore diretto di 835, quindi API utilizzabile anche senza MCC quando il token sara' Basic.

## assistant — 2026-07-28T11:30:00Z
[Fase 5 — CAUSA VERA dei 0 approvati] L'app Google & YouTube di Shopify puntava al Merchant SOSPESO 5708728628. Reinstallata da Andrea con login hub@: non vedeva 5697377647 (proprieta' etsy@). Fix: hub@ aggiunto come ADMIN su 5697377647, invito accettato, app collegata. Il feed vero Shopify ora fluisce: 12.104 item (varianti x paesi), prevalenza Limited. I 122 prodotti precedenti erano solo scansione automatica del sito (senza attributi = mai approvabili). NON toccare "Transfer my domain"; account 5830964945 creato per errore, da cancellare. Errore rosso "Local inventory / Google Business Profile" = irrilevante (niente negozio fisico), da disattivare.

## assistant — 2026-07-28T12:30:00Z
[Fase 6 — Shipping Gelato] Misrepresentation trovata: sito promette spedizione GRATIS ovunque, ma i profili Gelato in Shopify addebitavano 4,09-12,44 EUR con nomi tipo "US Flat Rate". FIX ESEGUITO via GraphQL: 11 profili Gelato x 16 zone = 176 tariffe rinominate "Standard Shipping" a 0,00 EUR. Verificato in GMC: colonna Cost = Free. RESTANO SBAGLIATI I TEMPI (GMC 11-17gg vs sito US 4-7): le policy GMC sono auto-sincronizzate dall'app Shopify, modificarle a mano viene sovrascritto. Mappatura tempi APPROVATA da Andrea: US/GB 4-7, DE 4-6, IE/CA 5-8, AU/NZ 6-9, EU (unica zona, include IT) 4-8, resto 7-14. Opzioni: disattivare sync shipping nell'app o impostare transit time in Shopify — decisione pendente. WhiteWall/Tapstitch/Apliiq ignorati (non usati), Zendrop gia' gratis. Dominio: GMC rivendica dreambrothers.it, primario e' dream-brothers.com — fix rimandato a feed stabilizzato (campagna US-only mitiga). Email contact page da allineare: info@dreambrothers.art vs .it.

## assistant — 2026-07-28T13:00:00Z
[Fase 7 — Campagna in corso] Ricostruzione PMax "DBR | PMax Feed-Only | US" (bozza persa nel crash PC: causa reale = salvataggi bloccati dalla reauth). Fatto: obiettivo Vendite, tipo PMax, Merchant 5697377647 agganciato, nome inserito. BLOCCATA al dialog "Verifica la tua identita'" — Andrea deve confermare con passkey/Windows Hello. Poi restano: Localita' Stati Uniti, lingua Inglese, budget 15 EUR/g, espansione URL OFF, niente asset group (feed-only), salvare e LASCIARE IN PAUSA. Kill rule: ROAS<1,6 a 14gg pieni -> iterare feed, mai alzare budget. Conversion tracking: azione Acquisto via app Shopify deve risultare PRIMARIA prima del go-live.

## user — 2026-07-28T13:20:00Z
Nel frattempo (siamo bloccati sulla verifica identita') configurami la prima campagna Pinterest Ads: business manager + campagna completa adattata al brand, controlla se esistono bonus/crediti stile Google (400EUR). Procedi autonomo senza domande banali. Crea anche un resume prompt per continuare in una nuova chat (contesto al 93%).
