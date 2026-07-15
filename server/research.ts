/**
 * SEO & Research Service — replica della "Research Dashboard" di WeAreMarketers
 * (video Mastermind 2Yq4Vq_W-Sw, 1:24:43-1:31:28), adattata a DreamBrothers.
 *
 * Fonti gratuite (zero API key):
 *   - Reddit:        top.json giornaliero dei subreddit configurati
 *   - Google News:   RSS di ricerca per le query configurate
 *   - Google Trends: RSS "trending searches" giornaliero per geo
 *   - Substack:      RSS delle pubblicazioni configurate
 *   - Gmail/altro:   ingest dall'agente VPS via POST /api/seo/research/ingest
 *
 * Guardrail anti-traffico-freddo (la lezione del video): la viralità da sola non
 * basta — ogni notizia riceve un punteggio "in target" contro la buyer persona e
 * una "chiave di lettura" col sistema di credenze del brand. La generazione
 * contenuti parte SEMPRE dall'angle del brand, mai dalla notizia nuda.
 */
import { createHash } from "crypto";
import { AXIOS_TIMEOUT_MS } from "@shared/const";
import { invokeLLM } from "./_core/llm";

export type ResearchSource = "reddit" | "news" | "trends" | "substack" | "gmail" | "manual";

export interface FetchedResearchItem {
  source: ResearchSource;
  sourceDetail?: string;
  title: string;
  url?: string;
  excerpt?: string;
  fullText?: string;
  viralityScore: number; // 0-10
  engagement: number;
  publishedAt?: Date;
}

export interface ResearchSourcesConfig {
  subreddits: string[];
  newsQueries: string[];
  substacks: string[];
  trendsGeo: string;
}

export const DEFAULT_SOURCES: ResearchSourcesConfig = {
  subreddits: ["GetMotivated", "DecidingToBeBetter", "selfimprovement", "printondemand", "EtsySellers"],
  newsQueries: ["crescita personale motivazione", "home decor tendenze", "print on demand ecommerce"],
  substacks: [],
  trendsGeo: "IT",
};

export const DEFAULT_BRAND_CONTEXT =
  "Brand: DreamBrothers — print-on-demand (wall art, poster, apparel) per sognatori. " +
  "Buyer persona: 'Aurora / Sognatrice Sensibile' — donna 25-45, sensibile, ama citazioni ispirazionali, " +
  "crescita personale, estetica della casa, regali significativi. Valori: sognare in grande, motivazione " +
  "autentica, bellezza accessibile. Tone of voice: ispirazionale ma concreto, lessico dreamer, mai cinico.";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function researchUrlHash(url: string | undefined, title: string): string {
  return createHash("sha256").update(`${url ?? ""}|${title}`).digest("hex");
}

/** Punteggio 0-10 da metrica grezza (upvotes+commenti, traffico trend, ...). */
export function viralityFromEngagement(engagement: number): number {
  if (engagement <= 0) return 5; // fonti senza metrica: neutro
  const v = Math.round(2.2 * Math.log10(1 + engagement));
  return Math.max(1, Math.min(10, v));
}

// ─── Parser RSS minimale (niente dipendenze nuove) ───────────────────────────
function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? stripTags(m[1]) : undefined;
}

export function parseRssItems(xml: string): Array<{ title: string; link?: string; pubDate?: Date; description?: string; extras: Record<string, string> }> {
  // RSS 2.0 (<item>) e Atom (<entry>, usato dai feed .rss di Reddit)
  const blocks = [
    ...(xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []),
  ];
  return blocks.map((block) => {
    const pub = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated");
    const extras: Record<string, string> = {};
    // ht:approx_traffic (Google Trends), ht:news_item_title ecc.
    for (const m of Array.from(block.matchAll(/<ht:(\w+)>([\s\S]*?)<\/ht:\1>/gi))) {
      extras[m[1]] = stripTags(m[2]);
    }
    // Atom: <link href="..."/> (attributo, non contenuto)
    const hrefLink = block.match(/<link[^>]*href="([^"]+)"/i)?.[1];
    return {
      title: tag(block, "title") ?? "",
      link: tag(block, "link") || hrefLink,
      pubDate: pub ? new Date(pub) : undefined,
      description: tag(block, "description") ?? tag(block, "content") ?? tag(block, "summary"),
      extras,
    };
  }).filter((i) => i.title);
}

