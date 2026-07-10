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
