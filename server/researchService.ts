/**
 * Orchestrazione SEO & Research: refresh delle fonti, dedup, arricchimento LLM,
 * handoff contenuti all'agente (bridge chat esistente, draft-first).
 * Usato dal router tRPC (web app) e dalle route REST (agente VPS).
 */
import {
  insertResearchItemIfNew, getUnenrichedResearchItems, updateResearchItem,
  getAllUserSettings, upsertUserSetting, getResearchItemById,
  ensureResearchTable, insertSocialDraft, getResearchItems, insertSocialChatMessage,
} from "./db";
import {
  fetchAllResearchSources, enrichResearchItems, researchUrlHash, sanitizeText,
  viralityFromEngagement, fetchRedditComments, extractJson, runResearchLLM,
  DEFAULT_SOURCES, DEFAULT_BRAND_CONTEXT,
  type ResearchSourcesConfig, type FetchedResearchItem, type ResearchSource,
} from "./research";

const ENRICH_BATCH = 12; // item arricchiti dall'LLM per refresh (i più virali)
const COMMENTS_PER_BATCH = 4; // post reddit di cui leggere i commenti a ogni enrich
// Autopilot: soglie ALTE (feedback Andrea: 8/7/7 lasciava passare rumore) + gate
// qualitativo: l'angle non deve suggerire di ignorare, e l'AI può rifiutare (skip)
const AUTOPILOT_MIN_VIRALITY = 8;
const AUTOPILOT_MIN_TARGET = 8;
const AUTOPILOT_MIN_INTEREST = 8;
const AUTOPILOT_MAX_PER_REFRESH = 2;
const NOISE_ANGLE_RE = /rumore|ignorar|fuori target|non rilevante|da evitare|lasciar perdere/i;

export async function getResearchConfig(userId: number): Promise<{ sources: ResearchSourcesConfig; brandContext: string; autopilot: boolean }> {
  const s = await getAllUserSettings(userId);
  let sources = DEFAULT_SOURCES;
  if (s.seo_research_sources) {
    try {
      const parsed = JSON.parse(s.seo_research_sources) as Partial<ResearchSourcesConfig>;
      sources = {
        subreddits: Array.isArray(parsed.subreddits) ? parsed.subreddits : DEFAULT_SOURCES.subreddits,
        newsQueries: Array.isArray(parsed.newsQueries) ? parsed.newsQueries : DEFAULT_SOURCES.newsQueries,
        substacks: Array.isArray(parsed.substacks) ? parsed.substacks : DEFAULT_SOURCES.substacks,
        trendsGeo: typeof parsed.trendsGeo === "string" && parsed.trendsGeo ? parsed.trendsGeo : DEFAULT_SOURCES.trendsGeo,
        pinterestInterestIds: Array.isArray(parsed.pinterestInterestIds) ? parsed.pinterestInterestIds : DEFAULT_SOURCES.pinterestInterestIds,
        blogFeeds: Array.isArray(parsed.blogFeeds) ? parsed.blogFeeds : DEFAULT_SOURCES.blogFeeds,
      };
    } catch {
      // JSON corrotto: si riparte dai default
    }
  }
  return { sources, brandContext: s.seo_brand_context || DEFAULT_BRAND_CONTEXT, autopilot: s.seo_autopilot === "true" };
}

export async function saveResearchConfig(userId: number, cfg: { sources?: ResearchSourcesConfig; brandContext?: string; autopilot?: boolean }): Promise<void> {
  if (cfg.sources) await upsertUserSetting(userId, "seo_research_sources", JSON.stringify(cfg.sources));
  if (cfg.brandContext != null) await upsertUserSetting(userId, "seo_brand_context", cfg.brandContext);
  if (cfg.autopilot != null) await upsertUserSetting(userId, "seo_autopilot", String(cfg.autopilot));
}

