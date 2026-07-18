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
import { apifyRunSync, hasApifyToken } from "./watchlist";

export type ResearchSource = "reddit" | "news" | "trends" | "substack" | "pinterest" | "blog" | "gmail" | "manual";

export interface FetchedResearchItem {
  source: ResearchSource;
  sourceDetail?: string;
  country?: string; // ISO-2 (IT, US...) o "GLOBAL"
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
  // ID interessi di trends.pinterest.com (?topicInterestIds=...), opzionali
  pinterestInterestIds: string[];
  // Blog/siti competitor da monitorare (sezione "Blog Post"): URL sito o feed diretto
  blogFeeds: string[];
}

export const DEFAULT_SOURCES: ResearchSourcesConfig = {
  subreddits: ["GetMotivated", "DecidingToBeBetter", "selfimprovement", "printondemand", "EtsySellers"],
  newsQueries: ["crescita personale motivazione", "home decor tendenze", "print on demand ecommerce"],
  substacks: [],
  trendsGeo: "IT",
  pinterestInterestIds: [],
  blogFeeds: [],
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

/**
 * Ripulisce il testo per l'inserimento in MySQL/TiDB:
 * - rimuove i surrogati UTF-16 spaiati (tipici di un'emoji tagliata a metà da uno
 *   slice) che MySQL rifiuta come "Incorrect string value"
 * - taglia a maxLen senza lasciare un surrogato alto orfano in coda
 */
export function sanitizeText(s: string | undefined | null, maxLen = 2000): string | undefined {
  if (s == null) return undefined;
  let clean = String(s)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "") // surrogato alto senza basso
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "$1"); // surrogato basso orfano
  if (clean.length > maxLen) {
    clean = clean.slice(0, maxLen).replace(/[\uD800-\uDBFF]$/, "");
  }
  return clean;
}

/** Punteggio 0-10 da metrica grezza (upvotes+commenti, traffico trend, ...). */
export function viralityFromEngagement(engagement: number): number {
  if (engagement <= 0) return 5; // fonti senza metrica: neutro
  const v = Math.round(2.2 * Math.log10(1 + engagement));
  return Math.max(1, Math.min(10, v));
}

// ─── Parser RSS minimale (niente dipendenze nuove) ───────────────────────────
function stripTags(s: string): string {
  // ordine: CDATA → decodifica entità (i feed Atom di Reddit arrivano con l'HTML
  // entity-encoded: &lt;p&gt;) → rimozione tag → &amp; per ultima → spazi
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    // secondo passaggio per le entità doppio-codificate (&amp;#39; → &#39; → ')
    .replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;|&#160;/g, " ")
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
// Reddit OAuth (API ufficiale gratuita): con REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET
// nelle env si ottengono punteggi/commenti REALI (colonna ENG). Senza credenziali
// si ripiega sul feed .rss, che dal 2023 non espone più i contatori.
let _redditToken: { token: string; exp: number } | null = null;

async function redditOAuthToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_redditToken && Date.now() < _redditToken.exp - 60_000) return _redditToken.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "web:dreambrothers-research:1.0 (by /u/dreambrothers)",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Reddit OAuth: HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) return null;
  _redditToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function fetchRedditOAuth(subreddit: string, token: string, limit: number): Promise<FetchedResearchItem[]> {
  const res = await fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/top?t=day&limit=${limit}&raw_json=1`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "web:dreambrothers-research:1.0 (by /u/dreambrothers)" },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Reddit OAuth r/${subreddit}: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { children?: Array<{ data: any }> } };
  return (json.data?.children ?? []).map(({ data: d }) => {
    const engagement = Number(d.score ?? 0) + 2 * Number(d.num_comments ?? 0);
    return {
      source: "reddit" as const,
      sourceDetail: `r/${subreddit}`,
      title: String(d.title ?? "").slice(0, 500),
      url: `https://www.reddit.com${d.permalink}`,
      excerpt: String(d.selftext ?? "").slice(0, 1500) || undefined,
      viralityScore: viralityFromEngagement(engagement),
      engagement,
      publishedAt: d.created_utc ? new Date(Number(d.created_utc) * 1000) : undefined,
    };
  }).filter((i) => i.title);
}

