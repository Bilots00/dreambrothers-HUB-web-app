# AGENTS.md — Read this first

> Authoritative project facts for any AI / coding agent working on this repo.
> If anything elsewhere (README, `template.json`, code comments) contradicts this file about **hosting**, this file wins.

## 🚂 Hosting & Deployment — Railway (NOT Manus)

- **This app is deployed on [Railway](https://railway.app).** Pushing to the **`main`** branch triggers a Railway build & deploy.
- **Build:** `pnpm build` → `vite build` + esbuild bundle of `server/_core/index.ts` into `dist/`. **Start:** `pnpm start` → `node dist/index.js`.
- **Environment variables live in the Railway project dashboard** (Variables tab), NOT in a committed file. `.env` is git-ignored and used only for local dev.
- ⚠️ **Do NOT assume Manus is the host.** The codebase was originally scaffolded from a Manus "Web App" template — that is why you'll see `template.json`, `vite-plugin-manus-runtime`, `/manus-storage/`, and many "Manus" mentions in `README.md`. The project has since been **migrated to Railway**. Manus is, at most, a provider of some backend services (OAuth, storage, LLM/maps proxy) reached via env vars — **the site itself runs on Railway.**

## Stack

- **Frontend:** React 19 + Vite 7 + Tailwind 4 + shadcn/ui. Routing via **wouter** (NOT react-router).
- **Backend:** Express 4 + tRPC 11 + Drizzle ORM (MySQL / TiDB).
- **Package manager:** **pnpm** (available via `corepack pnpm …`).
- **Toasts:** **sonner** (`import { toast } from "sonner"` → `toast.success(...)` / `toast.error(...)`). There is **no** `@/hooks/use-toast`.
- **Path aliases:** `@/*` → `client/src/*`, `@shared/*` → `shared/*`.

## Where things live

- **Sidebar / navigation:** `client/src/components/DashboardLayout.tsx`. Nav groups: *META Ads*, *Print on Demand*, *Social Organico*, *Customer Care*, *Library*. Each item is `{ icon, label, path, description }`.
- **Routes:** `client/src/App.tsx` — wouter, pattern `<Route path="…">{withLayout(Page)}</Route>`.
- **Pages:** `client/src/pages/`. **Feature components:** `client/src/components/`.

## POD Partners (suppliers)

- **UI:** page `client/src/pages/PodPartners.tsx` → component `client/src/components/PodPartners.tsx`.
- **Route:** `/gelato/pod-partners`, listed under the **"Print on Demand"** sidebar group.
- **What it does:** toggle "Certificato di Autenticità". ON → EU non-Gelato orders route to **Prodigi** (dynamic per-order certificate); OFF → **Printumo** (no certificate).
- **Backend:** Cloudflare Worker **"smistamento-ordini"** — `GET /config` → `{ certEnabled }`, `POST /config` with header `X-CONFIG-KEY`.
- **Env (set in Railway):** `VITE_SMISTAMENTO_URL`, `VITE_SMISTAMENTO_CONFIG_KEY`.
- ⚠️ Note: `VITE_*` vars are embedded in the client bundle, so `VITE_SMISTAMENTO_CONFIG_KEY` is visible in the browser. For real protection, proxy `POST /config` through the server (tRPC) keeping the key server-side.

## Local dev

```bash
corepack pnpm install
corepack pnpm dev        # tsx watch server/_core/index.ts
corepack pnpm check      # tsc --noEmit (typecheck)
```

---

## 🤖 DreamBrothers SMM Agent + Shopify Embed (build in corso — branch `feat/smm-agent`)

> Progetto: automatizzare il Marketing (creative statiche, UGC, post organici) + SEO con un unico **Social Media Manager AI**, pilotabile da **web app + Telegram**, e incastonare questa web app **dentro l'admin Shopify**. Avanzamento/audit: [`PROGRESS.md`](PROGRESS.md). Company Brain (conoscenza brand + regole): `E:\IDriveLocal\ALL FILES -Cloud-Drive_andrea.bilotta00@gmail.com\E-commerce\DreamBrothers Brain`.

**Always-do (convenzioni di questo build):**
- **Draft first** — contenuti generati → tabella `social_drafts`, pubblicati solo dopo review di Andrea.
- **Branch** — si lavora su `feat/smm-agent`; `main` = deploy Railway, si tocca solo ai checkpoint approvati.
- **Segreti** — solo in env (Railway Variables / VPS env / `.env` git-ignored). Mai nel repo.

**Architettura chat (Fase 1).** La social chat NON ha un modello server-side: è un **bridge DB**. La UI scrive in `social_chat_messages` (`role:user, status:new`); un **agente Claude sempre attivo sul VPS** (subscription Max, 0 costi API) fa polling di `GET /api/social/pending`, genera con la skill `social-media-manager` + Brain e risponde su `POST /api/social/reply` (auth: header segreto `CARE_WEBHOOK_SECRET`; utente unico `OWNER_USER_ID=1`). Il bot **Telegram** (`db_smm_bot`) si aggancia allo **stesso** bridge/DB → conversazione unica web+Telegram; colonna `source` (`web`/`telegram`) per distinguere l'origine.

**Fasi:** `0` Fondamenta ✅ · `1` Chat unificata web+Telegram ✅ · `2` Knowledge base ✅ (2.5 Kie.ai/qualità ✅ · 2.6 Watchlist ⏳ GO) · `3` Embed Shopify (Dev Dashboard app + App Bridge + CSP `frame-ancestors`) · `4` Skill video Higgsfield (`product-to-ad`, `url-to-ad`, `ig-carousel`).

**Watchlist (Fase 2.6 — replica Sandcastles).** Pagina `/social/watchlist` (sidebar *Social Organico*): canali competitor YouTube/Instagram/TikTok con **outlier score** (views ÷ mediana canale, finestra 90gg). Dati: YouTube nativo (`YOUTUBE_API_KEY` opzionale su Railway, altrimenti scraping `lockupViewModel`); IG/TikTok best-effort server-side con fallback **ingest dall'agente VPS**. Codice: `server/watchlist.ts` (fetcher), `server/watchlistService.ts` (orchestrazione), router tRPC `watchlist`, REST `server/_core/watchlistRoutes.ts` (`/api/social/watchlist/channels|videos|refresh|ingest|analysis`, auth `x-care-secret` come il bridge social). La skill per l'agente VPS (outlier pulse giornaliero, riparazione canali in errore, deep-analysis on demand) è in `references/skills/smm-watchlist.md`.

## 🎵 Music Studio (`/music/studio`, `/music/libreria`)

Musica e SFX **generati sul server** (zero costi, nessuna API esterna, audio di proprieta' di Andrea): motore `server/music/engine.ts` (porta di "Cloud Drift"), effetti `server/music/sfx.ts`, render + cancelli di qualita' (LUFS, true peak, silenzi, giunzione loop) in `server/music/render.ts` / `dsp.ts`, eseguiti in un worker thread (`dist/music-worker.js`, bundlato a parte nello script `build`). Dipende da `node-web-audio-api` (nativo: su Linux vuole `libasound.so.2` → `railpack.json` installa `libasound2t64`) e `@breezystack/lamejs`. Audio nel DB a pezzi da 1 MB (`music_tracks` + `music_chunks`). Batch notturno 03:30 Europe/Rome (`scheduler.ts`). Dream Map legge `GET /api/focuslock/music/manifest`: contratto in [`docs/music-dreammap.md`](docs/music-dreammap.md).

