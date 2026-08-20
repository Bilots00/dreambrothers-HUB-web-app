# Product Artist Pipeline Fix
<!-- externalId: product-artist-pipeline-fix -->

## user — 2026-08-17T13:30:00Z
Il bot Telegram mi ha mandato i design prodotti stanotte ma nella web app (Approva Design) non appare nessun design da approvare, ne' oggi ne' nei giorni scorsi.

## assistant — 2026-08-17T13:50:00Z
[Root cause: run-nightly.sh non chiamava mai engine/build-batch.mjs, quindi batch.json non veniva scritto (la web app legge SOLO quello). Fix: chiamata aggiunta in scripts/run-nightly.sh dopo lo stadio 2 + backfill batch.json per 14-19/08. Repo agente: Bilots00/dreambrothers-product-artist-AUTO.]

## user — 2026-08-19T10:00:00Z
I design generati sono COMPLETAMENTE diversi dalla reference bestseller (da un leone a colori con MINDSET IS EVERYTHING e' uscita una zampa d'orso in b/n con frase inventata). Risolvi.

## assistant — 2026-08-19T11:00:00Z
[Cause nelle istruzioni: boilerplate "Do not copy the reference", regola "non ripeterti" letta come "cambia animale", note in state/history.json. Fix in TASK-NIGHTLY.md + Pattern 3/5 scheda-ruolo Brain: della reference si CONSERVANO soggetto, parole esatte, struttura, spacing; si CAMBIA l'esecuzione su almeno 3 leve. Test iterativi su Gemini (leone LEO/BORN TO LEAD e stella you-are-the-light): v2 approvata, v3-v4 bocciate (contrasto sbagliato), v5 OK con OEOF. Regole finali: 3 tecniche (OEOF contestualizzato, Contrasto, Cross lighting), prompt leggeri, Pattern 6 "la creativita' ha bisogno di spazio".]

## user — 2026-08-19T18:00:00Z
Carica i 2 design nel batch come gia' approvati. Quando un design viene approvato: prodotto automatico su Printify+Shopify, e pulsante "Crea Creative" col Creative Director + Copywriter del Brain (piattaforma/avatar/momento).

## assistant — 2026-08-19T21:00:00Z
[Build: server/printify.ts (upload, prezzi da costi reali, publish), stato pubblicazione dentro batch.json con coda scritture + retry 409, server/creativeDirector.ts. Andrea: MAI API key/Gemini, solo abbonamento Claude Max → riscritto come coda: GET /api/creative/pending + POST /api/creative/result (x-care-secret), consumata da engine/creative-director.mjs + scripts/creative-director.sh sul VPS (cron 10 min). Upscale con Topaz Photo AI (tpai.exe, licenza a vita) in engine/upscale.py (motori topaz/realesrgan) + upscale-batch.mjs sul PC. Scelta veste apparel/wallart al momento della pubblicazione.]

## user — 2026-08-20T08:30:00Z
Errori: Printify 413 (file troppo grande), prodotto solo nero senza scontorno, grafica sempre sul fronte, rotellina "in coda" infinita.

## assistant — 2026-08-20T10:30:00Z
[Fix: upload via URL firmato HMAC (artworkLink.ts + GET /api/artwork) invece di base64 nel POST; scontorna.py metodo "bordi"; scheda di stampa decisa dall'agente VPS (posizione+colori, coda pending-stampa); timeout 15 min sulla coda con "togli dalla coda". Wall art: NON e' Printify, e' Gelato via Bulk Creator → consegna file `<Titolo> (3x4).png` e `(5x7).png` scaricabili. VPS sistemato: clone bloccato da giorni su modifiche locali (batch 20/08 prigioniero), exec bit, env in ~/.social-agent.env, parser JSON tollerante. Creative del leone consegnate (4 su Meta Ads).]

## user — 2026-08-20T11:40:00Z
Lo scontorno fa cagare (criniera mangiata), il tribale... e ancora: scontorno rovinato, O con contorno incoerente, BORN TO LEAD illeggibile sui chiari, verde orrendo, fronte vuoto, creative solo testo. [Regola fronte/retro dal ragionamento con Gemini: FRONTE = ancora identitaria per chi indossa; RETRO = manifestazione per gli altri; variante poetica stile Poeta della Serra firmata col logo.]

## assistant — 2026-08-20T13:00:00Z
[Fix: scontorna.py metodo "canva" (rembg isnet + salvagente bordi in unione + smonta-premoltiplicazione), pipeline invertita (upscale PRIMA, scontorno DOPO), palette capi hardcoded [Black, White, Sand, Sport Grey], regola leggibilita', fronte generato da engine/fronte.py (tipografia font repo, accento+contorno), scelta fronte/retro/agente in UI per i nuovi design, regola fronte/retro in TASK-NIGHTLY e prompt scheda. Leone ripubblicato: retro+fronte LEO gothic, solo Black, €80.99 (markup 3.4 su doppia stampa — da rivedere).]

## user — 2026-08-20T13:15:00Z
ANCORA male: coda del leone mangiata, parte bassa delle lettere LEO tagliata (contorno scuro), su Canva viene perfetto. "Rifai" non fa scegliere fronte/retro/agente. Creative in STANDBY finche' lo scontorno non e' risolto. Esporta la sessione (context all'88%).

## assistant — 2026-08-20T13:20:00Z
[Bug aperti registrati in memoria (product-artist-agent-pipeline.md): 1) scontorno da portare a livello Canva — provare birefnet-general SENZA alpha matting, dilatazione +2px, criterio = coda intera + lettere LEO complete su provino bianco; 2) scelta posizione anche su "rifai"; 3) regola design notturno: testi sempre con contorno/contrasto proprio; 4) creative in standby; 5) markup apparel da abbassare; 6) prodotti Printify vecchi da cancellare. Sessione esportata per riprendere in chat nuova.]
