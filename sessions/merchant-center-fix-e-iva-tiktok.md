# Merchant Center Fix e IVA TikTok
<!-- externalId: merchant-center-fix-e-iva-tiktok -->

[contesto compattato — i turni sono condensati, gli output dei tool riassunti]

## user — 2026-08-13T22:00:00Z
Chiama il Senior Media Buyer mappato nel company brain. Voglio testare **Focus Box** (box con timer per bloccare il telefono) su TikTok Ads. Allegato `DATI PAESI + Smartphone Addiction.ods`. Nel 2024 l'avevo testato su Meta in UAE/Australia: 120 € spesi, 1 sola vendita a 39 €. I guru me l'hanno smontato ma io ci credo: gli angle sono tantissimi (studenti, genitori, ADHD, porn addiction, coppie, binge watching, insonnia, mindfulness). Che ne pensi? Se vale la pena, aiutami a creare la campagna.

## assistant — 2026-08-13T22:40:00Z
Verdetto: **GO al test, con 4 correzioni**.
1. **Timing**: hai ragione a muoverti ora ma sbagli il perché. L'estate non è il picco — il trigger è il rientro (fine agosto/settembre) e gennaio.
2. **Il concorrente non è un altro box, è un'app gratis.** Chi compra è chi ha già fallito con le app (come te con AppBlock). Meccanismo unico: *"Un'app la disinstalli in dieci secondi. Una serratura no."*
3. **Zero concorrenza non è un regalo** — il tuo stesso Brain lo dice per LED Mansion: l'assenza di ads è red flag di scala. Qui la categoria scalava nel 2020-22 (kSafe) poi Amazon l'ha commoditizzata a 20-30 €.
4. **Aurora non è l'avatar giusto**: i segmenti forti sono la madre 30-45 (screen time figli), lo studente 16-24, la community ADHD. Il maschio "controllo" è quarto.

Scorecard filtri: passa tutto tranne il filtro 8 (brand fit — non è wall art né streetwear → corsia satellite).

Verificato via API: account TikTok `7537704704961167378` attivo, **pixel già installato** (`7668256569129320466`, integrazione Shopify). Prodotto **live**: `timed-phone-locking-box-for-self-control`, €49, ma `compare_at` = €49 (nessuna ancora) e descrizione di 278 caratteri.
**Non posso creare la campagna**: `campaign/create` → `code 40002 "Complete payment to continue"`. Saldo 0 e nessuna identity.

## user — 2026-08-14T00:30:00Z
Costo: AliExpress 5,50 € + 8,07 spedizione, oppure Zendrop $4.74 + $10.36. Spedizione 8 gg USA, 9-11 Italia. Pago con American Express. L'identity non so collegarla. La pagina prodotto è una bozza. Le creative le voglio fare con l'AI, non ci metto la faccia.

## assistant — 2026-08-14T01:00:00Z
Unit economics: costo sbarcato ~13,5 €. **Con IVA: margine ~23,50 €, CPA break-even 23,50 €.** Serve CR ≥1,3% a CPC 0,30 — una pagina da 278 caratteri fa 0,3-0,6%. Configuriamo subito, ma la spesa parte dopo la pagina.
Consegnata la configurazione completa: campagna WEB_CONVERSIONS, 1 solo ad group broad IT 18-44, 30 €/giorno, Complete Payment, no Pangle, 4 creative senza volto né inglese (image-to-video dalle foto fornitore + voiceover AI), regole di kill/scale. Ordina un'unità a te stesso: senza campione non fai creative buone.

## user — 2026-08-15T20:00:00Z
Non voglio pagare il 20% di IVA per caricare il saldo. Trova una soluzione.

## assistant — 2026-08-15T20:30:00Z
Il postpagato **non evita l'IVA**. La causa vera: `license_no` vuoto → TikTok ti tratta da privato. Le fatture arrivano da TikTok UK: con P.IVA registrata scatta il reverse charge (art. 7-ter DPR 633/72) e ti fatturano 0%.

## user — 2026-08-15T21:00:00Z
P.IVA: IT12030200963. Procedi.

## assistant — 2026-08-15T21:30:00Z
Provato `advertiser_update` con `tax_map` (`vat` e `tax_id`, con/senza prefisso IT, su entrambi gli account): sempre **`40002 Invalid advertiser account type`**. Scoperto che l'account `7674316439930699796` ha `license_no: BLTNDR00M09F205V` = **codice fiscale, non P.IVA**.
Sweep completo di tutta la UI: nessun campo P.IVA in Business settings, Verification, Verification Center, Payment methods, Account settings, Billing, Invoices.
**Aperto ticket supporto TikTok `4375533`** (topic Billing and Payment → Tax and GST → Unable to verify) con allegati certificato P.IVA e visura.

## user — 2026-08-16T14:47:00Z
Il supporto mi ha risposto indicando Business Settings → Verification → Billing Information → Edit. Ma quel percorso non esiste. Risolvi.

## assistant — 2026-08-16T15:21:00Z
Confermato: il percorso non esiste, né quello alternativo della guida (Ads Manager → Tools → Account setup → 404). Causa: gli ad account stanno su un **Advanced Payment Portfolio** a livello di Business Center → l'edit self-service non è esposto.
Inviata replica al ticket con tutte e 9 le schermate controllate e l'errore API.

**TikTok ha risposto alle 15:23:56**: conferma che la P.IVA non è registrata, che gli account sono su un profilo di fatturazione condiviso a livello di BC e non su profili self-service, che **il Tax ID non è esposto e l'API non è applicabile per questo tipo di account**, e che il caso è stato **inoltrato al team specialistico**. Ticket in stato *Processing*.
Consiglio: **non creare un BC nuovo** (stesso tipo di profilo = stesso problema). Semmai testare un ad account standalone fuori dal BC.

