# PROGRESS.md — Audit log · build "SMM Agent + Shopify Embed"

> Log cronologico di OGNI modifica ai file e OGNI chiamata API rilevante per il progetto di automazione Marketing/SEO di DreamBrothers.
> **Repo web app:** `Bilots00/meta-ai-media-buyer` — deploy **Railway** a ogni push su `main`.
> **Company Brain** (conoscenza brand): `E:\IDriveLocal\ALL FILES -Cloud-Drive_andrea.bilotta00@gmail.com\E-commerce\DreamBrothers Brain`
> Costituzione: `CLAUDE.md` (Brain) · Mappa: `HOME.md` · AI OS: `self/ai-os.md` · Lavagna task: `areas/comando/task-audit.md`

## Convenzioni (always-do)
- **Draft first** — niente pubblicato (post, prodotti, sconti, invii) senza review di Andrea. Contenuti generati → tabella `social_drafts`.
- **Branch di lavoro** — tutto su `feat/smm-agent`; merge su `main` (= deploy Railway) solo ai checkpoint approvati.
- **Segreti in env** — token/chiavi solo in variabili d'ambiente (Railway Variables · `.env` locale git-ignored · env del VPS). MAI nel repo.
- **Vendite vere** — numeri solo da gateway reali (Shopify Payments/PayPal); esclusi ordini test/draft/manual.
- **Brand voice** — prima di ogni copy passa dal reparto Copywriting del Brain (regole anti-AI, lessico dreamer, un avatar).

## Roadmap (5 fasi) — dettaglio in `AGENTS.md` → sez. "DreamBrothers SMM Agent + Shopify Embed"
`Fase 0` Fondamenta · `Fase 1` Chat unificata web+Telegram · `Fase 2` Knowledge base · `Fase 3` Embed Shopify · `Fase 4` Skill video (Higgsfield)

---

## Log

### 2026-07-09 — Fase 0 (Fondamenta)
**Decisioni approvate (Andrea):** ordine consigliato; chat unificata web+Telegram (Claude Cowork = link/scorciatoia, non specchio live).

**Ricerca (agenti):**
- La social chat della web app usa già un **bridge DB**, non un modello server-side: la UI scrive in `social_chat_messages` (`role:user, status:new`), un agente Claude esterno fa polling di `GET /api/social/pending` e risponde su `POST /api/social/reply` (auth: header `CARE_WEBHOOK_SECRET`; utente unico `OWNER_USER_ID=1`). Telegram **assente** → punto d'innesto pronto.
- Shopify: l'embed in admin richiede una **vera app** (Dev Dashboard) con App Bridge + header CSP `frame-ancestors https://<shop>.myshopify.com https://admin.shopify.com` — NON la "custom app" da *Develop apps* (che dà solo token API).
- Video YouTube (RwAlED_68Ao, R. Belli Contarini): MCP **Higgsfield (Xfield)** + 4 skill (`setup-xfield-project`, `product-to-ad`, `url-to-ad`, `ig-carousel`) — **già installate/collegate** in sessione (`higgsfield-cowork-pack` + MCP Higgsfield).

**Modifiche:**
- Creato branch `feat/smm-agent`.
- Creato `PROGRESS.md` (questo file).
- Esteso `AGENTS.md` (sezione "DreamBrothers SMM Agent + Shopify Embed").
- Aggiornato `CLAUDE.md` (puntatori a PROGRESS/AGENTS).
- Brain: creato `scripts/brain-autosync.ps1` + task `DreamBrothers_Brain_AutoSync` (commit+push ogni 15 min se ci sono modifiche; log in `%LOCALAPPDATA%\DreamBrothers`). ✅ collaudato (push OK).

### 2026-07-09 — Fase 1 (Chat unificata web+Telegram) — modifiche web app [su branch, non ancora deployate]
**Scoperta VPS:** il poller esiste già (`claude-bot-workspace/social-agent/social_agent.py` + `~/.social-agent.env`: `CARE_WEBHOOK_SECRET`, `SOCIAL_BASE_URL`, poll, modello) ma è **spento** (non installato come servizio; nel log un vecchio crash `Connection reset`). Il bot Telegram generale `claude-bot.service` gira. Web app **ONLINE** (HTTP 200), secret OK, systemPrompt SMM già configurato (organic-first, @gernucci, HyperDopamine).
**Modifiche web app (`feat/smm-agent`, +59/-7, typecheck pulito sui file toccati):**
- `drizzle/schema.ts` + `server/_core/index.ts`: colonna `source` (`web`|`telegram`) su `social_chat_messages` + migrazione additiva **idempotente** al boot (guardia su information_schema).
- `server/db.ts`: `getPendingSocialChat` restituisce `source`; `recordSocialChatReply` accetta `replyToId`/`source` → marca il singolo messaggio (niente race web/telegram).
- `server/_core/socialRoutes.ts`: nuovo `POST /api/social/ingest` (secret) per iniettare i messaggi Telegram nello **stesso** thread; `/reply` accetta `replyToId`/`source`.
- `server/routers.ts`: `chatList` espone `source` alla UI.
**Nota deploy VPS:** `claude-bot-workspace` è **pull-only** (deploy key read-only; cron sync ogni 5 min + keepalive social-agent ogni 1 min). Le modifiche a `social_agent.py` si pushano da PC → `git pull` sul VPS.
**In attesa di GO go-live:** (1) merge `feat/smm-agent`→`main` = deploy Railway; (2) aggiornare `social_agent.py` (listener Telegram `db_smm_bot` + gestione `source`); (3) token bot in `~/.social-agent.env`; (4) accendere il social-agent.

