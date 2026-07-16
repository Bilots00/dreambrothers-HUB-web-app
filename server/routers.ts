import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  getMetaAccountsByUserId, upsertMetaAccount, updateMetaAccountStatus,
  getCampaignsByUserId, getCampaignById, createCampaign, updateCampaign,
  getAdSetsByCampaignId, createAdSet, updateAdSet,
  getAdsByAdSetId, createAd, updateAdStatus,
  getKpiSnapshotsByUserId, getKpiSnapshotsByCampaign, insertKpiSnapshot,
  getGoalsByUserId, getGoalById, createGoal, updateGoal,
  getAgentLogsByUserId, insertAgentLog,
  getAbTestsByUserId, getAbTestById, createAbTest, updateAbTest,
  getAlertsByUserId, insertAlert, markAlertRead, resolveAlert,
  getCopyGenerationsByUserId, insertCopyGeneration, updateCopyGenerationSelection,
  getTrackingConfigByAccount, upsertTrackingConfig,
  getAllUserSettings, upsertUserSetting,
  getCsConversationsForUser, getCsMessagesForConversation, recordCsReply, updateCsConversation, getCsConversationById,
  getSocialChatMessages, insertSocialChatMessage, getSocialDraftsForUser, updateSocialDraft, deleteSocialDraft,
  getWatchlistChannels, deleteWatchlistChannel, getWatchlistVideos, getWatchlistChannelStats, getWatchlistChannelById,
  getWatchlistVideoById, setWatchlistVideoLiked,
  getResearchItems, getResearchItemById, updateResearchItem, getResearchCountries,
} from "./db";
import { addWatchlistChannel, refreshWatchlistChannel, refreshAllWatchlistChannels } from "./watchlistService";
import {
  refreshResearch, enrichPendingResearch, generateContentFromResearch,
  getResearchConfig, saveResearchConfig,
} from "./researchService";
import {
  getAdAccountInfo, getMetaCampaigns, createMetaCampaign,
  getMetaAdSets, createMetaAdSet, getMetaAds,
  updateMetaAdStatus, getAccountInsights, getCampaignInsights,
  getPixels, createPixel, parseInsightKpis,
} from "./metaApi";
import {
  runAccountAudit, generateAdCopy, runOptimizationCycle,
  evaluateAbTest, triggerAlert,
} from "./aiAgent";
import {
  getMissionControlOverview, getCampaignDrawer, getAgentDrawer,
  pauseOrResumeCampaign, setCampaignManaged,
  aiManagerChatList, aiManagerSend, aiManagerConfirmAction, runAgentsCycle,
} from "./metaAgentsService";
import {
  addBrand as addAdBrand, removeBrand as removeAdBrand, listBrands as listAdBrands,
  refreshBrand as refreshAdBrand, refreshAllBrands as refreshAllAdBrands,
  listInspirations, toggleLike as toggleInspirationLike, cloneInspiration,
} from "./adsLibraryService";
import {
  addMarketStore, removeMarketStore, listMarketStores, updateMarketStore,
  getMarketChanges, updateMarketChange,
} from "./db";
import {
  runAllStoresCycle, runStoreMonitorCycle, getMarketConfig, saveMarketConfig, generateOpportunityBrief,
} from "./marketIntelService";
import { normalizeDomain, isShopifyStore } from "./marketIntel";
import { researchEtsyKeyword } from "./etsyIntel";
import {
  addEtsyWatchShop, removeEtsyWatchShop, listEtsyWatchShops, refreshEtsyShop,
  runAllEtsyShops, getEtsyShopDetail, analyzeEtsyShopLive,
} from "./etsyService";