## user — 2026-08-16T16:00:00Z
Stasera anziché TikTok partiamo con Google Ads. Completa la Performance Max sfruttando il credito, senza creative, solo catalogo. E poi: voglio partire dagli Stati Uniti, non dall'Italia. Risolvi i problemi del Merchant Center come abbiamo fatto per Pinterest.

## assistant — 2026-08-16T17:30:00Z
Trovata la campagna esistente: **"Campaign #1"**, `campaignId=24065752014`, PMax, 15 €/giorno, in pausa. Merchant Center era **"Non configurato"**.

Configurato:
- **Merchant Center collegato**: `5697377647` (⚠️ irreversibile)
- **Espansione URL finale disattivata**
- **Località da Italia → Stati Uniti**, **lingua → Inglese**
- Trovato il **credito**: `7NQ6F-QG7LF-C4CK`, spendi 400 € → ricevi 400 €, **requisiti entro il 25 settembre 2026**

**Causa radice del feed trovata — è UN problema, non 21.000**: *"Mismatched online store URL"* su **21,6K prodotti (99,6%)**. I due Merchant Center avevano i domini incrociati: `5697377647` (attivo) rivendicava `www.dreambrothers.it`, mentre `5708728628` (**sospeso per Misrepresentation**) rivendicava `dream-brothers.com`, che è il dominio degli URL nel feed.

## user — 2026-08-16T18:00:00Z
Ti do il via: procedi con la rivendicazione e l'audit del sito.

## assistant — 2026-08-16T19:00:00Z
Eseguito su `5697377647`:
- **Online store → `https://dream-brothers.com`**, Verified (automatico) + **Claimed** (claim sottratto all'account sospeso)
- **Checkout URL** → `dream-brothers.com/cart/{id}:1`
- **Business details**: indirizzo, help center `dream-brothers.com/pages/help-center`, telefono +39 389 915 2561. Lasciate NON spuntate live chat/chat bot (non verificate).

Chiarito che **"Missing signals"** in Store quality = mancano *return window, delivery time, shipping cost*: fra le **75 shipping policy** dell'account **nessuna per gli Stati Uniti**.
Corretto anche un mio errore: le tariffe delle app POD non c'entrano — Google guarda quello che il cliente vede al checkout, e su quello Andrea aveva ragione.

## user — 2026-08-16T19:30:00Z
Le policy le sai già, leggile dal sito e dal brain. Non farmele ripetere. Salva tutto lì.

## assistant — 2026-08-16T20:00:00Z
Letto da `policy-resi-spedizioni.md`: reso 30 giorni no-questions-asked, **spedizione del reso a carico del cliente**, rientro in Italia, custom non restituibili, danneggiato → sostituzione gratis senza reso. Spedizione **gratis worldwide**, USA **6-12 giorni lavorativi**.

Creato:
- **Shipping policy "USA - Free shipping 6-12 business days"**: United States, tutti i prodotti, USD, Free, handling 1-2 + transit 5-10 = **6-12 giorni**
- **Return policy "Standard for United States"**: 30 giorni, By mail, **Customer responsibility**, no restocking fee, refund processing 5 gg
- **Corretta "Standard for Italy"** che dichiarava reso **Free** (falso) → Customer responsibility. Ora Free 0% · Paid 100%

Chiarito che **"Return label"** in Merchant Center non è l'etichetta fisica: dice solo **chi paga**.
Sul reso apparel Zendrop, raccomandazione: **keep-it / returnless** (difetto → sostituzione gratis; taglia sbagliata → un cambio gratis + size guide; ripensamento → store credit 110%), con freno anti-abuso al primo ordine e sotto i 60 €.

## user — 2026-08-16T20:30:00Z
L'app Google & YouTube è già installata. Procedi. Poi esporta la sessione.

## assistant — 2026-08-16T20:45:00Z
**Blocco finale identificato**: in Ads Manager → Conversioni, l'azione **"Acquisto"** esiste, è predefinita per l'account e usata da 1 campagna su 1, ma lo stato è **"Configurazione errata"** con 0 risultati. Va risolto dal lato Shopify riautorizzando l'account Google Ads `835-843-8168` dentro l'app Google & YouTube.

---

## Stato al termine della sessione

**Google Ads** — campagna `24065752014` "Campaign #1", PMax, **in pausa**, 15 €/giorno, USA/Inglese, MC `5697377647` collegato, URL expansion off.
**Merchant Center `5697377647`** — dominio `dream-brothers.com` verificato e rivendicato, checkout allineato, business details completi, shipping USA e return USA creati, return Italia corretta.
**Credito Google**: 400 € a fronte di 400 € spesi, **scadenza requisiti 25 settembre 2026** (a 15 €/gg servono 27 giorni).
**TikTok** — ticket `4375533` in *Processing*, escalation al team specialistico per registrare la P.IVA. Saldo 0, nessuna identity.

## Prossimi passi
1. **Sistemare "Acquisto" da Configurazione errata** → app Google & YouTube su Shopify, riautorizzare l'account Ads. È il blocco che impedisce di accendere.
2. **24-72h**: verificare che i 21,6K prodotti escano dal mismatch (Overview → Approved).
3. Decidere se partire con la **sola wall art** nel gruppo di schede.
4. Sistemare la pagina prodotto Focus Box (compare_at, copy, tempi di consegna, garanzia).
5. Attendere il team specialistico TikTok per la P.IVA.