export async function fetchReddit(subreddit: string, limit = 20): Promise<FetchedResearchItem[]> {
  // 1° scelta: API ufficiale OAuth (punteggi reali). Fallback: feed .rss senza contatori.
  try {
    const token = await redditOAuthToken();
    if (token) return await fetchRedditOAuth(subreddit, token, limit);
  } catch (err) {
    console.warn(`[research] Reddit OAuth fallito per r/${subreddit}, uso .rss:`, err instanceof Error ? err.message : err);
  }
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

// lingua di default per ogni paese Google News (ISO-2 → hl)
const COUNTRY_LANG: Record<string, string> = {
  IT: "it", US: "en-US", GB: "en-GB", DE: "de", FR: "fr", ES: "es",
  PT: "pt-PT", BR: "pt-BR", NL: "nl", AT: "de", CH: "de", IE: "en-IE",
  CA: "en-CA", AU: "en-AU", MX: "es-419",
};

export async function fetchGoogleNews(query: string, country = "IT"): Promise<FetchedResearchItem[]> {
  const geo = country.toUpperCase();
  const lang = COUNTRY_LANG[geo] ?? "en";
  // "when:7d" = solo notizie dell'ultima settimana: senza, Google News restituisce
  // articoli RILEVANTI ma anche vecchi di mesi → sparivano dai filtri 24/48h
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&hl=${lang}&gl=${geo}&ceid=${geo}:${lang}`;
  const xml = await httpGetText(url);
  return parseRssItems(xml).slice(0, 15).map((i, idx) => ({
    source: "news" as const,
    sourceDetail: query,
    country: geo,
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
  const country = geo.toUpperCase();
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(country)}`;
  const xml = await httpGetText(url);
  return parseRssItems(xml).slice(0, 20).map((i) => {
    // ht:approx_traffic tipo "50.000+" → numero
    const traffic = parseInt((i.extras.approx_traffic ?? "0").replace(/[^\d]/g, ""), 10) || 0;
    const newsTitle = i.extras.news_item_title;
    return {
      source: "trends" as const,
      sourceDetail: `Google Trends ${country}`,
      country,
      title: i.title.slice(0, 500),
      url: i.extras.news_item_url || i.link,
      excerpt: newsTitle ? `Notizia collegata: ${newsTitle}`.slice(0, 1500) : i.description?.slice(0, 1500),
      viralityScore: traffic >= 500_000 ? 10 : traffic >= 100_000 ? 9 : traffic >= 50_000 ? 8 : traffic >= 20_000 ? 7 : 6,
      engagement: traffic,
      publishedAt: i.pubDate,
    };
  });
}

/**
 * Pinterest Trends via Apify (automation-lab/pinterest-trends-scraper):
 * keyword in crescita con volume di ricerca, growth % e stagionalità — la base
 * per articoli SEO con keyword ad alto volume. Testato: 15 trend IT in ~4s.
 */
export async function fetchPinterestTrends(country: string, interestIds: string[] = [], max = 25): Promise<FetchedResearchItem[]> {
  type PinTrend = {
    term?: string; rank?: number; searchCount?: number; normalizedCount?: number;
    weeklyChange?: number; monthlyChange?: number; yearlyChange?: number;
    seasonalityScore?: number; trendType?: string; pinterestTrendsUrl?: string;
  };
  // growing + seasonal + top_monthly = copertura più ampia (l'enum dell'actor non
  // include i trend "shopping": quelli passano dalla sessione, vedi fetch dedicato)
  const input: Record<string, unknown> = { countries: [country], maxResultsPerCountry: max, trendTypes: ["growing", "seasonal", "top_monthly"] };
  if (interestIds.length) input.interestIds = interestIds;
  const items = await apifyRunSync<PinTrend>("automation-lab~pinterest-trends-scraper", input);
  return items.filter((i) => i.term).map((i) => {
    const rank = Number(i.rank ?? 99);
    const parts = [
      `Keyword in crescita su Pinterest ${country}: rank #${rank}`,
      i.searchCount != null ? `search score ${i.searchCount}` : "",
      i.weeklyChange != null ? `+${i.weeklyChange}% settimana` : "",
      i.monthlyChange != null ? `+${i.monthlyChange}% mese` : "",
      i.seasonalityScore != null ? `stagionalità ${i.seasonalityScore}` : "",
    ].filter(Boolean);
    return {
      source: "pinterest" as const,
      sourceDetail: `Pinterest Trends ${country}`,
      country: country.toUpperCase(),
      title: i.term!,
      url: i.pinterestTrendsUrl ?? `https://trends.pinterest.com/detail/?terms=${encodeURIComponent(i.term!)}&country=${country}`,
      excerpt: parts.join(" · "),
      viralityScore: rank <= 3 ? 9 : rank <= 8 ? 8 : rank <= 15 ? 7 : 6,
      engagement: Math.round(Number(i.searchCount ?? i.normalizedCount ?? 0)),
      publishedAt: new Date(),
    };
  });
}

/**
 * Blog competitor (sezione "Blog Post"): autodiscovery del feed RSS/Atom.
 * Accetta l'URL del sito o del feed diretto. Prova: <link rel="alternate">,
 * poi i path comuni (/feed, /rss, /atom.xml, /blogs/news.atom per Shopify).
 */
export async function fetchBlogArticles(siteUrl: string, max = 10): Promise<FetchedResearchItem[]> {
  const input = siteUrl.trim().replace(/\/+$/, "");
  const base = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const host = new URL(base).hostname.replace(/^www\./, "");

  const tryParse = async (feedUrl: string): Promise<FetchedResearchItem[] | null> => {
    try {
      const xml = await httpGetText(feedUrl);
      if (/^\s*<!doctype html/i.test(xml)) return null;
      const items = parseRssItems(xml);
      if (items.length === 0) return null;
      return items.slice(0, max).map((i) => ({
        source: "blog" as const,
        sourceDetail: host,
        title: i.title.slice(0, 500),
        url: i.link,
        excerpt: i.description?.slice(0, 1500),
        viralityScore: 5,
        engagement: 0,
        publishedAt: i.pubDate,
      }));
    } catch {
      return null;
    }
  };

  // 1) l'URL è già un feed?
  if (/\.(xml|atom|rss)$|\/feed\/?$|\/rss\/?$/i.test(base)) {
    const direct = await tryParse(base);
    if (direct) return direct;
  }
  // 2) autodiscovery dalla home: <link rel="alternate" type="application/rss+xml|atom+xml">
  try {
    const html = await httpGetText(base);
    const links = Array.from(html.matchAll(/<link[^>]+rel=["']alternate["'][^>]*>/gi)).map((m) => m[0]);
    for (const tag of links) {
      if (!/application\/(rss|atom)\+xml/i.test(tag)) continue;
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (!href) continue;
      const feedUrl = href.startsWith("http") ? href : new URL(href, base).toString();
      const found = await tryParse(feedUrl);
      if (found) return found;
    }
  } catch {
    // home non raggiungibile: proviamo comunque i path standard
  }
  // 3) path comuni (incluso il formato Shopify)
  for (const path of ["/feed", "/rss", "/atom.xml", "/feed.xml", "/blog/feed", "/blogs/news.atom", "/blog/rss.xml"]) {
    const found = await tryParse(`${base}${path}`);
    if (found) return found;
  }
  throw new Error(`Nessun feed RSS/Atom trovato per ${host} — prova a incollare l'URL diretto del feed`);
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
export async function fetchAllResearchSources(cfg: ResearchSourcesConfig, opts: { runPinterest?: boolean } = {}): Promise<{ items: FetchedResearchItem[]; errors: string[] }> {
  const runPinterest = opts.runPinterest !== false; // Pinterest costa Apify: cache-controllato dal chiamante
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

  // trendsGeo accetta più paesi separati da virgola: "IT, US"
  const geos = cfg.trendsGeo.split(/[,\s]+/).map((g) => g.trim().toUpperCase()).filter(Boolean);
  const newsGeos = geos.length ? geos : ["IT"];
  const otherJobs: Array<{ name: string; run: () => Promise<FetchedResearchItem[]> }> = [
    // le news vengono raccolte per OGNI paese configurato (con lingua locale)
    ...newsGeos.flatMap((g) => cfg.newsQueries.map((q) => ({ name: `news ${g} "${q}"`, run: () => fetchGoogleNews(q, g) }))),
    ...geos.map((g) => ({ name: `trends ${g}`, run: () => fetchGoogleTrends(g) })),
    // Pinterest Trends (Apify): solo se abilitato dalla cache (i trend cambiano
    // lenti → 1 volta al giorno basta, così non si brucia il budget Apify free)
    ...(runPinterest && hasApifyToken()
      ? geos.map((g) => ({ name: `pinterest ${g}`, run: () => fetchPinterestTrends(g, cfg.pinterestInterestIds) }))
      : []),
    ...cfg.substacks.map((p) => ({ name: `substack ${p}`, run: () => fetchSubstack(p) })),
    // Blog competitor (sezione "Blog Post")
    ...cfg.blogFeeds.map((b) => ({ name: `blog ${b}`, run: () => fetchBlogArticles(b) })),
  ];
  const results = await Promise.allSettled(otherJobs.map((j) => j.run()));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${otherJobs[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });
  await redditJob;
  return { items, errors };
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────
/**
 * Gerarchia motori AI del Research Hub (scelta di Andrea):
 *   1° PRIMARIO: l'agente VPS con l'abbonamento Claude già pagato (costo zero) —
 *      lavora in background via GET /api/seo/research/pending-enrich +
 *      POST /api/seo/research/enrichment (vedi references/skills/seo-research.md)
 *   2° FALLBACK sincrono (bottoni "Analizza AI" / "Genera contenuti"): Gemini
 *      free-tier con GEMINI_API_KEY (gratuita da aistudio.google.com)
 *   3° legacy: proxy Forge/Manus se configurato. NIENTE OpenAI.
 */
async function geminiGenerate(system: string, user: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
  let lastErr = "";
  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192, temperature: 0.7 },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastErr = `Gemini ${model}: HTTP ${res.status} ${body.slice(0, 150)}`;
      continue;
    }
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (text.trim()) return text;
    lastErr = `Gemini ${model}: risposta vuota`;
  }
  throw new Error(lastErr || "Gemini non raggiungibile");
}

/** Esegue il prompt col primo motore disponibile (Gemini free → Forge legacy). */
export async function runResearchLLM(system: string, user: string): Promise<string> {
  if (process.env.GEMINI_API_KEY) return geminiGenerate(system, user);
  if (process.env.BUILT_IN_FORGE_API_KEY) {
    const response = await invokeLLM({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return llmContentToString((response as { content?: unknown }).content);
  }
  throw new Error(
    "Nessun motore AI sul server: aggiungi GEMINI_API_KEY (gratuita: aistudio.google.com → Get API key) nelle Railway Variables. In alternativa l'agente VPS Claude può fare l'analisi in background (skill seo-research)"
  );
}

/** Estrae il testo dalla risposta LLM: gestisce stringa, array di parti, oggetti. */
export function llmContentToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.map((p) => {
      if (typeof p === "string") return p;
      const part = p as { text?: string; content?: string };
      return part?.text ?? part?.content ?? "";
    }).join("\n");
  }
  return JSON.stringify(raw ?? "");
}

/** Estrae il primo blocco JSON valido dal testo (gestisce ```json fences e testo attorno). */
export function extractJson<T>(text: string): T | null {
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fence) candidates.push(fence.trim());
  const braces = text.match(/\{[\s\S]*\}/)?.[0];
  if (braces) candidates.push(braces);
  candidates.push(text);
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // prova il prossimo candidato
    }
  }
  return null;
}