/** Scrive gli item (dedup su urlHash); resiliente per-item, raccoglie gli errori DB. */
export async function storeResearchItems(userId: number, items: FetchedResearchItem[]): Promise<{ stored: number; errors: string[] }> {
  let stored = 0;
  const errors: string[] = [];
  for (const it of items) {
    const title = sanitizeText(it.title, 500);
    if (!title) continue;
    // TIMESTAMP MySQL accetta solo date valide nel range 1970-2038
    const t = it.publishedAt instanceof Date ? it.publishedAt.getTime() : NaN;
    const publishedAt = Number.isFinite(t) && t > 0 && t < 2_140_000_000_000 ? it.publishedAt! : null;
    try {
      // TUTTE le colonne esplicite (niente keyword DEFAULT nell'INSERT: TiDB in
      // produzione può rifiutarla dove MySQL la accetta — unica differenza
      // strutturale rispetto agli insert watchlist che funzionano)
      const isNew = await insertResearchItemIfNew({
        userId,
        source: it.source,
        sourceDetail: sanitizeText(it.sourceDetail, 191) ?? null,
        title,
        url: it.url ? sanitizeText(it.url, 2000) : null,
        urlHash: researchUrlHash(it.url, it.title),
        excerpt: sanitizeText(it.excerpt, 1500) ?? null,
        bodyText: sanitizeText(it.fullText, 60_000) ?? null,
        brief: null,
        angle: null,
        commentAnalysis: null,
        viralityScore: Number.isFinite(it.viralityScore) ? it.viralityScore : 5,
        targetScore: null,
        interestScore: null,
        engagement: Number.isFinite(it.engagement) ? it.engagement : 0,
        status: "da_leggere",
        country: (it.country && /^[A-Za-z]{2,8}$/.test(it.country) ? it.country.toUpperCase() : "GLOBAL"),
        publishedAt,
        enrichedAt: null,
        fetchedAt: new Date(),
        createdAt: new Date(),
      });
      if (isNew) stored++;
    } catch (err) {
      // un item malformato non deve far fallire l'intero refresh.
      // Drizzle incapsula l'errore MySQL reale in err.cause: è QUELLO il messaggio utile
      const cause = (err as { cause?: { message?: string; code?: string; sqlMessage?: string } })?.cause;
      const m = cause?.sqlMessage || cause?.message
        || (err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : String(err));
      if (!errors.some((e) => e === m)) errors.push(m);
    }
  }
  if (errors.length) console.warn(`[research] errori insert (${errors.length} distinti):`, errors.slice(0, 3));
  return { stored, errors };
}

/** Arricchisce con l'LLM gli item più virali non ancora valutati (+ commenti Reddit). */
export async function enrichPendingResearch(userId: number, limit = ENRICH_BATCH): Promise<{ enriched: number; items: Array<{ id: number; targetScore: number; interestScore: number }> }> {
  const { brandContext } = await getResearchConfig(userId);
  const pending = await getUnenrichedResearchItems(userId, limit);
  if (pending.length === 0) return { enriched: 0, items: [] };

  // commenti in evidenza per i primi post Reddit del batch (best effort, con pausa anti-429)
  const commentsById = new Map<number, string[]>();
  const redditItems = pending.filter((p) => p.source === "reddit" && p.url).slice(0, COMMENTS_PER_BATCH);
  for (let i = 0; i < redditItems.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      commentsById.set(redditItems[i].id, await fetchRedditComments(redditItems[i].url!));
    } catch {
      // niente commenti: non è bloccante
    }
  }

  const results = await enrichResearchItems(
    pending.map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt, source: p.source, comments: commentsById.get(p.id) })),
    brandContext
  );
  await applyEnrichmentResults(results);
  return { enriched: results.length, items: results.map((r) => ({ id: r.id, targetScore: r.targetScore, interestScore: r.interestScore })) };
}

/** Scrive i risultati di un arricchimento (dal server o dall'agente VPS Claude). */
export async function applyEnrichmentResults(
  results: Array<{ id: number; targetScore: number; interestScore: number; brief?: string; angle?: string; commentAnalysis?: string; engagement?: number }>
): Promise<number> {
  let applied = 0;
  for (const r of results) {
    if (typeof r.id !== "number") continue;
    const engagement = Number(r.engagement);
    await updateResearchItem(r.id, {
      targetScore: Math.max(0, Math.min(10, Math.round(Number(r.targetScore ?? 0)))),
      interestScore: Math.max(0, Math.min(10, Math.round(Number(r.interestScore ?? 0)))),
      brief: sanitizeText(r.brief, 2000) ?? null,
      angle: sanitizeText(r.angle, 2000) ?? null,
      ...(r.commentAnalysis ? { commentAnalysis: sanitizeText(r.commentAnalysis, 2000) ?? null } : {}),
      // l'agente può leggere l'engagement reale (upvote+commenti): aggiorna anche la viralità
      ...(Number.isFinite(engagement) && engagement > 0
        ? { engagement: Math.round(engagement), viralityScore: viralityFromEngagement(Math.round(engagement)) }
        : {}),
      enrichedAt: new Date(),
    });
    applied++;
  }
  return applied;
}