### 2026-07-10 — Fase 1 GO-LIVE ✅ COMPLETATA E VERIFICATA
- Deploy web app su `main` (Railway, commit merge `1200880`). Migrazione `source` OK (HTTP 200 su `/api/social/pending`).
- `social_agent.py` v2 (Telegram + thread unico + nudge) pushato su `Bilots00/claude-bot-VPS-workspace` (commit `7b71e96`), pull sul VPS. **Restart eseguito da Andrea** (l'avvio dell'agente `bypassPermissions` è gated per la sicurezza → lo fa lui).
- Bloccante risolto: `db_smm_bot` aveva un **webhook n8n** → **disattivato** (non eliminato) il workflow `DreamBrothers UGC Telegram (Immagini)` (id `vqEeZzVxV3ZaSq18`) → webhook liberato (`getWebhookInfo url:""`), `getUpdates` ok.
- **Test end-to-end OK**: ingest `source=telegram` → `claude -p` (sonnet, 11s) → reply nel thread + inviata su Telegram (owner `440669255`). Log: `replied to msg=17 src=telegram`.
- Stato: web `/social/chat` + Telegram `db_smm_bot` = **conversazione unica LIVE**, sempre attiva sul VPS, costo LLM 0 (subscription Max). `SOCIAL_POLL_INTERVAL=5`.
- `.social-agent.env` (VPS): aggiunto `SMM_TELEGRAM_BOT_TOKEN`; `TELEGRAM_OWNER_ID` riusato da `.bot.env`.

### Metodo GPT Image 2.0 catturato (dal workflow n8n `vqEeZzVxV3ZaSq18`) — per Fase 1.5
- OpenAI images: model `gpt-image-2`, operation **edit** (foto prodotto come reference), size `1024x1536`, quality `high`.
- Prompt UGC: *"Ultra-realistic UGC-style vertical 9:16 photo... a real, relatable person naturally holding and using the exact product shown in the reference image... Scene: {caption}. Candid iPhone photo aesthetic, natural lighting, shallow depth of field, photorealistic, no text, no watermark."*
- Output PNG → Telegram + Google Drive (My Assets). Credenziale: `OPENAI_API_KEY` (già in `~/.bot.env` sul VPS).