// ─── Commenti Reddit (feed .rss del post: il primo entry è il post, poi i commenti) ─
export async function fetchRedditComments(postUrl: string, max = 8): Promise<string[]> {
  const clean = postUrl.replace(/\/+$/, "");
  const res = await fetch(`${clean}/.rss`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/atom+xml, application/xml, */*" },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Reddit commenti: HTTP ${res.status}`);
  const entries = parseRssItems(await res.text());
  // entries[0] = il post stesso; i successivi sono i commenti in evidenza
  return entries.slice(1, 1 + max)
    .map((e) => (e.description ?? "").slice(0, 400))
    .filter((t) => t.length > 10);
}

// ─── Arricchimento LLM (punteggi target/interesse + brief + chiave di lettura) ─
export interface EnrichmentResult {
  id: number;
  targetScore: number;
  interestScore: number;
  brief: string;
  angle: string;
  commentAnalysis?: string;
}

export async function enrichResearchItems(
  items: Array<{ id: number; title: string; excerpt?: string | null; source: string; comments?: string[] }>,
  brandContext: string
): Promise<EnrichmentResult[]> {
  if (items.length === 0) return [];
  const list = items.map((i) => ({
    id: i.id,
    fonte: i.source,
    titolo: i.title,
    estratto: (i.excerpt ?? "").slice(0, 400),
    ...(i.comments?.length ? { commenti: i.comments.slice(0, 8) } : {}),
  }));
  const systemPrompt = `Sei il Market Intelligence Strategist di un brand e-commerce. Valuti notizie/conversazioni di mercato CONTRO il contesto del brand.
${brandContext}

Per ogni item restituisci:
- targetScore 0-10: quanto è rilevante per la buyer persona del brand (10 = parla esattamente di lei/dei suoi desideri)
- interestScore 0-10: quanto è utile al brand per creare contenuti/prodotti (trend sfruttabile, keyword, conversazione)
- brief: 1-2 frasi in italiano — cosa è successo / di cosa si parla
- angle: la CHIAVE DI LETTURA — come il brand può agganciare questa notizia ai propri valori/esperienza per un contenuto EFFICACE (non solo virale). Se la notizia è puro rumore fuori target, dillo chiaramente e suggerisci di ignorarla.
- commentAnalysis (SOLO se l'item ha "commenti"): 2-3 frasi in italiano — sentiment e temi ricorrenti della conversazione, con il linguaggio esatto usato dalle persone (utile per copy e ads).

Rispondi SOLO con JSON valido: {"items":[{"id":number,"targetScore":number,"interestScore":number,"brief":string,"angle":string,"commentAnalysis":string|null}]}`;
  const content = await runResearchLLM(systemPrompt, JSON.stringify(list));
  const parsed = extractJson<{ items?: EnrichmentResult[] }>(content);
  if (!parsed) {
    throw new Error(`Risposta AI non interpretabile (primi 120 char: ${content.slice(0, 120)})`);
  }
  const arr = Array.isArray(parsed) ? (parsed as unknown as EnrichmentResult[]) : (parsed.items ?? []);
  return arr.filter((e) => typeof e.id === "number").map((e) => ({
    id: e.id,
    targetScore: Math.max(0, Math.min(10, Math.round(Number(e.targetScore ?? 0)))),
    interestScore: Math.max(0, Math.min(10, Math.round(Number(e.interestScore ?? 0)))),
    brief: String(e.brief ?? "").slice(0, 2000),
    angle: String(e.angle ?? "").slice(0, 2000),
    commentAnalysis: e.commentAnalysis ? String(e.commentAnalysis).slice(0, 2000) : undefined,
  }));
}