function fmtClock(d: Date | string): string {
  return new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });
}
function fmtWhen(d: Date | string): string {
  const dt = new Date(d);
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  return sameDay ? fmtClock(dt) : dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" });
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── User Settings (persistenza cloud) ──────────────────────────────────────
  settings: router({
    getAll: protectedProcedure.query(async ({ ctx }) => {
      return getAllUserSettings(ctx.user.id);
    }),
    set: protectedProcedure.input(z.object({ key: z.string(), value: z.string() })).mutation(async ({ ctx, input }) => {
      await upsertUserSetting(ctx.user.id, input.key, input.value);
      return { success: true } as const;
    }),
  }),

  // ─── Market Intelligence: Product Market FIT (monitor competitor Shopify) ────
  marketIntel: router({
    listStores: protectedProcedure.query(async ({ ctx }) => listMarketStores(ctx.user.id)),
    addStore: protectedProcedure
      .input(z.object({ label: z.string().min(1), domain: z.string().min(3), frequencyHours: z.number().min(1).max(168).optional(), collections: z.array(z.string()).optional() }))
      .mutation(async ({ ctx, input }) => {
        const domain = normalizeDomain(input.domain);
        const isShop = await isShopifyStore(domain);
        const id = await addMarketStore(ctx.user.id, {
          label: input.label, domain, frequencyHours: input.frequencyHours,
          collectionsFilter: input.collections?.length ? JSON.stringify(input.collections) : null, isShopify: isShop,
        });
        return { success: true, id, isShopify: isShop } as const;
      }),
    removeStore: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await removeMarketStore(ctx.user.id, input.id); return { success: true } as const;
    }),
    updateStore: protectedProcedure
      .input(z.object({ id: z.number(), label: z.string().optional(), frequencyHours: z.number().min(1).max(168).optional(), status: z.enum(["active", "paused"]).optional() }))
      .mutation(async ({ input }) => {
        const patch: { label?: string; frequencyHours?: number; status?: "active" | "paused" } = {};
        if (input.label !== undefined) patch.label = input.label;
        if (input.frequencyHours !== undefined) patch.frequencyHours = input.frequencyHours;
        if (input.status !== undefined) patch.status = input.status;
        await updateMarketStore(input.id, patch); return { success: true } as const;
      }),
    runNow: protectedProcedure.input(z.object({ id: z.number().optional() })).mutation(async ({ ctx, input }) => {
      const r = input.id ? await runStoreMonitorCycle(ctx.user.id, input.id) : await runAllStoresCycle(ctx.user.id);
      return { success: true, ...r } as const;
    }),
    listChanges: protectedProcedure
      .input(z.object({ storeId: z.number().optional(), changeType: z.string().optional(), status: z.string().optional(), minScore: z.number().optional(), hours: z.number().optional(), limit: z.number().optional() }))
      .query(async ({ ctx, input }) => getMarketChanges(ctx.user.id, input)),
    setChangeStatus: protectedProcedure.input(z.object({ id: z.number(), status: z.enum(["nuovo", "letto", "archiviato"]) }))
      .mutation(async ({ input }) => { await updateMarketChange(input.id, { status: input.status }); return { success: true } as const; }),
    getConfig: protectedProcedure.query(async ({ ctx }) => getMarketConfig(ctx.user.id)),
    setConfig: protectedProcedure.input(z.object({ brandContext: z.string().optional(), autopilot: z.boolean().optional(), minScore: z.number().optional(), reviewRate: z.number().optional() }))
      .mutation(async ({ ctx, input }) => { await saveMarketConfig(ctx.user.id, input); return { success: true } as const; }),
    brief: protectedProcedure.input(z.object({ hours: z.number().optional() })).query(async ({ ctx, input }) => ({ brief: await generateOpportunityBrief(ctx.user.id, input.hours) })),
    // Etsy Product Research (metodo Alura calibrato via Firecrawl)
    etsyKeyword: protectedProcedure.input(z.object({ query: z.string().min(2), limit: z.number().min(1).max(60).optional() }))
      .mutation(async ({ input }) => researchEtsyKeyword(input.query, { limit: input.limit })),
    // Analizzatore shop stile Alura (live): stats + top prodotti con vendite per-prodotto
    etsyAnalyze: protectedProcedure.input(z.object({ shop: z.string().min(3), topN: z.number().min(1).max(24).optional() }))
      .mutation(async ({ input }) => analyzeEtsyShopLive(input.shop, input.topN)),
    // Watchlist shop Etsy (monitor automatico dell'AI agent)
    etsyWatchList: protectedProcedure.query(async ({ ctx }) => listEtsyWatchShops(ctx.user.id)),
    etsyWatchAdd: protectedProcedure.input(z.object({ shop: z.string().min(2) })).mutation(async ({ ctx, input }) => {
      const r = await addEtsyWatchShop(ctx.user.id, input.shop); return { success: true, ...r } as const;
    }),
    etsyWatchRemove: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await removeEtsyWatchShop(ctx.user.id, input.id); return { success: true } as const;
    }),
    etsyWatchRefresh: protectedProcedure.input(z.object({ id: z.number().optional() })).mutation(async ({ ctx, input }) => {
      const r = input.id ? await refreshEtsyShop(ctx.user.id, input.id) : await runAllEtsyShops(ctx.user.id);
      return { success: true, ...r } as const;
    }),
    etsyShopDetail: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => getEtsyShopDetail(ctx.user.id, input.id)),
  }),

  // ─── Social Organico: AI Manager chat + Bozze ───────────────────────────────
  social: router({
    chatList: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getSocialChatMessages(ctx.user.id, 100);
      return rows.reverse().map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        source: m.source,
        when: fmtWhen(m.createdAt),
        pending: m.role === "user" && m.status === "new",
      }));
    }),
    chatSend: protectedProcedure.input(z.object({ text: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const id = await insertSocialChatMessage({ userId: ctx.user.id, role: "user", text: input.text, status: "new" });
      return { success: true, id } as const;
    }),
    draftsList: protectedProcedure.query(async ({ ctx }) => {
      return getSocialDraftsForUser(ctx.user.id);
    }),
    draftUpdate: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        caption: z.string().optional(),
        hashtags: z.string().optional(),
        status: z.enum(["draft", "scheduled", "published", "rejected"]).optional(),
        scheduledAt: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const patch: Parameters<typeof updateSocialDraft>[1] = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.caption !== undefined) patch.caption = input.caption;
        if (input.hashtags !== undefined) patch.hashtags = input.hashtags;
        if (input.status !== undefined) patch.status = input.status;
        if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
        await updateSocialDraft(input.id, patch);
        return { success: true } as const;
      }),
    draftDelete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await deleteSocialDraft(input.id);
      return { success: true } as const;
    }),
    config: protectedProcedure.query(async ({ ctx }) => {
      const s = await getAllUserSettings(ctx.user.id);
      return {
        autopilot: s.social_autopilot === "true",
        referenceFolder: s.social_reference_folder || "E:\\IDriveLocal\\ALL FILES -Cloud-Drive_andrea.bilotta00@gmail.com\\E-commerce\\MARKETING - PNL, Copy & Vendita\\Instagram DAILY post (Organic)",
        systemPrompt: s.social_system_prompt || "",
      };
    }),
  }),

  // ─── Watchlist canali competitor (replica Sandcastles, dati gratuiti) ────────
  watchlist: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const [channels, stats] = await Promise.all([
        getWatchlistChannels(ctx.user.id),
        getWatchlistChannelStats(ctx.user.id),
      ]);
      const statsById = new Map(stats.map((s) => [s.channelId, s]));
      return channels.map((c) => ({
        ...c,
        videoCount: Number(statsById.get(c.id)?.videoCount ?? 0),
        views30d: Number(statsById.get(c.id)?.views30d ?? 0),
      }));
    }),

    add: protectedProcedure
      .input(z.object({
        input: z.string().min(1),
        platform: z.enum(["youtube", "instagram", "tiktok"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await addWatchlistChannel(ctx.user.id, input.input, input.platform);
        return result;
      }),

    remove: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const ch = await getWatchlistChannelById(input.id);
      if (!ch || ch.userId !== ctx.user.id) throw new Error("Canale non trovato");
      await deleteWatchlistChannel(input.id);
      return { success: true } as const;
    }),

    refresh: protectedProcedure.input(z.object({ id: z.number().optional() })).mutation(async ({ ctx, input }) => {
      if (input.id) {
        const ch = await getWatchlistChannelById(input.id);
        if (!ch || ch.userId !== ctx.user.id) throw new Error("Canale non trovato");
        return refreshWatchlistChannel(input.id);
      }
      return refreshAllWatchlistChannels(ctx.user.id);
    }),

    videos: protectedProcedure
      .input(z.object({
        channelId: z.number().optional(),
        platform: z.enum(["youtube", "instagram", "tiktok"]).optional(),
        lookbackDays: z.number().min(0).max(730).default(30),
        minOutlier: z.number().min(0).default(0),
        minViews: z.number().min(0).default(0),
        liked: z.boolean().optional(),
        sort: z.enum(["outlier", "views", "recent"]).default("outlier"),
        limit: z.number().min(1).max(200).default(60),
      }))
      .query(async ({ ctx, input }) => {
        return getWatchlistVideos(ctx.user.id, input);
      }),

    // 🩷 → il video entra nella tab Templates (raccolta dei contenuti da remixare)
    toggleLike: protectedProcedure.input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const v = await getWatchlistVideoById(input.id);
        if (!v || v.userId !== ctx.user.id) throw new Error("Video non trovato");
        await setWatchlistVideoLiked(input.id, !v.liked);
        return { success: true, liked: !v.liked } as const;
      }),

    // Remix: manda il contenuto salvato al Social Media Manager / Creative Director
    // (agente VPS) che ne produce la versione on-brand come BOZZA (draft-first).
    requestRemix: protectedProcedure
      .input(z.object({ id: z.number(), note: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const v = await getWatchlistVideoById(input.id);
        if (!v || v.userId !== ctx.user.id) throw new Error("Video non trovato");
        const text = `[WATCHLIST → REMIX] Task organico dal reparto Social Media.
Andrea vuole REMIXARE questo contenuto vincente della watchlist adattandolo ON-BRAND a DreamBrothers (leggi il Brain: brand-voice, viral-playbook, template-creativita, lessico-dreamer, regole-anti-ai; NIENTE false claims, organic ≠ selling: nessun pitch).
REFERENCE:
- Piattaforma: ${v.platform}
- URL: ${v.url}
- Titolo: ${v.title ?? "—"}
- Performance: ${v.views} views${v.outlierScore ? `, outlier ${v.outlierScore}x rispetto alla mediana del canale` : ""}
${input.note ? `NOTE DI ANDREA: ${input.note}` : ""}
DELIVERABLE: mantieni il FORMATO/struttura che fa funzionare il contenuto (hook 0-3s, ritmo, payoff) ma con i nostri contenuti e la nostra voce. Genera hook, script/struttura passo-passo, caption e hashtag, poi salva come bozza via POST $SOCIAL_BASE_URL/api/social/draft. Draft-first: nessuna pubblicazione. Rispondi in chat con una sintesi di 2 righe.`;
        const id = await insertSocialChatMessage({ userId: ctx.user.id, role: "user", text, status: "new", source: "web" });
        return { success: true, id } as const;
      }),

    // Chiede all'AI Manager (agente VPS) la deep-analysis di un video: entra nel
    // thread chat esistente, l'agente risponde e salva via /api/social/watchlist/analysis
    requestAnalysis: protectedProcedure
      .input(z.object({ url: z.string().min(1), title: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const text = `[WATCHLIST → DEEP ANALYSIS]\nAnalizza questo video della watchlist: ${input.url}${input.title ? `\nTitolo: ${input.title}` : ""}\nEstrai: topic, hook (parlato/visivo/testo) + categoria hook, formato storytelling e perché funziona, struttura, CTA, insight non ovvi. Poi salva il JSON con POST /api/social/watchlist/analysis e rispondimi in chat con la sintesi.`;
        const id = await insertSocialChatMessage({ userId: ctx.user.id, role: "user", text, status: "new", source: "web" });
        return { success: true, id } as const;
      }),
  }),

  // ─── SEO & Research: feed di market intelligence (replica WeAreMarketers) ────
  research: router({
    list: protectedProcedure
      .input(z.object({
        source: z.string().optional(),
        status: z.enum(["da_leggere", "salvato", "usato", "cestinato"]).optional(),
        hours: z.number().min(0).max(8760).default(48),
        minVirality: z.number().min(0).max(10).default(0),
        minTarget: z.number().min(0).max(10).default(0),
        search: z.string().optional(),
        country: z.string().optional(),
        limit: z.number().min(1).max(300).default(100),
        sort: z.enum(["best", "virality", "target", "interest", "engagement", "recent"]).default("best"),
      }))
      .query(async ({ ctx, input }) => {
        return getResearchItems(ctx.user.id, input);
      }),

    countries: protectedProcedure.query(async ({ ctx }) => {
      return getResearchCountries(ctx.user.id);
    }),

    refresh: protectedProcedure.mutation(async ({ ctx }) => {
      return refreshResearch(ctx.user.id);
    }),

    setStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["da_leggere", "salvato", "usato", "cestinato"]) }))
      .mutation(async ({ ctx, input }) => {
        const item = await getResearchItemById(input.id);
        if (!item || item.userId !== ctx.user.id) throw new Error("Item non trovato");
        await updateResearchItem(input.id, { status: input.status });
        return { success: true } as const;
      }),

    enrichPending: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const r = await enrichPendingResearch(ctx.user.id, 15);
        return { enriched: r.enriched, queuedForAgent: false, agentOnline: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // niente motore sincrono sul server: il MOTORE PRIMARIO è l'agente VPS
        // (abbonamento Claude) che passa ogni ~3 min sul research_loop
        if (/Nessun motore AI/i.test(msg)) {
          const s = await getAllUserSettings(ctx.user.id);
          const lastSeen = Number(s.social_local_agent_last_seen ?? 0);
          const agentOnline = lastSeen > 0 && Date.now() - lastSeen < 120_000;
          return { enriched: 0, queuedForAgent: true, agentOnline };
        }
        throw err;
      }
    }),

    generateContent: protectedProcedure
      .input(z.object({
        id: z.number(),
        formats: z.array(z.enum(["blog", "x", "facebook"])).default(["blog", "x", "facebook"]),
        rewrite: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        return generateContentFromResearch(ctx.user.id, input.id, input.formats, { rewrite: input.rewrite });
      }),

    getConfig: protectedProcedure.query(async ({ ctx }) => {
      return getResearchConfig(ctx.user.id);
    }),

    saveConfig: protectedProcedure
      .input(z.object({
        sources: z.object({
          subreddits: z.array(z.string()),
          newsQueries: z.array(z.string()),
          substacks: z.array(z.string()),
          trendsGeo: z.string(),
          pinterestInterestIds: z.array(z.string()).default([]),
          blogFeeds: z.array(z.string()).default([]),
        }).optional(),
        brandContext: z.string().optional(),
        autopilot: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await saveResearchConfig(ctx.user.id, input);
        return { success: true } as const;
      }),
  }),

  // ─── Mission Control + AI Manager (team agenti Paid Advertising) ────────────
  metaAgents: router({
    overview: protectedProcedure.query(async ({ ctx }) => getMissionControlOverview(ctx.user.id)),
    campaignDrawer: protectedProcedure.input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => getCampaignDrawer(ctx.user.id, input.campaignId)),
    agentDrawer: protectedProcedure.input(z.object({ code: z.string().min(1) }))
      .query(async ({ ctx, input }) => getAgentDrawer(ctx.user.id, input.code)),
    pauseCampaign: protectedProcedure.input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => pauseOrResumeCampaign(ctx.user.id, input.campaignId, "pause")),
    resumeCampaign: protectedProcedure.input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => pauseOrResumeCampaign(ctx.user.id, input.campaignId, "resume")),
    setManaged: protectedProcedure.input(z.object({ campaignId: z.number(), managed: z.boolean() }))
      .mutation(async ({ ctx, input }) => setCampaignManaged(ctx.user.id, input.campaignId, input.managed)),
    runCycle: protectedProcedure.mutation(async ({ ctx }) => runAgentsCycle(ctx.user.id)),
    chatList: protectedProcedure.query(async ({ ctx }) => aiManagerChatList(ctx.user.id)),
    chatSend: protectedProcedure.input(z.object({ text: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => aiManagerSend(ctx.user.id, input.text)),
    chatConfirm: protectedProcedure.input(z.object({ messageId: z.number(), approve: z.boolean() }))
      .mutation(async ({ ctx, input }) => aiManagerConfirmAction(ctx.user.id, input.messageId, input.approve)),
  }),

  // ─── Ads Inspiration (replica CreativeOS: templates / inspiration / brands) ──
  adsLibrary: router({
    brands: protectedProcedure.query(async ({ ctx }) => listAdBrands(ctx.user.id)),
    addBrand: protectedProcedure
      .input(z.object({ name: z.string().min(1), pageInput: z.string().min(3), category: z.string().optional() }))
      .mutation(async ({ ctx, input }) => addAdBrand(ctx.user.id, input)),
    removeBrand: protectedProcedure.input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => removeAdBrand(ctx.user.id, input.id)),
    // Lo scrape di centinaia di ads dura minuti: si avvia e basta (fire-and-forget),
    // la UI segue lo stato del brand col polling invece di restare appesa.
    refreshBrand: protectedProcedure.input(z.object({ id: z.number().optional() }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const job = input.id != null ? refreshAdBrand(userId, input.id) : refreshAllAdBrands(userId);
        job.catch((err) => console.warn("[AdsLibrary] refresh in background fallito:", err));
        return { started: true } as const;
      }),
    inspirations: protectedProcedure
      .input(z.object({
        q: z.string().optional(),
        brandId: z.number().optional(),
        liked: z.boolean().optional(),
        format: z.string().optional(),
        sort: z.enum(["trending", "newest"]).optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => listInspirations(ctx.user.id, input)),
    toggleLike: protectedProcedure.input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => toggleInspirationLike(ctx.user.id, input.id)),
    clone: protectedProcedure.input(z.object({ id: z.number(), note: z.string().optional() }))
      .mutation(async ({ ctx, input }) => cloneInspiration(ctx.user.id, input.id, input.note)),
  }),

  // ─── Meta Accounts ──────────────────────────────────────────────────────────
  meta: router({
    listAccounts: protectedProcedure.query(async ({ ctx }) => {
      return getMetaAccountsByUserId(ctx.user.id);
    }),

    connectAccount: protectedProcedure.input(z.object({
      accountId: z.string(),
      accountName: z.string(),
      accessToken: z.string(),
    })).mutation(async ({ ctx, input }) => {
      // Verify token by fetching account info
      const info = await getAdAccountInfo(input.accountId, input.accessToken);
      await upsertMetaAccount({
        userId: ctx.user.id,
        accountId: input.accountId,
        accountName: info.name ?? input.accountName,
        accessToken: input.accessToken,
        currency: info.currency ?? "EUR",
        timezone: info.timezone_name ?? "Europe/Rome",
        status: "active",
      });
      await insertAgentLog({
        userId: ctx.user.id,
        actionType: "audit",
        title: `Account META connesso: ${info.name}`,
        reasoning: "Connessione account META completata con successo.",
        impact: "positive", severity: "info",
      });
      return { success: true, accountName: info.name };
    }),

    disconnectAccount: protectedProcedure.input(z.object({ accountId: z.number() })).mutation(async ({ ctx, input }) => {
      await updateMetaAccountStatus(input.accountId, "disconnected");
      return { success: true };
    }),

    syncAccount: protectedProcedure.input(z.object({ metaAccountId: z.number() })).mutation(async ({ ctx, input }) => {
      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts.find(a => a.id === input.metaAccountId);
      if (!account?.accessToken) throw new Error("Account non trovato o token mancante");

      const insights = await getAccountInsights(account.accountId, account.accessToken, "last_30d");
      for (const insight of insights.slice(0, 30)) {
        const kpis = parseInsightKpis(insight);
        await insertKpiSnapshot({
          userId: ctx.user.id,
          metaAccountId: input.metaAccountId,
          snapshotDate: new Date(insight.date_start),
          ...kpis,
          impressions: kpis.impressions,
          clicks: kpis.clicks,
          spend: kpis.spend.toString(),
        conversions: Math.round(kpis.conversions),
        leads: Math.round(kpis.leads),
        reach: kpis.reach,
        frequency: kpis.frequency.toString(),
        ctr: kpis.ctr.toString(),
        cpc: kpis.cpc.toString(),
        cpm: kpis.cpm.toString(),
        cpa: kpis.cpa.toString(),
        cpl: kpis.cpl.toString(),
        roas: kpis.roas.toString(),
        conversionRate: kpis.conversionRate.toString(),
        revenue: kpis.revenue.toString(),
        });
      }
      return { success: true, snapshotsSaved: insights.length };
    }),
  }),

  // ─── KPI Dashboard ──────────────────────────────────────────────────────────
  kpi: router({
    getDashboard: protectedProcedure.input(z.object({ days: z.number().default(30) })).query(async ({ ctx, input }) => {
      const snapshots = await getKpiSnapshotsByUserId(ctx.user.id, input.days);
      const campaigns = await getCampaignsByUserId(ctx.user.id);
      const goals = await getGoalsByUserId(ctx.user.id);
      const unreadAlerts = await getAlertsByUserId(ctx.user.id, true);

      // Aggregate totals
      const totals = snapshots.reduce((acc, s) => ({
        spend: acc.spend + parseFloat(s.spend?.toString() ?? "0"),
        revenue: acc.revenue + parseFloat(s.revenue?.toString() ?? "0"),
        conversions: acc.conversions + (s.conversions ?? 0),
        leads: acc.leads + (s.leads ?? 0),
        clicks: acc.clicks + (s.clicks ?? 0),
        impressions: acc.impressions + (s.impressions ?? 0),
      }), { spend: 0, revenue: 0, conversions: 0, leads: 0, clicks: 0, impressions: 0 });

      const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
      const cpa = totals.conversions > 0 ? totals.spend / totals.conversions : 0;
      const cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
      const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
      const conversionRate = totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0;

      // Daily chart data
      const dailyMap = new Map<string, { date: string; spend: number; revenue: number; conversions: number; roas: number }>();
      for (const s of snapshots) {
        const dateKey = new Date(s.snapshotDate).toISOString().split("T")[0];
        const existing = dailyMap.get(dateKey) ?? { date: dateKey, spend: 0, revenue: 0, conversions: 0, roas: 0 };
        existing.spend += parseFloat(s.spend?.toString() ?? "0");
        existing.revenue += parseFloat(s.revenue?.toString() ?? "0");
        existing.conversions += s.conversions ?? 0;
        dailyMap.set(dateKey, existing);
      }
      const chartData = Array.from(dailyMap.values()).map(d => ({ ...d, roas: d.spend > 0 ? d.revenue / d.spend : 0 })).sort((a, b) => a.date.localeCompare(b.date));

      return {
        kpis: { roas: Math.round(roas * 100) / 100, cpa: Math.round(cpa * 100) / 100, cpl: Math.round(cpl * 100) / 100, ctr: Math.round(ctr * 100) / 100, conversionRate: Math.round(conversionRate * 100) / 100, totalSpend: Math.round(totals.spend * 100) / 100, totalRevenue: Math.round(totals.revenue * 100) / 100, totalConversions: totals.conversions, totalLeads: totals.leads },
        chartData,
        activeCampaigns: campaigns.filter(c => c.status === "ACTIVE").length,
        totalCampaigns: campaigns.length,
        activeGoals: goals.filter(g => g.status === "running").length,
        unreadAlerts: unreadAlerts.length,
      };
    }),

    getCampaignKpis: protectedProcedure.input(z.object({ campaignId: z.number(), days: z.number().default(30) })).query(async ({ ctx, input }) => {
      return getKpiSnapshotsByCampaign(input.campaignId, input.days);
    }),
  }),

  // ─── Campaigns ──────────────────────────────────────────────────────────────
  campaigns: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getCampaignsByUserId(ctx.user.id);
    }),

    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const campaign = await getCampaignById(input.id);
      if (!campaign || campaign.userId !== ctx.user.id) throw new Error("Campagna non trovata");
      const adSets = await getAdSetsByCampaignId(input.id);
      return { campaign, adSets };
    }),

    create: protectedProcedure.input(z.object({
      metaAccountId: z.number(),
      name: z.string(),
      objective: z.enum(["OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_AWARENESS", "OUTCOME_ENGAGEMENT", "OUTCOME_APP_PROMOTION"]),
      dailyBudget: z.number().optional(),
      lifetimeBudget: z.number().optional(),
      budgetLimit: z.number().optional(),
      notes: z.string().optional(),
      publishToMeta: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      let metaCampaignId: string | undefined;

      if (input.publishToMeta) {
        const accounts = await getMetaAccountsByUserId(ctx.user.id);
        const account = accounts.find(a => a.id === input.metaAccountId);
        if (account?.accessToken) {
          const result = await createMetaCampaign(account.accountId, account.accessToken, {
            name: input.name,
            objective: input.objective,
            status: "PAUSED",
            special_ad_categories: [],
            daily_budget: input.dailyBudget ? Math.round(input.dailyBudget * 100) : undefined,
          });
          metaCampaignId = result.id;
        }
      }

      await createCampaign({
        userId: ctx.user.id,
        metaAccountId: input.metaAccountId,
        metaCampaignId,
        name: input.name,
        objective: input.objective,
        status: "DRAFT",
        dailyBudget: input.dailyBudget?.toString(),
        lifetimeBudget: input.lifetimeBudget?.toString(),
        budgetLimit: input.budgetLimit?.toString(),
        notes: input.notes,
      });

      await insertAgentLog({
        userId: ctx.user.id,
        actionType: "campaign_create",
        title: `Campagna creata: ${input.name}`,
        reasoning: `Nuova campagna ${input.objective} creata${metaCampaignId ? " e pubblicata su META" : " in bozza"}.`,
        impact: "positive", severity: "info",
      });

      return { success: true };
    }),

    updateStatus: protectedProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
    })).mutation(async ({ ctx, input }) => {
      const campaign = await getCampaignById(input.id);
      if (!campaign || campaign.userId !== ctx.user.id) throw new Error("Campagna non trovata");
      await updateCampaign(input.id, { status: input.status });
      return { success: true };
    }),

    syncFromMeta: protectedProcedure.input(z.object({ metaAccountId: z.number() })).mutation(async ({ ctx, input }) => {
      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts.find(a => a.id === input.metaAccountId);
      if (!account?.accessToken) throw new Error("Account non configurato");

      const metaCampaigns = await getMetaCampaigns(account.accountId, account.accessToken);
      let synced = 0;
      for (const mc of metaCampaigns) {
        await createCampaign({
          userId: ctx.user.id,
          metaAccountId: input.metaAccountId,
          metaCampaignId: mc.id,
          name: mc.name,
          objective: (mc.objective as typeof import("../drizzle/schema").campaigns.$inferInsert.objective) ?? "OUTCOME_TRAFFIC",
          status: (mc.status as typeof import("../drizzle/schema").campaigns.$inferInsert.status) ?? "PAUSED",
          dailyBudget: mc.daily_budget?.toString(),
          lifetimeBudget: mc.lifetime_budget?.toString(),
        });
        synced++;
      }
      return { success: true, synced };
    }),
  }),

  // ─── Audit AI ───────────────────────────────────────────────────────────────
  audit: router({
    run: protectedProcedure.input(z.object({ metaAccountId: z.number() })).mutation(async ({ ctx, input }) => {
      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts.find(a => a.id === input.metaAccountId);
      if (!account?.accessToken) throw new Error("Account META non configurato. Connetti prima il tuo account.");
      const report = await runAccountAudit(ctx.user.id, input.metaAccountId, account.accessToken, account.accountId);
      return { report };
    }),
  }),

  // ─── Copy Generation ────────────────────────────────────────────────────────
  copyGen: router({
    generate: protectedProcedure.input(z.object({
      objective: z.string(),
      productDescription: z.string(),
      targetAudience: z.string(),
      tone: z.string().default("professionale"),
      campaignId: z.number().optional(),
      campaignContext: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const result = await generateAdCopy({
        userId: ctx.user.id,
        objective: input.objective,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        tone: input.tone,
        campaignContext: input.campaignContext,
      });

      const gen = await insertCopyGeneration({
        userId: ctx.user.id,
        campaignId: input.campaignId,
        prompt: `${input.objective} | ${input.productDescription} | ${input.targetAudience}`,
        objective: input.objective,
        targetAudience: input.targetAudience,
        productDescription: input.productDescription,
        tone: input.tone,
        generatedHeadlines: result.headlines,
        generatedPrimaryTexts: result.primaryTexts,
        generatedDescriptions: result.descriptions,
      });

      await insertAgentLog({
        userId: ctx.user.id,
        campaignId: input.campaignId,
        actionType: "copy_generation",
        title: "Copy pubblicitari generati dall'AI",
        reasoning: `Generati ${result.headlines.length} varianti di copy per obiettivo: ${input.objective}`,
        impact: "positive", severity: "info",
      });

      return { ...result, generationId: gen };
    }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return getCopyGenerationsByUserId(ctx.user.id);
    }),

    selectCopy: protectedProcedure.input(z.object({
      generationId: z.number(),
      headline: z.string(),
      primaryText: z.string(),
      description: z.string(),
    })).mutation(async ({ ctx, input }) => {
      await updateCopyGenerationSelection(input.generationId, input.headline, input.primaryText, input.description);
      return { success: true };
    }),
  }),

  // ─── Goals (Goal-based Agent) ────────────────────────────────────────────────
  goals: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getGoalsByUserId(ctx.user.id);
    }),

    create: protectedProcedure.input(z.object({
      metaAccountId: z.number(),
      title: z.string(),
      description: z.string().optional(),
      goalType: z.enum(["leads", "sales", "registrations", "traffic", "awareness"]),
      targetValue: z.number(),
      targetUnit: z.string().default("count"),
      budgetMax: z.number(),
      campaignId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      await createGoal({
        userId: ctx.user.id,
        metaAccountId: input.metaAccountId,
        title: input.title,
        description: input.description,
        goalType: input.goalType,
        targetValue: input.targetValue.toString(),
        targetUnit: input.targetUnit,
        budgetMax: input.budgetMax.toString(),
        campaignId: input.campaignId,
        status: "pending",
      });
      return { success: true };
    }),

    launch: protectedProcedure.input(z.object({ goalId: z.number() })).mutation(async ({ ctx, input }) => {
      const goal = await getGoalById(input.goalId);
      if (!goal || goal.userId !== ctx.user.id) throw new Error("Obiettivo non trovato");
      if (goal.agentRunning) throw new Error("L'agente è già in esecuzione per questo obiettivo");

      await updateGoal(input.goalId, { status: "running", agentRunning: true, agentStartedAt: new Date() });
      await insertAgentLog({
        userId: ctx.user.id,
        goalId: input.goalId,
        actionType: "goal_started",
        title: `Agente AI lanciato: ${goal.title}`,
        reasoning: `L'agente AI inizia a lavorare autonomamente per raggiungere l'obiettivo: ${goal.goalType} target ${goal.targetValue} ${goal.targetUnit} con budget massimo €${goal.budgetMax}.`,
        impact: "positive", severity: "info",
      });

      // Run first optimization cycle immediately
      await runOptimizationCycle(ctx.user.id, input.goalId);
      return { success: true };
    }),

    pause: protectedProcedure.input(z.object({ goalId: z.number() })).mutation(async ({ ctx, input }) => {
      const goal = await getGoalById(input.goalId);
      if (!goal || goal.userId !== ctx.user.id) throw new Error("Obiettivo non trovato");
      await updateGoal(input.goalId, { status: "paused", agentRunning: false, agentStoppedAt: new Date() });
      await insertAgentLog({
        userId: ctx.user.id, goalId: input.goalId,
        actionType: "optimization",
        title: `Agente AI messo in pausa: ${goal.title}`,
        reasoning: "Supervisore umano ha messo in pausa l'agente AI.",
        impact: "neutral", severity: "warning",
      });
      return { success: true };
    }),

    updateProgress: protectedProcedure.input(z.object({
      goalId: z.number(),
      currentValue: z.number(),
      budgetSpent: z.number(),
    })).mutation(async ({ ctx, input }) => {
      await updateGoal(input.goalId, {
        currentValue: input.currentValue.toString(),
        budgetSpent: input.budgetSpent.toString(),
      });
      return { success: true };
    }),
  }),

  // ─── Agent Logs ─────────────────────────────────────────────────────────────
  agentLogs: router({
    list: protectedProcedure.input(z.object({ limit: z.number().default(100) })).query(async ({ ctx, input }) => {
      return getAgentLogsByUserId(ctx.user.id, input.limit);
    }),
  }),

  // ─── AB Tests ───────────────────────────────────────────────────────────────
  abTests: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getAbTestsByUserId(ctx.user.id);
    }),

    create: protectedProcedure.input(z.object({
      campaignId: z.number(),
      name: z.string(),
      hypothesis: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await createAbTest({
        userId: ctx.user.id,
        campaignId: input.campaignId,
        name: input.name,
        hypothesis: input.hypothesis,
        status: "running",
      });
      await insertAgentLog({
        userId: ctx.user.id, campaignId: input.campaignId,
        actionType: "ab_test_create",
        title: `A/B Test creato: ${input.name}`,
        reasoning: `Nuovo test A/B avviato per campagna ID ${input.campaignId}. Ipotesi: ${input.hypothesis ?? "N/A"}`,
        impact: "neutral", severity: "info",
      });
      return { success: true };
    }),

    evaluate: protectedProcedure.input(z.object({ testId: z.number() })).mutation(async ({ ctx, input }) => {
      const test = await getAbTestById(input.testId);
      if (!test || test.userId !== ctx.user.id) throw new Error("Test non trovato");
      if (!test.variantAAdId || !test.variantBAdId) throw new Error("Varianti non configurate");

      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts[0];
      if (!account?.accessToken) throw new Error("Account META non configurato");

      const result = await evaluateAbTest(ctx.user.id, input.testId, test.variantAAdId, test.variantBAdId, account.accessToken);

      await updateAbTest(input.testId, {
        winnerVariant: result.winner,
        confidenceLevel: result.confidence.toString(),
        statisticalSignificance: result.confidence >= 95,
        status: result.winner !== "inconclusive" ? "completed" : "running",
        conclusionNotes: result.reasoning,
        endDate: result.winner !== "inconclusive" ? new Date() : undefined,
      });

      await insertAgentLog({
        userId: ctx.user.id,
        actionType: "ab_test_evaluate",
        title: `A/B Test valutato: vincitore ${result.winner}`,
        reasoning: result.reasoning,
        actionDetails: { confidence: result.confidence, winner: result.winner },
        impact: result.winner !== "inconclusive" ? "positive" : "neutral",
        severity: "info",
      });

      return result;
    }),
  }),

  // ─── Alerts ─────────────────────────────────────────────────────────────────
  alerts: router({
    list: protectedProcedure.input(z.object({ onlyUnread: z.boolean().default(false) })).query(async ({ ctx, input }) => {
      return getAlertsByUserId(ctx.user.id, input.onlyUnread);
    }),

    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await markAlertRead(input.id);
      return { success: true };
    }),

    resolve: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      await resolveAlert(input.id);
      return { success: true };
    }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      const unread = await getAlertsByUserId(ctx.user.id, true);
      for (const alert of unread) await markAlertRead(alert.id);
      return { success: true, count: unread.length };
    }),
  }),

  // ─── Tracking ───────────────────────────────────────────────────────────────
  tracking: router({
    getConfig: protectedProcedure.input(z.object({ metaAccountId: z.number() })).query(async ({ ctx, input }) => {
      return getTrackingConfigByAccount(input.metaAccountId);
    }),

    saveConfig: protectedProcedure.input(z.object({
      metaAccountId: z.number(),
      pixelId: z.string().optional(),
      pixelName: z.string().optional(),
      capiEnabled: z.boolean().default(false),
      capiAccessToken: z.string().optional(),
      websiteUrl: z.string().optional(),
      trackedEvents: z.array(z.string()).optional(),
    })).mutation(async ({ ctx, input }) => {
      await upsertTrackingConfig({
        userId: ctx.user.id,
        metaAccountId: input.metaAccountId,
        pixelId: input.pixelId,
        pixelName: input.pixelName,
        capiEnabled: input.capiEnabled,
        capiAccessToken: input.capiAccessToken,
        websiteUrl: input.websiteUrl,
        trackedEvents: input.trackedEvents,
      });
      await insertAgentLog({
        userId: ctx.user.id,
        actionType: "tracking_setup",
        title: "Configurazione tracking aggiornata",
        reasoning: `Pixel${input.pixelId ? ` ID: ${input.pixelId}` : ""} e CAPI ${input.capiEnabled ? "abilitati" : "disabilitati"}.`,
        impact: "positive", severity: "info",
      });
      return { success: true };
    }),

    verifyPixel: protectedProcedure.input(z.object({ metaAccountId: z.number() })).mutation(async ({ ctx, input }) => {
      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts.find(a => a.id === input.metaAccountId);
      if (!account?.accessToken) throw new Error("Account META non configurato");

      const pixels = await getPixels(account.accountId, account.accessToken);
      const config = await getTrackingConfigByAccount(input.metaAccountId);

      if (config?.pixelId) {
        const pixel = pixels.find(p => p.id === config.pixelId);
        if (pixel?.last_fired_time) {
          await upsertTrackingConfig({ ...config, pixelInstalled: true, pixelVerifiedAt: new Date(), lastVerifiedAt: new Date() });
          return { verified: true, lastFired: pixel.last_fired_time, pixelName: pixel.name };
        }
      }

      return { verified: false, availablePixels: pixels };
    }),

    getPixels: protectedProcedure.input(z.object({ metaAccountId: z.number() })).query(async ({ ctx, input }) => {
      const accounts = await getMetaAccountsByUserId(ctx.user.id);
      const account = accounts.find(a => a.id === input.metaAccountId);
      if (!account?.accessToken) return [];
      return getPixels(account.accountId, account.accessToken);
    }),
  }),

  // ─── Customer Care (inbox unificata) ─────────────────────────────────────────
  customerCare: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const convos = await getCsConversationsForUser(ctx.user.id);
      const out = [];
      for (const c of convos) {
        const msgs = await getCsMessagesForConversation(c.id);
        const thread = msgs.map(m => ({
          from: m.direction === "in" ? "customer" : (m.sender === "human" ? "you" : "ai"),
          text: m.text,
          time: fmtClock(m.createdAt),
        }));
        const lastIn = [...msgs].reverse().find(m => m.direction === "in");
        const lastOut = [...msgs].reverse().find(m => m.direction === "out");
        out.push({
          id: String(c.id),
          name: c.customerName || c.customerHandle,
          handle: c.customerHandle,
          channel: c.channel,
          status: c.status,
          preview: (lastIn?.text ?? lastOut?.text ?? "").slice(0, 140),
          date: fmtWhen(c.lastMessageAt),
          unread: c.unread,
          starred: c.starred,
          flagReason: c.flagReason ?? undefined,
          aiSuggestion: lastOut?.text ?? "",
          channelUrl: c.channelUrl ?? "",
          thread,
        });
      }
      return out;
    }),

    sendReply: protectedProcedure.input(z.object({
      conversationId: z.number(),
      text: z.string().min(1),
    })).mutation(async ({ input }) => {
      const convo = await getCsConversationById(input.conversationId);
      let sent = false;
      if (convo) {
        const sendUrl = process.env.CS_SEND_URL || "https://primary-production-19a9c.up.railway.app/webhook/cs-send-db";
        try {
          const r = await fetch(sendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-care-secret": process.env.CARE_WEBHOOK_SECRET ?? "" },
            body: JSON.stringify({ channel: convo.channel, to: convo.customerHandle, text: input.text }),
          });
          sent = r.ok;
        } catch {
          sent = false;
        }
      }
      await recordCsReply({ conversationId: input.conversationId, text: input.text, sender: "human", handledBy: "human" });
      return { success: true, sent } as const;
    }),

    markResolved: protectedProcedure.input(z.object({ conversationId: z.number() })).mutation(async ({ input }) => {
      await updateCsConversation(input.conversationId, { status: "ai_handled", unread: false });
      return { success: true } as const;
    }),

    markRead: protectedProcedure.input(z.object({ conversationId: z.number() })).mutation(async ({ input }) => {
      await updateCsConversation(input.conversationId, { unread: false });
      return { success: true } as const;
    }),
  }),
});

export type AppRouter = typeof appRouter;
