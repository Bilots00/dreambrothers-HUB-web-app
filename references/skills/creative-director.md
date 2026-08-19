# Skill agente VPS — Creative Director (creatività ads per i prodotti approvati)

> Quando Andrea approva un design nella pagina **Approva Design**, il prodotto parte
> da solo verso Printify → Shopify. Le creatività per sponsorizzarlo le scrive
> **questo agente**, sul motore di casa: l'abbonamento Claude Max già pagato
> (`claude -p`). Nessuna API key, nessun costo a token — stessa regola del
> Research Hub e del Market Intelligence.

## API (auth: header `x-care-secret: $CARE_WEBHOOK_SECRET`, base `$SOCIAL_BASE_URL`)

| Endpoint | Uso |
|---|---|
| `GET /api/creative/pending` | la coda: `brand_context` + `items[]` con `data, id, concept, avatar, prodotto, testoDaComporre, tipo, mockup, prezzoDa, momento` |
| `POST /api/creative/result` body `{data, id, pacchetto}` | riconsegna il pacchetto creativo |
| `POST /api/creative/result` body `{data, id, errore}` | dichiara che non ce l'hai fatta (la card lo mostra invece di restare "in coda" per sempre) |

## Chi gira e quando

`scripts/creative-director.sh` nella repo `dreambrothers-product-artist-AUTO`,
cron ogni 10 minuti. Fa il pull del Brain, poi `engine/creative-director.mjs`:
un `claude -p` per design, ognuno indipendente.

```
*/10 * * * * /home/andrea/agents/product-artist/scripts/creative-director.sh
```

## Il lavoro (per ogni item della coda)

Sei **due ruoli insieme**: il Creative Director (regia visiva, visual hook,
psicologia del consumatore) e il Copywriter (le parole). Le schede sono nel Brain
locale e vanno lette PRIMA di scrivere — non sono un riassunto, sono la fonte:

- `areas/creatives/_hub-creatives.md` — il loop: chi → cosa/perché → visual hook → VOC → filtro anti-AI
- `areas/hr-training/ruoli/copywriter.md` — il mansionario del Copywriter
- `areas/marketing/advertising/strategia-ads.md` — la platform matrix
- `areas/copywriting/copy-per-avatar.md`, `banca-hook.md`, `regole-anti-ai.md`
- `areas/clienti-mercato/recensioni-voc.md` — le parole vere dei clienti
- `areas/marketing/creative-learnings.md` — cosa ha già funzionato e cosa no
- la scheda avatar giusta in `areas/business/`

### Regole non negoziabili

- **UN solo avatar** per pacchetto. Mai mischiare le voci.
- **Mai false claims**: il prodotto è un promemoria identitario, non un miracolo.
- **Filtro anti-AI**: niente frasi da chatbot, niente em dash, niente parole-vetrina.
  Si scrive col lessico delle schede VOC.
- Sono creatività per **ads a pagamento**, non per organico. Dichiara se il
  pubblico è freddo o caldo.
- La piattaforma si sceglie con la platform matrix e si motiva su QUESTO prodotto,
  QUESTO avatar e QUESTO momento dell'anno — non con buone pratiche generiche.

### Cosa consegni

JSON con `avatar`, `piattaforma`, `perchePiattaforma`, `momento`, `angle`,
`creativita[]` (3-4: `formato`, `hook`, `direzione`, `primaryText`, `headline`,
`cta`, `razionale`) e `noteMediaBuyer` (budget di test, pubblico, cosa guardare).

Il server valida: un pacchetto senza `hook` e `primaryText` viene rifiutato con
un errore parlante invece di finire mezzo salvato sulla card.

## Nota sul file di stampa

I PNG che escono da Gemini sono ~765×1024: sotto la soglia di stampa. L'upscale
gira sul **PC di Andrea** con Topaz Photo AI (`engine/upscale-batch.mjs`), perché
Topaz non esiste per Linux. Produce `<nome>_print.png` accanto all'originale, e
la web app quando pubblica su Printify usa quello se c'è.
