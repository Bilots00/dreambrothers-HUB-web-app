# Skill agente VPS — SEO & Research Hub (replica dashboard WeAreMarketers)

> Feed di market intelligence condiviso (Reddit, Google News, Google Trends, Substack
> + ingest custom). Operatore primario: **AI SEO Specialist** (articoli blog Shopify,
> post X e Facebook). Consumatori: SMM, futuro Market Intelligence Strategist, Brain.

## API (auth: header `x-care-secret: $CARE_WEBHOOK_SECRET`, base `$SOCIAL_BASE_URL`)

| Endpoint | Uso |
|---|---|
| `GET /api/seo/research/items?hours=48&min_virality=7&min_target=6&source=&status=&limit=50` | feed filtrato — ritorna `items[]` con `title, url, brief, angle, virality_score, target_score, interest_score, status` |
| `POST /api/seo/research/refresh` | scansiona le fonti + arricchimento AI (da schedulare 2x/giorno) |
| `POST /api/seo/research/enrich` | solo arricchimento AI degli item non valutati |
| `POST /api/seo/research/ingest` body `{items:[{source:"gmail", sourceDetail?, title, url?, excerpt?, fullText?, engagement?, publishedAt?}]}` | spingi item da Gmail/newsletter/fonti che il server non raggiunge |
| `POST /api/seo/research/status` body `{id, status: da_leggere\|salvato\|usato\|cestinato}` | aggiorna lo stato |

## ⚠️ Regola d'oro (lezione anti-traffico-freddo dal video Mastermind)

*"Se vai virale con le notizie, la gente non si attacca alla tua persona... non stai
nutrendo il tuo posizionamento, stai alimentando rumore che non ti porta clienti."*

Quindi: **mai** creare contenuti dalla notizia nuda. Filtra per `target_score >= 6`,
parti sempre dall'`angle` (chiave di lettura brand) e aggancia valori/esperienza
DreamBrothers (Brain: viral-playbook, tone of voice, avatar Aurora). Un item molto
virale ma fuori target (`target_score < 5`) si ignora o si cestina.

## Task 1 — Morning brief SEO (schedulato, dopo il refresh)

1. `POST /api/seo/research/refresh`
2. `GET /api/seo/research/items?hours=24&min_target=6&limit=10`
3. Rispondi in chat (`POST /api/social/reply`) con i 5 migliori: `[VIR x · TARG y] titolo — angle in una riga — url`.

## Task 2 — Quando arriva `[SEO → CONTENUTO]` in chat

Il messaggio contiene titolo, url, brief e angle di un research_item. Crea e salva
come **bozze** (`POST /api/social/draft`, mai pubblicare):
- **Articolo blog Shopify**: SEO-first — keyword principale nel titolo/H1, secondarie
  negli H2, 800-1200 parole, meta description; `platform:"shopify_blog"`, `format:"blog"`,
  caption = articolo completo in markdown.
- **Post X**: hook nella prima riga, ≤280 char (o mini-thread); `platform:"x"`, `format:"post"`.
- **Post Facebook**: conversazionale, domanda finale di engagement; `platform:"facebook"`, `format:"post"`.
Poi rispondi in chat col riepilogo delle bozze create.

## Task 3 — Ingest Gmail/newsletter (quotidiano)

Leggi le newsletter di settore dalla Gmail, estrai le notizie rilevanti e spingile
con `POST /api/seo/research/ingest` (`source:"gmail"`, `sourceDetail` = nome newsletter).
Il server le deduplica e le fa valutare all'AI al prossimo enrich.
