/**
 * Orchestrazione SEO & Research: refresh delle fonti, dedup, arricchimento LLM,
 * handoff contenuti all'agente (bridge chat esistente, draft-first).
 * Usato dal router tRPC (web app) e dalle route REST (agente VPS).
 */
import {
  insertResearchItemIfNew, getUnenrichedResearchItems, updateResearchItem,
  getAllUserSettings, upsertUserSetting, insertSocialChatMessage, getResearchItemById,
} from "./db";
import {
  fetchAllResearchSources, enrichResearchItems, researchUrlHash,
  viralityFromEngagement, DEFAULT_SOURCES, DEFAULT_BRAND_CONTEXT,
  type ResearchSourcesConfig, type FetchedResearchItem, type ResearchSource,
} from "./research";

const ENRICH_BATCH = 12; // item arricchiti dall'LLM per refresh (i più virali)

export async function getResearchConfig(userId: number): Promise<{ sources: ResearchSourcesConfig; brandContext: string }> {
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
      };
    } catch {
      // JSON corrotto: si riparte dai default
    }
  }
  return { sources, brandContext: s.seo_brand_context || DEFAULT_BRAND_CONTEXT };
}

export async function saveResearchConfig(userId: number, cfg: { sources?: ResearchSourcesConfig; brandContext?: string }): Promise<void> {
  if (cfg.sources) await upsertUserSetting(userId, "seo_research_sources", JSON.stringify(cfg.sources));
  if (cfg.brandContext != null) await upsertUserSetting(userId, "seo_brand_context", cfg.brandContext);
}

/** Scrive gli item (dedup su urlHash); ritorna quanti sono nuovi. */
export async function storeResearchItems(userId: number, items: FetchedResearchItem[]): Promise<number> {
  let stored = 0;
  for (const it of items) {
    if (!it.title) continue;
    const isNew = await insertResearchItemIfNew({
      userId,
      source: it.source,
      sourceDetail: it.sourceDetail?.slice(0, 191) ?? null,
      title: it.title,
      url: it.url ?? null,
      urlHash: researchUrlHash(it.url, it.title),
      excerpt: it.excerpt ?? null,
      fullText: it.fullText ?? null,
      viralityScore: it.viralityScore,
      engagement: it.engagement,
      publishedAt: it.publishedAt ?? null,
    });
    if (isNew) stored++;
  }
  return stored;
}

/** Arricchisce con l'LLM gli item più virali non ancora valutati. */
export async function enrichPendingResearch(userId: number, limit = ENRICH_BATCH): Promise<number> {
  const { brandContext } = await getResearchConfig(userId);
  const pending = await getUnenrichedResearchItems(userId, limit);
  if (pending.length === 0) return 0;
  const results = await enrichResearchItems(
    pending.map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt, source: p.source })),
    brandContext
  );
  for (const r of results) {
    await updateResearchItem(r.id, {
      targetScore: r.targetScore,
      interestScore: r.interestScore,
      brief: r.brief,
      angle: r.angle,
      enrichedAt: new Date(),
    });
  }
  return results.length;
}

/** Refresh completo: fetch fonti → store → arricchimento LLM del top. */
export async function refreshResearch(userId: number): Promise<{ fetched: number; stored: number; enriched: number; errors: string[] }> {
  const { sources } = await getResearchConfig(userId);
  const { items, errors } = await fetchAllResearchSources(sources);
  const stored = await storeResearchItems(userId, items);
  let enriched = 0;
  try {
    enriched = await enrichPendingResearch(userId);
  } catch (err) {
    errors.push(`LLM enrichment: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { fetched: items.length, stored, enriched, errors };
}

/** Ingest dall'agente VPS (Gmail/newsletter/fonti custom). */
export async function ingestResearchItems(
  userId: number,
  items: Array<{
    source?: string; sourceDetail?: string; title?: string; url?: string;
    excerpt?: string; fullText?: string; engagement?: number; publishedAt?: string | Date;
  }>
): Promise<number> {
  const valid: FetchedResearchItem[] = items
    .filter((i) => i.title)
    .map((i) => {
      const engagement = Number(i.engagement ?? 0);
      const source = (["reddit", "news", "trends", "substack", "gmail", "manual"] as ResearchSource[])
        .includes(i.source as ResearchSource) ? (i.source as ResearchSource) : "manual";
      return {
        source,
        sourceDetail: i.sourceDetail,
        title: String(i.title).slice(0, 500),
        url: i.url,
        excerpt: i.excerpt?.slice(0, 1500),
        fullText: i.fullText?.slice(0, 60_000),
        viralityScore: viralityFromEngagement(engagement),
        engagement,
        publishedAt: i.publishedAt ? new Date(i.publishedAt) : undefined,
      };
    });
  return storeResearchItems(userId, valid);
}

/**
 * Handoff all'agente SEO/SMM via bridge chat (pattern esistente, draft-first):
 * il contenuto parte dall'ANGLE del brand, mai dalla notizia nuda.
 */
export async function requestContentFromResearch(
  userId: number,
  itemId: number,
  formats: Array<"blog" | "x" | "facebook">
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const item = await getResearchItemById(itemId);
  if (!item || item.userId !== userId) return { ok: false, error: "Item non trovato" };
  const wanted = formats.length ? formats : (["blog", "x", "facebook"] as const);
  const formatLines: string[] = [];
  if (wanted.includes("blog")) formatLines.push("- ARTICOLO BLOG per lo store Shopify: SEO-first (keyword principale + secondarie nel titolo/H2), 800-1200 parole, struttura H2/H3, meta description");
  if (wanted.includes("x")) formatLines.push("- POST X (Twitter): hook forte nella prima riga, max 280 caratteri (o mini-thread se serve)");
  if (wanted.includes("facebook")) formatLines.push("- POST FACEBOOK: taglio conversazionale, domanda di engagement finale");
  const text = `[SEO → CONTENUTO] (research_item #${item.id})
Fonte: ${item.source}${item.sourceDetail ? ` · ${item.sourceDetail}` : ""}
Titolo: ${item.title}
${item.url ? `URL: ${item.url}` : ""}
${item.brief ? `Brief: ${item.brief}` : ""}
${item.angle ? `Chiave di lettura brand: ${item.angle}` : ""}

Crea questi contenuti e salvali come BOZZE (POST /api/social/draft, mai pubblicare):
${formatLines.join("\n")}

REGOLE VINCOLANTI (lezione anti-traffico-freddo): NON commentare la notizia da divulgatore. Parti dalla chiave di lettura del brand, aggancia i valori/esperienza DreamBrothers (Brain: viral-playbook, tone of voice, avatar Aurora). Ogni contenuto deve nutrire il posizionamento, non il rumore. Alla fine rispondi in chat con il riepilogo delle bozze create.`;
  const messageId = await insertSocialChatMessage({ userId, role: "user", text, status: "new", source: "web" });
  await updateResearchItem(itemId, { status: "usato" });
  return { ok: true, messageId };
}