### Prossimo — Fase 1.5: UGC da immagine in Telegram (2 modalità richieste da Andrea)
- `/gpt-image-2.0` + foto prodotto + prompt → **GPT Image 2.0** (metodo n8n sopra, replicato in Python nell'agente).
- default (senza comando) → **Higgsfield MCP** (metodo R. Belli Contarini dal video).

### 2026-07-10 — Fase 2 (Knowledge base) ✅ integrata
- 3 agenti paralleli hanno analizzato le cartelle marketing: *Instant Viral Templates 3.0* (3 famiglie di format, Lazy Viral = workhorse), *TOP Brands Inspiration* (@inspirationation00 quote-come-oggetto, @ispirazione.ita caroselli nostalgici open-loop), *Lumonboy* (schema JSON 9-campi per UGC dream-home + rotazione 4 scene).
- **Brain** (repo `Bilots00/dreambrothers-brain`, auto-commit+push del MCP): creato `areas/marketing/viral-playbook.md`; arricchito `areas/design/template-creativita.md` (schema immagini UGC 9-campi); agganciato a `_hub-marketing`; `log.md` aggiornato.
- **Agente SMM**: `social_system_prompt` aggiornato (1364 char) → consulta il Brain (`viral-playbook`, `template-creativita`, `banca-hook`) prima di creare contenuti. Verificato (`HAS viral-playbook: True`). **Live senza restart** (letto da `/api/social/config` ogni ciclo).
- Verificato inoltre: il `claude` del VPS ha i connettori MCP `Higgsfield`, `Google Drive`, `Canva`, `Blotato`, `dreambrothers-brain`, `Shopify`, `Notion` (✔ Connected).
- ⚠️ Sicurezza: `claude mcp list` ha esposto un token Admin Shopify (`shpat_...`) e il dominio backend `aa3csa-zv.myshopify.com` — da rigenerare (decisione di Andrea).

### 2026-07-11 — Fase 2.5 (qualità + costi): Kie.ai, fable-mode, reference-first, prompt-master
**Contesto:** test Cowork di Andrea disastroso (carosello auto-testato dal setup senza reference: testo illeggibile, watermark Higgsfield, luce irreale). Richieste: /gpt-image-2.0 via Kie.ai (stesso modello, costo minore); garanzie fable-mode/reference-first/prompt-master su Cowork + VPS + webapp.
**Kie.ai (validato end-to-end con chiamate REST reali):** `POST /api/v1/jobs/createTask` model `gpt-image-2-image-to-image` → poll `GET /api/v1/jobs/recordInfo` → `state:success`, `resultJson.resultUrls[0]`. Task di test: 41s, **6 crediti ≈ $0.03** (vs ~$0.19 OpenAI high = ~6x risparmio). Chiave trovata in claude_desktop_config.json (`kie-ai` MCP) → copiata in `~/.social-agent.env` sul VPS (`KIE_API_KEY`).
**social_agent.py v4** (workspace commit `2f813eb`, rebase su commit Jordan `bb102b4`): `/gpt-image-2.0` → Kie primario (URL file Telegram, aspect 2:3) con fallback API OpenAI; `CLAUDE_MODEL_CONTENT=opus` per creazione contenuti ([GENERAZIONE CONTENUTO] e flusso Higgsfield) mentre la chat veloce resta sonnet (model-policy regola 13); prompt Higgsfield ora impone fable-mode + reference-first + quality gates.
**Skill sul VPS:** copiate `fable-mode` e `prompt-master` (dal plugin anthropic-skills) in `claude-bot-workspace/skills/` → visibili via symlink `~/.claude/skills`. Reference visive (19 img, 2 stili: @inspirationation00, @ispirazione.ita) sincronizzate in `social-agent/reference/`.
**Cowork:** esteso il CLAUDE.md del progetto (`...\TOP Brands Inspiration (...)\CLAUDE.md`) con sezione "Regole aggiuntive VINCOLANTI": fable-mode sempre, REFERENCE-FIRST (mai inventare da zero, mai auto-test), prompt-master, Brain-first, 4 quality gates immagini.
**System prompt agente:** aggiornato con la stessa disciplina (verificato: fable/prompt-master/REFERENCE-FIRST presenti). Live al prossimo ciclo di poll; il nuovo CODICE richiede restart (Andrea).
**Nota watermark:** la filigrana Higgsfield dei test Cowork dipende dal piano/asset preview — i quality gates ora vietano la consegna di immagini watermarked.

### 2026-07-15 — Fase 2.6 (Watchlist Sandcastles-style) — su `feat/smm-agent`, in attesa di GO
**Obiettivo (Andrea):** replicare la funzione **watchlist** di Sandcastles.ai (dal video Kallaway `Cnk9NQ8JpCs`) dentro *Social Organico* — canali competitor YouTube/Instagram/TikTok, feed video con **outlier score**, senza abbonamenti.
**Architettura (fonte dati gratuita, 3 livelli):**
1. **YouTube**: Data API v3 se `YOUTUBE_API_KEY` è su Railway (gratis, 10k unità/g), altrimenti scraping `ytInitialData` (nuovo formato `lockupViewModel` 2024+) — ✅ testato live: 48 video di @kallawaymarketing con views/date, zero chiavi.
2. **Instagram/TikTok**: tentativo server-side (web_profile_info / __UNIVERSAL_DATA_FOR_REHYDRATION__) con degradazione elegante — dai datacenter Railway spesso bloccano (verificato: IG 429, TikTok shield).
3. **Fallback garantito**: l'**agente VPS** scrapea e spinge i dati via `POST /api/social/watchlist/ingest` (stesso pattern bridge, stesso secret) — skill pronta in `references/skills/smm-watchlist.md` (replica di watchlist-outliers/all-recent/analyze_video di Kallaway puntata alla nostra API).
**Outlier score** (semantica Sandcastles): views video ÷ mediana views canale (finestra 90gg, fallback storico se <3 video). Ricalcolato a ogni refresh/ingest.
**Modifiche web app:**
- `drizzle/schema.ts` + boot-migration idempotente in `server/_core/index.ts`: tabelle `watchlist_channels` + `watchlist_videos` (UNIQUE canale/video, `analysisJson` per la deep-analysis).
- `server/watchlist.ts` (fetcher 3 piattaforme + parser input URL/@handle + outlier/engagement) · `server/watchlistService.ts` (orchestrazione refresh/ingest) · helpers in `server/db.ts`.
- `server/routers.ts`: router tRPC `watchlist` (list/add/remove/refresh/videos/requestAnalysis — quest'ultima inietta `[WATCHLIST → DEEP ANALYSIS]` nel thread chat esistente → la fa l'agente VPS a costo 0).
- `server/_core/watchlistRoutes.ts`: REST per agente/n8n — `GET/POST /api/social/watchlist/*` (channels, videos ≈ `search_my_videos`, refresh, ingest, analysis) — auth `x-care-secret`.
- UI: `client/src/pages/SocialWatchlist.tsx` (feed con badge outlier ⚡, filtri periodo/piattaforma/soglia, sidebar watchlist con follower/views 30g, refresh/rimuovi/export CSV, bottone "Analizza" → AI Manager) + rotta `/social/watchlist` + voce sidebar (icona Radar).
**Verifiche:** typecheck pulito (restano solo i 4 errori pre-esistenti Settings.tsx/vite.config.ts) · vitest 24/24 (11+1 nuovi test su parser/outlier) · boot server OK con route registrate e gate secret funzionante · fetch live YouTube OK.
**Per il GO-LIVE:** (1) merge su `main` (le tabelle si creano da sole al boot Railway); (2) opzionale `YOUTUBE_API_KEY` nelle Railway Variables per dati YT più precisi; (3) aggiungere la skill watchlist all'agente VPS (`references/skills/smm-watchlist.md`) + task giornaliero refresh+outlier-pulse.

### 2026-07-15 — Watchlist: fix produzione (thumbnail + Instagram/TikTok via Apify)
- **Thumbnail nere**: gli Shorts di YouTube non espongono la thumbnail nel nuovo JSON (48/78 video NULL) → URL canonica `i.ytimg.com/vi/{id}/hqdefault.jpg` sia server-side sia come fallback client (ripara anche i dati vecchi senza refresh).
- **Instagram**: il fetch web anonimo è morto ovunque (429 anche da IP residenziale, pagina anonima = login wall). Catena di fallback implementata: scrape → **Apify** → Graph API `business_discovery` (token Meta già collegato). Apify testato via MCP: `apify/instagram-profile-scraper` = $0.0026/profilo (tier FREE, $5/mese inclusi ≈ 1.900 refresh) — @gernucci: 164K follower + 12 post con like/commenti/thumbnail. Outlier IG calcolato sui like (business_discovery/profile-scraper non espongono le views dei reel).
- **TikTok**: stesso fallback con `clockworks/tiktok-profile-scraper` (25 video/refresh, ~$0.075).
- **Da fare (Andrea)**: copiare il token da console.apify.com → Settings → API & Integrations → e crearlo su Railway come variabile `APIFY_TOKEN`.
- Deploy: `a58b243` + `c109a35` su main.

### 2026-07-15 — Fase 2.7: SEO & Research Hub (replica dashboard WeAreMarketers)
- Analizzato il video Mastermind (2Yq4Vq_W-Sw, 1:24:43-1:31:28): dashboard Vignali (Gmail/news/Reddit/Substack → viralità/in-target/interesse 0-10 → brief + chiave di lettura + genera contenuti) + **lezione anti-traffico-freddo**: la notizia nuda fa rumore e non porta clienti; il contenuto deve partire dall'angle del brand.
- **Decisione architetturale**: feed = infrastruttura condivisa (DB + REST `x-care-secret`), operatore primario = AI **SEO Specialist** (blog Shopify + X + Facebook), consumatori: SMM, futuro Market Intelligence Strategist (file mansioni in HR_ Dream_TEAM), Brain (solo sintesi durevoli).
- **Implementato**: tabella `research_items` (punteggi viralità euristica + target/interesse via `invokeLLM` gemini-flash con brand context configurabile); fonti gratuite Reddit `.rss` (i .json sono 403 senza OAuth), Google News RSS, Google Trends RSS, Substack RSS; pagina `/seo/research` (nuovo gruppo sidebar **SEO & Research** dopo Social Organico) con filtri, punteggi, modal brief/chiave di lettura, config fonti, "Genera contenuti" → messaggio `[SEO → CONTENUTO]` nel bridge chat → bozze blog+X+FB (draft-first); REST `/api/seo/research/*` (items/refresh/enrich/ingest/status) per agente VPS; skill in `references/skills/seo-research.md`.
- Verificato live: GNews 15 item, GTrends 10, Reddit .rss ok (429 se paralleli → serializzati con pausa 1.2s), Substack blocca da IP consumer (gestito con errore chiaro + ingest agente). Typecheck pulito, vitest 29/29.
