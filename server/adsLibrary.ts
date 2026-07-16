/**
 * Ads Inspiration — modulo puro (niente DB/rete): parsing input brand,
 * mapping resiliente dell'output degli scraper della Facebook Ads Library
 * (Apify o agente VPS) e scoring "trending".
 *
 * Proxy di performance: un'ad che gira da più giorni è un'ad che il brand
 * sta pagando volentieri → activeDays è il segnale principale (standard ad-spy).
 */

export type NormalizedAd = {
  adArchiveId: string;
  pageName: string | null;
  /** Foto profilo della Pagina: è il logo che la Ads Library mostra accanto all'advertiser. */
  pageProfilePictureUrl: string | null;
  title: string | null;
  bodyText: string | null;
  ctaText: string | null;
  landingUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  startedRunningAt: Date | null;
  activeDays: number;
  score: number;
  raw: unknown;
};

// ─── Input brand: accetta Page ID, URL della Ads Library o URL pagina FB ──────
export function parsePageIdInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  // URL Ads Library con view_all_page_id=123...
  const m = s.match(/view_all_page_id=(\d{5,20})/);
  if (m) return m[1];
  // ID numerico puro
  if (/^\d{5,20}$/.test(s)) return s;
  // URL facebook.com/profile.php?id=123
  const p = s.match(/[?&]id=(\d{5,20})/);
  if (p) return p[1];
  return null;
}

export function adsLibraryUrlForPage(pageId: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&is_targeted_country=false&media_type=all&search_type=page&view_all_page_id=${pageId}`;
}

// ─── Mapping resiliente: gli scraper cambiano shape, noi no ───────────────────
type AnyObj = Record<string, unknown>;

function pick(obj: AnyObj | undefined | null, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === "number") {
    // unix seconds o millis
    const ms = v > 10_000_000_000 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function firstOf(v: unknown): AnyObj | undefined {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" ? (v[0] as AnyObj) : undefined;
}

function asArray(v: unknown): AnyObj[] {
  return Array.isArray(v) ? v.filter((x): x is AnyObj => typeof x === "object" && x !== null) : [];
}

/**
 * Cerca il primo media utile scandendo TUTTI i contenitori possibili.
 * Le ads con più versioni ("This ad has multiple versions") e i caroselli
 * tengono i media dentro `cards[]`, non in `images[]`/`videos[]`: guardare solo
 * il primo elemento di images/videos le faceva sembrare senza media → scartate.
 */
function collectMedia(snapshot: AnyObj): { imageUrl: string | null; videoUrl: string | null; thumbnailUrl: string | null } {
  const IMG_KEYS = ["original_image_url", "resized_image_url", "originalImageUrl", "resizedImageUrl", "image_url", "imageUrl", "url"];
  const VIDEO_KEYS = ["video_hd_url", "video_sd_url", "videoHdUrl", "videoSdUrl", "video_url"];
  const THUMB_KEYS = ["video_preview_image_url", "videoPreviewImageUrl", "thumbnail_url", "thumbnailUrl"];

  const containers: AnyObj[] = [
    snapshot,
    ...asArray(pick(snapshot, "images")),
    ...asArray(pick(snapshot, "videos")),
    ...asArray(pick(snapshot, "cards")),
    ...asArray(pick(snapshot, "extra_images")),
    ...asArray(pick(snapshot, "extra_videos")),
  ];

  let imageUrl: string | null = null;
  let videoUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  for (const c of containers) {
    if (!videoUrl) videoUrl = asStr(pick(c, ...VIDEO_KEYS));
    if (!thumbnailUrl) thumbnailUrl = asStr(pick(c, ...THUMB_KEYS));
    if (!imageUrl) imageUrl = asStr(pick(c, ...IMG_KEYS));
    if (imageUrl && videoUrl && thumbnailUrl) break;
  }
  return { imageUrl, videoUrl, thumbnailUrl: thumbnailUrl ?? imageUrl };
}

export function computeActiveDays(started: Date | null, now: Date = new Date()): number {
  if (!started) return 0;
  const days = Math.floor((now.getTime() - started.getTime()) / 86_400_000);
  return Math.max(0, days);
}

export function computeTrendingScore(activeDays: number, hasVideo: boolean): number {
  // 0-100: longevità pesa di più, il video un piccolo bonus
  const longevity = Math.min(activeDays, 90) / 90 * 85;
  return Math.round(longevity + (hasVideo ? 15 : 0));
}

/** Mappa un item di scraper Ads Library (Apify curious_coder & simili) nel nostro shape. */
export function mapScrapedAd(item: AnyObj, now: Date = new Date()): NormalizedAd | null {
  const snapshot = (pick(item, "snapshot") as AnyObj) ?? item;
  const adArchiveId = asStr(pick(item, "ad_archive_id", "adArchiveID", "adArchiveId", "archiveId", "id"));
  if (!adArchiveId) return null;

  const body = pick(snapshot, "body") as AnyObj | string | undefined;
  const bodyText = typeof body === "string" ? body : asStr(pick(body as AnyObj, "text")) ?? asStr(pick(snapshot, "body_text", "bodyText"));

  const { imageUrl, videoUrl, thumbnailUrl } = collectMedia(snapshot);
  const cards = firstOf(pick(snapshot, "cards"));

  const started = asDate(pick(item, "start_date", "startDate", "start_date_string", "ad_delivery_start_time"))
    ?? asDate(pick(snapshot, "start_date"));
  const activeDays = computeActiveDays(started, now);

  return {
    adArchiveId,
    pageName: asStr(pick(item, "page_name", "pageName")) ?? asStr(pick(snapshot, "page_name")),
    pageProfilePictureUrl: asStr(pick(snapshot, "page_profile_picture_url", "pageProfilePictureUrl"))
      ?? asStr(pick(item, "page_profile_picture_url", "pageProfilePictureUrl")),
    title: asStr(pick(snapshot, "title", "link_title", "caption")) ?? asStr(pick(cards, "title", "link_title")),
    bodyText: bodyText ?? asStr(pick(cards, "body")) ?? null,
    ctaText: asStr(pick(snapshot, "cta_text", "ctaText", "cta_type")) ?? asStr(pick(cards, "cta_text", "cta_type")),
    landingUrl: asStr(pick(snapshot, "link_url", "linkUrl", "landing_url")) ?? asStr(pick(cards, "link_url")),
    imageUrl,
    videoUrl,
    thumbnailUrl,
    startedRunningAt: started,
    activeDays,
    score: computeTrendingScore(activeDays, Boolean(videoUrl)),
    raw: item,
  };
}

/** Prompt del task per l'agente VPS (fallback senza Apify): scrape + ingest via REST. */
export function buildScrapeHandoffTask(brandName: string, pageId: string): string {
  return `[ADS LIBRARY → SCRAPE] Task Ads Inspiration (reparto Paid Advertising).
Scrapa le ads ATTIVE del brand "${brandName}" dalla Facebook Ads Library: ${adsLibraryUrlForPage(pageId)}
Per ogni ad estrai: ad_archive_id, page_name, title, body text, cta, link_url, image/video url, start_date.
Poi POST il JSON {"pageId":"${pageId}","ads":[...]} a "$SOCIAL_BASE_URL/api/ads-library/ingest" con header "x-care-secret: $CARE_WEBHOOK_SECRET" (env in ~/.social-agent.env).
Rispondi in chat solo con: quante ads hai ingestato per ${brandName}.`;
}