async function httpGetText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return res.text();
}

// ─── Fetcher per fonte ────────────────────────────────────────────────────────
export async function fetchReddit(subreddit: string, limit = 20): Promise<FetchedResearchItem[]> {
  // Gli endpoint .json di Reddit sono 403 senza OAuth; il feed .rss (Atom) è aperto.
  // Il feed "top of the day" non espone i punteggi → viralità implicita dal rank.
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top/.rss?t=day&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/atom+xml, application/xml, */*" },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Reddit r/${subreddit}: HTTP ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml).slice(0, limit).map((i, idx) => ({
    source: "reddit" as const,
    sourceDetail: `r/${subreddit}`,
    title: i.title.slice(0, 500),
    url: i.link,
    excerpt: i.description?.slice(0, 1500),
    // top-of-day già ordinato: i primi del giorno valgono di più
    viralityScore: idx < 3 ? 8 : idx < 8 ? 7 : 6,
    engagement: 0,
    publishedAt: i.pubDate,
  }));
}

export async function fetchGoogleNews(query: string, lang = "it", country = "IT"): Promise<FetchedResearchItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${country}&ceid=${country}:${lang}`;
  const xml = await httpGetText(url);
  return parseRssItems(xml).slice(0, 15).map((i, idx) => ({
    source: "news" as const,
    sourceDetail: query,
    title: i.title.slice(0, 500),
    url: i.link,
    excerpt: i.description?.slice(0, 1500),
    // Google News è già ordinato per rilevanza: i primi valgono un filo di più
    viralityScore: Math.max(4, 7 - Math.floor(idx / 5)),
    engagement: 0,
    publishedAt: i.pubDate,
  }));
}

export async function fetchGoogleTrends(geo = "IT"): Promise<FetchedResearchItem[]> {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  const xml = await httpGetText(url);
  return parseRssItems(xml).slice(0, 20).map((i) => {
    // ht:approx_traffic tipo "50.000+" → numero
    const traffic = parseInt((i.extras.approx_traffic ?? "0").replace(/[^\d]/g, ""), 10) || 0;
    const newsTitle = i.extras.news_item_title;
    return {
      source: "trends" as const,
      sourceDetail: `Google Trends ${geo}`,
      title: i.title.slice(0, 500),
      url: i.extras.news_item_url || i.link,
      excerpt: newsTitle ? `Notizia collegata: ${newsTitle}`.slice(0, 1500) : i.description?.slice(0, 1500),
      viralityScore: traffic >= 500_000 ? 10 : traffic >= 100_000 ? 9 : traffic >= 50_000 ? 8 : traffic >= 20_000 ? 7 : 6,
      engagement: traffic,
      publishedAt: i.pubDate,
    };
  });
}

export async function fetchSubstack(publication: string): Promise<FetchedResearchItem[]> {
  const host = publication.includes(".") ? publication : `${publication}.substack.com`;
  const xml = await httpGetText(`https://${host}/feed`);
  if (/^\s*<!doctype html/i.test(xml)) {
    throw new Error(`Substack ${host}: il feed ha risposto con HTML (blocco anti-bot) — l'agente VPS può fare ingest`);
  }
  return parseRssItems(xml).slice(0, 10).map((i) => ({
    source: "substack" as const,
    sourceDetail: host,
    title: i.title.slice(0, 500),
    url: i.link,
    excerpt: i.description?.slice(0, 1500),
    viralityScore: 5,
    engagement: 0,
    publishedAt: i.pubDate,
  }));
}

/** Esegue tutti i fetcher configurati; gli errori per-fonte non bloccano il resto. */
export async function fetchAllResearchSources(cfg: ResearchSourcesConfig): Promise<{ items: FetchedResearchItem[]; errors: string[] }> {
  const items: FetchedResearchItem[] = [];
  const errors: string[] = [];

  // Reddit limita le richieste ravvicinate (429): i subreddit vanno in sequenza con pausa
  const redditJob = (async () => {
    for (let i = 0; i < cfg.subreddits.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1200));
      try {
        items.push(...await fetchReddit(cfg.subreddits[i]));
      } catch (err) {
        errors.push(`reddit r/${cfg.subreddits[i]}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  })();

  const otherJobs: Array<{ name: string; run: () => Promise<FetchedResearchItem[]> }> = [
    ...cfg.newsQueries.map((q) => ({ name: `news "${q}"`, run: () => fetchGoogleNews(q) })),
    { name: `trends ${cfg.trendsGeo}`, run: () => fetchGoogleTrends(cfg.trendsGeo) },
    ...cfg.substacks.map((p) => ({ name: `substack ${p}`, run: () => fetchSubstack(p) })),
  ];
  const results = await Promise.allSettled(otherJobs.map((j) => j.run()));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${otherJobs[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });
  await redditJob;
  return { items, errors };
}

// ─── Arricchimento LLM (punteggi target/interesse + brief + chiave di lettura) ─
export interface EnrichmentResult {
  id: number;
  targetScore: number;
  interestScore: number;
  brief: string;
  angle: string;
}

export async function enrichResearchItems(
  items: Array<{ id: number; title: string; excerpt?: string | null; source: string }>,
  brandContext: string
): Promise<EnrichmentResult[]> {
  if (items.length === 0) return [];
  const list = items.map((i) => ({
    id: i.id,
    fonte: i.source,
    titolo: i.title,
    estratto: (i.excerpt ?? "").slice(0, 400),
  }));
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Sei il Market Intelligence Strategist di un brand e-commerce. Valuti notizie/conversazioni di mercato CONTRO il contesto del brand.
${brandContext}

Per ogni item restituisci:
- targetScore 0-10: quanto è rilevante per la buyer persona del brand (10 = parla esattamente di lei/dei suoi desideri)
- interestScore 0-10: quanto è utile al brand per creare contenuti/prodotti (trend sfruttabile, keyword, conversazione)
- brief: 1-2 frasi in italiano — cosa è successo / di cosa si parla
- angle: la CHIAVE DI LETTURA — come il brand può agganciare questa notizia ai propri valori/esperienza per un contenuto EFFICACE (non solo virale). Se la notizia è puro rumore fuori target, dillo chiaramente e suggerisci di ignorarla.

Rispondi SOLO con JSON valido: {"items":[{"id":number,"targetScore":number,"interestScore":number,"brief":string,"angle":string}]}`,
      },
      { role: "user", content: JSON.stringify(list) },
    ],
  });
  const raw = (response as { content?: unknown }).content;
  const content = typeof raw === "string" ? raw : JSON.stringify(raw);
  try {
    const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
    const parsed = JSON.parse(jsonStr) as { items?: EnrichmentResult[] };
    return (parsed.items ?? []).filter((e) => typeof e.id === "number").map((e) => ({
      id: e.id,
      targetScore: Math.max(0, Math.min(10, Math.round(Number(e.targetScore ?? 0)))),
      interestScore: Math.max(0, Math.min(10, Math.round(Number(e.interestScore ?? 0)))),
      brief: String(e.brief ?? "").slice(0, 2000),
      angle: String(e.angle ?? "").slice(0, 2000),
    }));
  } catch (err) {
    console.warn("[research] enrichment JSON parse fallito:", err);
    return [];
  }
}