/** Refresh completo: fetch fonti → store → arricchimento LLM del top. */
export async function refreshResearch(userId: number): Promise<{ fetched: number; stored: number; enriched: number; autoGenerated: number; errors: string[]; dbError?: string }> {
  // Assicura la tabella PRIMA di tutto: se manca (o il CREATE fallisce) è QUESTA la causa
  const table = await ensureResearchTable();
  if (!table.ok) {
    return { fetched: 0, stored: 0, enriched: 0, autoGenerated: 0, errors: [`DB: ${table.error}`], dbError: `Creazione tabella fallita: ${table.error}` };
  }
  const { sources, autopilot } = await getResearchConfig(userId);
  // Pinterest costa crediti Apify: gira al massimo 1 volta ogni 20h (i trend
  // cambiano lenti). I refresh manuali ravvicinati riusano i dati già nel DB.
  const settings = await getAllUserSettings(userId);
  const lastPin = Number(settings.seo_pinterest_last_fetch ?? 0);
  const runPinterest = Date.now() - lastPin > 20 * 3_600_000;
  const { items, errors } = await fetchAllResearchSources(sources, { runPinterest });
  if (runPinterest && sources.pinterestInterestIds !== undefined) {
    await upsertUserSetting(userId, "seo_pinterest_last_fetch", String(Date.now()));
  }
  const { stored, errors: insertErrors } = await storeResearchItems(userId, items);
  // se il fetch ha portato item ma NON se ne salva nessuno, l'errore DB è la causa vera
  const dbError = stored === 0 && items.length > 0 && insertErrors.length > 0 ? insertErrors[0] : undefined;
  for (const e of insertErrors) errors.push(`DB: ${e}`);
  let enriched = 0;
  let autoGenerated = 0;
  try {
    const enrichResult = await enrichPendingResearch(userId);
    enriched = enrichResult.enriched;
  } catch (err) {
    errors.push(`AI: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Autopilot DISACCOPPIATO dall'enrichment del server: pesca dal DB i migliori
  // item già arricchiti (anche dall'agente Claude) e non ancora usati
  if (autopilot) {
    try {
      autoGenerated = await runAutopilot(userId);
    } catch (err) {
      errors.push(`Autopilot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { fetched: items.length, stored, enriched, autoGenerated, errors, dbError };
}

/** Ingest dall'agente VPS (Gmail/newsletter/fonti custom). */
export async function ingestResearchItems(
  userId: number,
  items: Array<{
    source?: string; sourceDetail?: string; country?: string; title?: string; url?: string;
    excerpt?: string; fullText?: string; engagement?: number; publishedAt?: string | Date;
  }>
): Promise<number> {
  const valid: FetchedResearchItem[] = items
    .filter((i) => i.title)
    .map((i) => {
      const engagement = Number(i.engagement ?? 0);
      const source = (["reddit", "news", "trends", "substack", "pinterest", "blog", "gmail", "manual"] as ResearchSource[])
        .includes(i.source as ResearchSource) ? (i.source as ResearchSource) : "manual";
      return {
        source,
        sourceDetail: i.sourceDetail,
        country: i.country,
        title: String(i.title).slice(0, 500),
        url: i.url,
        excerpt: i.excerpt?.slice(0, 1500),
        fullText: i.fullText?.slice(0, 60_000),
        viralityScore: viralityFromEngagement(engagement),
        engagement,
        publishedAt: i.publishedAt ? new Date(i.publishedAt) : undefined,
      };
    });
  const { stored } = await storeResearchItems(userId, valid);
  return stored;
}

/**
 * Generazione contenuti SERVER-SIDE (niente dipendenza dall'agente VPS): crea
 * subito le bozze in social_drafts, verificabili nella pagina Bozze.
 * Guardrail anti-traffico-freddo: si parte SEMPRE dall'angle del brand.
 */
export async function generateContentFromResearch(
  userId: number,
  itemId: number,
  formats: Array<"blog" | "x" | "facebook">,
  opts: { rewrite?: boolean; autopilot?: boolean } = {}
): Promise<{ ok: boolean; draftIds?: number[]; delegated?: boolean; skipped?: boolean; error?: string }> {
  const item = await getResearchItemById(itemId);
  if (!item || item.userId !== userId) return { ok: false, error: "Item non trovato" };
  const { brandContext } = await getResearchConfig(userId);
  const wanted = formats.length ? formats : ["blog", "x", "facebook"];

  // Keyword SEO dal Research Hub (Pinterest + trends in target) da integrare nei contenuti
  let seoKeywords = "";
  try {
    const kw = await getResearchItems(userId, { hours: 336, minTarget: 6, sort: "target", limit: 30 });
    seoKeywords = kw
      .filter((k) => (k.source === "pinterest" || k.source === "trends") && k.id !== itemId)
      .slice(0, 10).map((k) => k.title).join(", ");
  } catch {
    // keyword opzionali: senza non si blocca nulla
  }

  const rewriteRules = opts.rewrite
    ? `\nMODALITÀ RISCRITTURA (articolo competitor come ispirazione): NON copiare frasi o struttura pedissequamente — analizza perché l'articolo funziona, poi scrivi un pezzo ORIGINALE del brand sullo stesso tema, migliore e più utile, integrando le KEYWORD SEO fornite in modo naturale (titolo, H2, primi paragrafi).`
    : "";

  const systemPrompt = `Sei il SEO & Content Specialist di questo brand:
${brandContext}

REGOLA VINCOLANTE (anti-traffico-freddo): NON commentare la notizia da divulgatore. Usa la notizia solo come aggancio: il contenuto deve partire dalla CHIAVE DI LETTURA del brand, parlare alla buyer persona con il tone of voice del brand e nutrire il posizionamento. Scrivi in italiano.${rewriteRules}

GATE DI QUALITÀ (obbligatorio, prima di scrivere): se il tema è puro rumore — gossip, cronaca generalista, meteo, sport, politica, o comunque NON collegabile in modo autentico al brand e alla sua buyer persona — NON generare nulla e rispondi SOLO: {"skip": true, "reason": "spiegazione breve"}.

Altrimenti genera SOLO i formati richiesti. Rispondi SOLO con JSON valido:
{
 "blog": {"title": string (titolo SEO con keyword principale), "metaDescription": string (max 155 char), "keywords": string (keyword separate da virgola), "html": string (articolo 800-1200 parole in HTML: <h2>, <h3>, <p>, <ul>; NO <html>/<head>/<body>)},
 "x": {"text": string (max 270 caratteri, hook forte nella prima riga, 1-2 hashtag)},
 "facebook": {"text": string (taglio conversazionale, storytelling breve, domanda di engagement finale, 2-3 hashtag)}
}
Ometti i formati non richiesti.`;
  const userPrompt = `Formati richiesti: ${wanted.join(", ")}

NOTIZIA/TREND DI PARTENZA
Fonte: ${item.source}${item.sourceDetail ? ` · ${item.sourceDetail}` : ""}
Titolo: ${item.title}
${item.brief ? `Brief: ${item.brief}` : ""}
${item.angle ? `CHIAVE DI LETTURA BRAND (da cui partire): ${item.angle}` : ""}
${item.commentAnalysis ? `Linguaggio della conversazione: ${item.commentAnalysis}` : ""}
${item.excerpt ? `Estratto: ${item.excerpt.slice(0, opts.rewrite ? 1400 : 600)}` : ""}
${seoKeywords ? `\nKEYWORD SEO DAL RESEARCH HUB (integra le più pertinenti): ${seoKeywords}` : ""}`;

  let content: string;
  try {
    content = await runResearchLLM(systemPrompt, userPrompt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Nessun motore sincrono sul server → delega all'agente Claude (VPS) via chat
    // bridge: creerà lui le bozze con POST /api/social/draft (draft-first)
    if (/Nessun motore AI/i.test(msg)) {
      await insertSocialChatMessage({
        userId, role: "user", source: "web", status: "new",
        text: `[SEO → CONTENUTO] (research_item #${item.id})${opts.rewrite ? " — MODALITÀ RISCRITTURA da articolo competitor (non copiare: pezzo originale del brand, stesso tema, migliore)" : ""}
Titolo: ${item.title}
${item.url ? `URL: ${item.url}` : ""}
${item.brief ? `Brief: ${item.brief}` : ""}
${item.angle ? `Chiave di lettura brand: ${item.angle}` : ""}
${seoKeywords ? `Keyword SEO da integrare: ${seoKeywords}` : ""}
Crea come BOZZE via POST $SOCIAL_BASE_URL/api/social/draft (header x-care-secret, env in ~/.social-agent.env), una chiamata per formato:
${wanted.includes("blog") ? '- {"platform":"shopify_blog","format":"blog","title":"(titolo SEO)","caption":"(articolo 800-1200 parole in HTML)","hashtags":"(keyword)"}\n' : ""}${wanted.includes("x") ? '- {"platform":"x","format":"post","caption":"(max 270 char, hook in prima riga)"}\n' : ""}${wanted.includes("facebook") ? '- {"platform":"facebook","format":"post","caption":"(conversazionale + domanda finale)"}\n' : ""}Regole: anti-traffico-freddo (parti dalla chiave di lettura, mai la notizia nuda), Brain (viral-playbook, TOV, avatar Aurora). Se il tema è puro rumore fuori nicchia NON creare nulla e dillo in chat. Alla fine rispondi in chat col riepilogo.`,
      });
      await updateResearchItem(itemId, { status: "usato" });
      return { ok: true, delegated: true, draftIds: [] };
    }
    throw err;
  }

  const parsed = extractJson<{
    skip?: boolean; reason?: string;
    blog?: { title?: string; metaDescription?: string; keywords?: string; html?: string };
    x?: { text?: string };
    facebook?: { text?: string };
  }>(content);
  if (!parsed) return { ok: false, error: `Risposta AI non interpretabile (${content.slice(0, 100)})` };

  // Gate di qualità: l'AI ha giudicato il tema rumore → niente contenuti
  if (parsed.skip) {
    if (opts.autopilot) {
      // abbassa l'interesse così l'autopilot non lo riprova al prossimo giro
      await updateResearchItem(itemId, { interestScore: 4 });
    }
    return { ok: false, skipped: true, error: `Scartato dal gate di qualità: ${parsed.reason ?? "rumore fuori nicchia"}` };
  }

  const draftIds: number[] = [];
  const sourceUrl = item.url ?? null;
  if (wanted.includes("blog") && parsed.blog?.html) {
    draftIds.push(await insertSocialDraft({
      userId, platform: "shopify_blog", format: "blog",
      title: sanitizeText(parsed.blog.title, 255) ?? item.title.slice(0, 255),
      caption: sanitizeText(`${parsed.blog.html}\n\n<!-- META DESCRIPTION: ${parsed.blog.metaDescription ?? ""} -->`, 60_000) ?? "",
      hashtags: sanitizeText(parsed.blog.keywords, 1000) ?? null,
      sourceUrl, createdBy: "ai", status: "draft", notes: `Da Research Hub #${item.id} — ${item.sourceDetail ?? item.source}`,
    }));
  }
  if (wanted.includes("x") && parsed.x?.text) {
    draftIds.push(await insertSocialDraft({
      userId, platform: "x", format: "post",
      title: sanitizeText(`X: ${item.title}`, 255) ?? null,
      caption: sanitizeText(parsed.x.text, 2000) ?? "",
      sourceUrl, createdBy: "ai", status: "draft", notes: `Da Research Hub #${item.id}`,
    }));
  }
  if (wanted.includes("facebook") && parsed.facebook?.text) {
    draftIds.push(await insertSocialDraft({
      userId, platform: "facebook", format: "post",
      title: sanitizeText(`FB: ${item.title}`, 255) ?? null,
      caption: sanitizeText(parsed.facebook.text, 5000) ?? "",
      sourceUrl, createdBy: "ai", status: "draft", notes: `Da Research Hub #${item.id}`,
    }));
  }
  if (draftIds.length === 0) return { ok: false, error: "L'AI non ha prodotto nessuno dei formati richiesti" };
  await updateResearchItem(itemId, { status: "usato" });
  return { ok: true, draftIds };
}

/**
 * Autopilot: genera contenuti dai MIGLIORI item arricchiti (da chiunque: server
 * Gemini O agente Claude via research_loop) non ancora usati. Prima era legato
 * solo all'enrichment del server → con l'agente come motore non partiva mai.
 */
async function runAutopilot(userId: number): Promise<number> {
  const candidates = await getResearchItems(userId, {
    hours: 48, status: "da_leggere", minVirality: AUTOPILOT_MIN_VIRALITY,
    minTarget: AUTOPILOT_MIN_TARGET, sort: "best", limit: 20,
  });
  let generated = 0;
  for (const item of candidates) {
    if (generated >= AUTOPILOT_MAX_PER_REFRESH) break;
    if (item.enrichedAt == null) continue; // punteggi non ancora assegnati
    if ((item.interestScore ?? 0) < AUTOPILOT_MIN_INTEREST) continue;
    // gate: se la chiave di lettura dice che è rumore, non sprecare una generazione
    if (item.angle && NOISE_ANGLE_RE.test(item.angle)) continue;
    try {
      const r = await generateContentFromResearch(userId, item.id, ["blog", "x", "facebook"], { autopilot: true });
      if (r.ok) generated++;
    } catch (err) {
      console.warn("[research] autopilot generate fallito:", err);
    }
  }
  return generated;
}
