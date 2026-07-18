/**
 * Watchlist Service — replica gratuita del modello Sandcastles.ai
 *
 * Monitora canali competitor su YouTube / Instagram / TikTok senza abbonamenti:
 *   - YouTube:   Data API v3 se YOUTUBE_API_KEY è impostata (gratis, 10k unità/giorno),
 *                altrimenti scraping di ytInitialData dalla pagina pubblica del canale.
 *   - Instagram: endpoint web pubblico web_profile_info (best effort — IG può bloccare
 *                gli IP dei datacenter; in quel caso i dati arrivano dall'agente VPS
 *                via POST /api/social/watchlist/ingest).
 *   - TikTok:    scraping del JSON __UNIVERSAL_DATA_FOR_REHYDRATION__ dal profilo
 *                pubblico (stesso fallback via agente VPS).
 *
 * Outlier score (stessa semantica di Sandcastles): views del video / mediana delle
 * views degli altri video recenti dello stesso canale. 1.0x = baseline del canale.
 */
import { AXIOS_TIMEOUT_MS } from "@shared/const";
import { assertAndChargeApify } from "./apifyBudget";

export type WatchPlatform = "youtube" | "instagram" | "tiktok";

export interface FetchedVideo {
  platformVideoId: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  publishedAt?: Date;
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  durationSec?: number;
}

export interface FetchedChannel {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  followers?: number;
  platformChannelId?: string;
  videos: FetchedVideo[];
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", ...headers },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`);
  return res.text();
}

// ─── Parsing input utente (URL o @handle) ─────────────────────────────────────
export function parseChannelInput(
  raw: string,
  platformHint?: WatchPlatform
): { platform: WatchPlatform; handle: string } {
  const input = raw.trim();
  const lower = input.toLowerCase();

  const clean = (h: string) => h.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();

  if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
    const m = input.match(/youtube\.com\/(?:@([\w.-]+)|channel\/(UC[\w-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i);
    const handle = m ? clean(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "") : "";
    if (!handle) throw new Error("URL YouTube non riconosciuto — usa il formato youtube.com/@handle");
    return { platform: "youtube", handle };
  }
  if (lower.includes("tiktok.com")) {
    const m = input.match(/tiktok\.com\/@([\w.-]+)/i);
    if (!m) throw new Error("URL TikTok non riconosciuto — usa il formato tiktok.com/@handle");
    return { platform: "tiktok", handle: clean(m[1]) };
  }
  if (lower.includes("instagram.com")) {
    const m = input.match(/instagram\.com\/([\w.-]+)/i);
    const handle = m ? clean(m[1]) : "";
    if (!handle || ["p", "reel", "reels", "stories", "explore"].includes(handle.toLowerCase())) {
      throw new Error("URL Instagram non riconosciuto — usa il link del profilo, non di un post");
    }
    return { platform: "instagram", handle };
  }

  // Nessun URL: serve la piattaforma esplicita
  const handle = clean(input);
  if (!handle) throw new Error("Inserisci un URL o un @handle");
  if (!platformHint) throw new Error("Per un @handle senza URL indica anche la piattaforma");
  return { platform: platformHint, handle };
}

// ─── Outlier score ────────────────────────────────────────────────────────────
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * views di ogni video / mediana delle views del canale (stessa finestra).
 * Con meno di 3 video con views il punteggio non è significativo → 1.0 per tutti.
 */
export function computeOutlierScores(videos: { id: number; views: number }[]): Map<number, number> {
  const scores = new Map<number, number>();
  const withViews = videos.filter((v) => v.views > 0);
  const base = median(withViews.map((v) => v.views));
  for (const v of videos) {
    if (withViews.length < 3 || base <= 0) scores.set(v.id, 1);
    else scores.set(v.id, Math.round((v.views / base) * 100) / 100);
  }
  return scores;
}

export function computeEngagementRate(v: { views: number; likes?: number; comments?: number; shares?: number }): number | null {
  if (!v.views || v.views <= 0) return null;
  const interactions = (v.likes ?? 0) + (v.comments ?? 0) + (v.shares ?? 0);
  if (interactions <= 0) return null;
  return Math.round((interactions / v.views) * 10000) / 10000;
}

// ─── Helpers scraping ─────────────────────────────────────────────────────────
/** Estrae un oggetto JSON bilanciato a partire dall'indice della sua graffa iniziale. */
function extractBalancedJson(html: string, startIdx: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(startIdx, i + 1);
    }
  }
  throw new Error("JSON non bilanciato nella pagina");
}

/** "1.2M views" | "12.345 visualizzazioni" | "1,234" → numero */
export function parseAbbreviatedCount(text: string | undefined | null): number {
  if (!text) return 0;
  const m = String(text).replace(/ /g, " ").match(/([\d.,]+)\s*([KMB])?/i);
  if (!m) return 0;
  let num = parseFloat(m[1].replace(/,(?=\d{3}\b)/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (Number.isNaN(num)) return 0;
  const suffix = (m[2] ?? "").toUpperCase();
  if (suffix === "K") num *= 1_000;
  else if (suffix === "M") num *= 1_000_000;
  else if (suffix === "B") num *= 1_000_000_000;
  return Math.round(num);
}

/** "3 days ago" / "2 weeks ago" → Date approssimata (scrape YouTube senza API key) */
export function parseRelativeDate(text: string | undefined | null): Date | undefined {
  if (!text) return undefined;
  const m = String(text).match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unitMs: Record<string, number> = {
    second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
    week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
  };
  const ms = unitMs[m[2].toLowerCase()];
  return ms ? new Date(Date.now() - n * ms) : undefined;
}

/** Durata ISO8601 di YouTube (PT1M30S) → secondi */
export function parseIsoDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return undefined;
  return (parseInt(m[1] ?? "0", 10) * 3600) + (parseInt(m[2] ?? "0", 10) * 60) + parseInt(m[3] ?? "0", 10);
}

/** Durata overlay thumbnail YouTube ("23:14" | "1:02:33") → secondi */
export function parseClockDuration(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const parts = String(text).trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p)) || parts.length < 2 || parts.length > 3) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// ─── YouTube ──────────────────────────────────────────────────────────────────
const YT_API = "https://www.googleapis.com/youtube/v3";

async function ytApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY!;
  const url = new URL(`${YT_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS) });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (json.error) throw new Error(`YouTube API: ${json.error.message}`);
  return json;
}

async function fetchYouTubeViaApi(handle: string, maxVideos: number): Promise<FetchedChannel> {
  type ChannelResp = { items?: { id: string; snippet: { title: string; thumbnails?: { medium?: { url: string } } }; statistics?: { subscriberCount?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] };
  const chParams: Record<string, string> = { part: "snippet,statistics,contentDetails" };
  if (handle.startsWith("UC") && handle.length > 20) chParams.id = handle;
  else chParams.forHandle = handle;
  const ch = await ytApi<ChannelResp>("channels", chParams);
  const item = ch.items?.[0];
  if (!item) throw new Error(`Canale YouTube "@${handle}" non trovato`);
  const uploadsId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("Playlist uploads non disponibile");

  type PlaylistResp = { items?: { contentDetails: { videoId: string; videoPublishedAt?: string } }[] };
  const pl = await ytApi<PlaylistResp>("playlistItems", {
    part: "contentDetails", playlistId: uploadsId, maxResults: String(Math.min(maxVideos, 50)),
  });
  const ids = (pl.items ?? []).map((i) => i.contentDetails.videoId);
  if (ids.length === 0) return { handle, displayName: item.snippet.title, avatarUrl: item.snippet.thumbnails?.medium?.url, followers: Number(item.statistics?.subscriberCount ?? 0), platformChannelId: item.id, videos: [] };

  type VideosResp = { items?: { id: string; snippet: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string } } }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails?: { duration?: string } }[] };
  const vids = await ytApi<VideosResp>("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });

  return {
    handle,
    displayName: item.snippet.title,
    avatarUrl: item.snippet.thumbnails?.medium?.url,
    followers: Number(item.statistics?.subscriberCount ?? 0),
    platformChannelId: item.id,
    videos: (vids.items ?? []).map((v) => ({
      platformVideoId: v.id,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnailUrl: v.snippet.thumbnails?.medium?.url,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
      views: Number(v.statistics?.viewCount ?? 0),
      likes: Number(v.statistics?.likeCount ?? 0),
      comments: Number(v.statistics?.commentCount ?? 0),
      durationSec: parseIsoDuration(v.contentDetails?.duration),
    })),
  };
}

/** Fallback senza API key: ytInitialData dalla pagina /videos (+ /shorts). Date approssimate. */
async function fetchYouTubeViaScrape(handle: string): Promise<FetchedChannel> {
  const base = handle.startsWith("UC") && handle.length > 20
    ? `https://www.youtube.com/channel/${handle}`
    : `https://www.youtube.com/@${handle}`;

  const parseTab = (html: string): { videos: FetchedVideo[]; meta: Partial<FetchedChannel> } => {
    const marker = html.indexOf("var ytInitialData = ");
    if (marker < 0) throw new Error("ytInitialData non trovato (YouTube ha cambiato pagina?)");
    const jsonStr = extractBalancedJson(html, html.indexOf("{", marker));
    const data = JSON.parse(jsonStr);

    const meta: Partial<FetchedChannel> = {};
    const header = data?.header?.pageHeaderRenderer ?? data?.header?.c4TabbedHeaderRenderer;
    meta.displayName = header?.pageTitle ?? header?.title;
    const metadata = data?.metadata?.channelMetadataRenderer;
    if (metadata?.title) meta.displayName = metadata.title;
    meta.avatarUrl = metadata?.avatar?.thumbnails?.[0]?.url;
    meta.platformChannelId = metadata?.externalId;
    const subsText = JSON.stringify(header ?? {}).match(/"([\d.,]+[KMB]?)\s+subscribers"/i)?.[1];
    if (subsText) meta.followers = parseAbbreviatedCount(subsText);

    const videos: FetchedVideo[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const obj = node as Record<string, any>;
      const vr = obj.videoRenderer ?? obj.gridVideoRenderer;
      if (vr?.videoId) {
        videos.push({
          platformVideoId: vr.videoId,
          url: `https://www.youtube.com/watch?v=${vr.videoId}`,
          title: vr.title?.runs?.[0]?.text ?? vr.title?.simpleText,
          thumbnailUrl: vr.thumbnail?.thumbnails?.at(-1)?.url,
          views: parseAbbreviatedCount(vr.viewCountText?.simpleText),
          publishedAt: parseRelativeDate(vr.publishedTimeText?.simpleText),
        });
      }
      const short = obj.shortsLockupViewModel;
      if (short?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId) {
        const vid = short.onTap.innertubeCommand.reelWatchEndpoint.videoId;
        videos.push({
          platformVideoId: vid,
          url: `https://www.youtube.com/shorts/${vid}`,
          title: short.overlayMetadata?.primaryText?.content,
          // gli Shorts spesso non espongono la thumbnail nel JSON: la URL canonica esiste sempre
          thumbnailUrl: short.thumbnail?.sources?.[0]?.url ?? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          views: parseAbbreviatedCount(short.overlayMetadata?.secondaryText?.content),
        });
      }
      // Formato 2024+: lockupViewModel (ha sostituito videoRenderer nei tab canale)
      const lockup = obj.lockupViewModel;
      if (lockup?.contentId && /VIDEO|SHORT/.test(String(lockup.contentType ?? ""))) {
        const meta = lockup.metadata?.lockupMetadataViewModel;
        const parts: { text?: { content?: string } }[] =
          meta?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(
            (r: { metadataParts?: unknown[] }) => r.metadataParts ?? []
          ) ?? [];
        const viewsText = parts.map((p) => p.text?.content ?? "").find((t) => /view|visualizzazioni/i.test(t));
        const dateText = parts.map((p) => p.text?.content ?? "").find((t) => /ago|fa\b/i.test(t));
        const overlays: any[] = lockup.contentImage?.thumbnailViewModel?.overlays ?? [];
        const badgeText = overlays
          .flatMap((o) => o?.thumbnailBottomOverlayViewModel?.badges ?? [])
          .map((b: any) => b?.thumbnailBadgeViewModel?.text)
          .find((t: string) => /^\d+(:\d+)+$/.test(String(t ?? "")));
        const isShort = /SHORT/i.test(String(lockup.contentType));
        videos.push({
          platformVideoId: lockup.contentId,
          url: isShort
            ? `https://www.youtube.com/shorts/${lockup.contentId}`
            : `https://www.youtube.com/watch?v=${lockup.contentId}`,
          title: meta?.title?.content,
          thumbnailUrl:
            lockup.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ??
            `https://i.ytimg.com/vi/${lockup.contentId}/hqdefault.jpg`,
          views: parseAbbreviatedCount(viewsText),
          publishedAt: parseRelativeDate(dateText),
          durationSec: parseClockDuration(badgeText),
        });
      }
      Object.values(obj).forEach(walk);
    };
    walk(data);
    return { videos, meta };
  };

  // i due tab sono indipendenti: fetch in parallelo (il tab shorts può non esistere)
  const [videosHtml, shortsHtml] = await Promise.all([
    httpGet(`${base}/videos`, { Cookie: "CONSENT=YES+1" }),
    httpGet(`${base}/shorts`, { Cookie: "CONSENT=YES+1" }).catch(() => null),
  ]);
  const { videos, meta } = parseTab(videosHtml);
  let shortsVideos: FetchedVideo[] = [];
  if (shortsHtml) {
    try {
      shortsVideos = parseTab(shortsHtml).videos;
    } catch {
      // parsing shorts fallito: non è un errore bloccante
    }
  }

  const seen = new Set<string>();
  const all = [...videos, ...shortsVideos].filter((v) => {
    if (seen.has(v.platformVideoId)) return false;
    seen.add(v.platformVideoId);
    return true;
  });
  if (all.length === 0 && !meta.displayName) throw new Error(`Canale YouTube "@${handle}" non trovato o vuoto`);
  return { handle, ...meta, videos: all };
}

export async function fetchYouTubeChannel(handle: string, maxVideos = 50): Promise<FetchedChannel> {
  if (process.env.YOUTUBE_API_KEY) return fetchYouTubeViaApi(handle, maxVideos);
  return fetchYouTubeViaScrape(handle);
}

// ─── Instagram (best effort, endpoint web pubblico) ───────────────────────────
export async function fetchInstagramChannel(handle: string): Promise<FetchedChannel> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "x-ig-app-id": "936619743392459", // app id pubblico del web client di Instagram
      Accept: "*/*",
      Referer: `https://www.instagram.com/${handle}/`,
    },
    signal: AbortSignal.timeout(AXIOS_TIMEOUT_MS),
  });
  if (res.status === 404) throw new Error(`Profilo Instagram "@${handle}" non trovato`);
  if (!res.ok) {
    throw new Error(
      `Instagram ha bloccato la richiesta (HTTP ${res.status}). I dati per questo canale possono arrivare dall'agente VPS via /api/social/watchlist/ingest`
    );
  }
  const json = (await res.json()) as { data?: { user?: any } };
  const user = json.data?.user;
  if (!user) throw new Error(`Profilo Instagram "@${handle}" non leggibile (login richiesto?)`);

  const edges: any[] = user.edge_owner_to_timeline_media?.edges ?? [];
  return {
    handle,
    displayName: user.full_name || handle,
    avatarUrl: user.profile_pic_url,
    followers: Number(user.edge_followed_by?.count ?? 0),
    platformChannelId: user.id,
    videos: edges.filter((e) => e?.node?.shortcode).map((e) => {
      const n = e.node;
      return {
        platformVideoId: String(n.shortcode),
        url: `https://www.instagram.com/${n.is_video ? "reel" : "p"}/${n.shortcode}/`,
        thumbnailUrl: n.thumbnail_src ?? n.display_url,
        title: n.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 500),
        publishedAt: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000) : undefined,
        views: Number(n.video_view_count ?? n.video_play_count ?? 0),
        likes: Number(n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0),
        comments: Number(n.edge_media_to_comment?.count ?? 0),
      };
    }),
  };
}

// ─── TikTok (scraping JSON di rehydration) ────────────────────────────────────
export async function fetchTikTokChannel(handle: string): Promise<FetchedChannel> {
  const html = await httpGet(`https://www.tiktok.com/@${encodeURIComponent(handle)}`);
  const marker = html.indexOf('id="__UNIVERSAL_DATA_FOR_REHYDRATION__"');
  let data: any = null;
  if (marker >= 0) {
    const start = html.indexOf(">", marker) + 1;
    const end = html.indexOf("</script>", start);
    try {
      data = JSON.parse(html.slice(start, end));
    } catch {
      data = null;
    }
  }
  const scope = data?.__DEFAULT_SCOPE__ ?? {};
  const userInfo = scope["webapp.user-detail"]?.userInfo;
  if (!userInfo?.user) {
    throw new Error(
      `Profilo TikTok "@${handle}" non leggibile dal server (TikTok blocca spesso gli IP datacenter). I dati possono arrivare dall'agente VPS via /api/social/watchlist/ingest`
    );
  }

  const channel: FetchedChannel = {
    handle,
    displayName: userInfo.user.nickname || handle,
    avatarUrl: userInfo.user.avatarLarger ?? userInfo.user.avatarMedium,
    followers: Number(userInfo.stats?.followerCount ?? 0),
    platformChannelId: userInfo.user.id,
    videos: [],
  };

  // La lista video è presente solo in alcune risposte (ItemModule legacy o item-list)
  const itemModule = data?.ItemModule ?? scope["webapp.video-detail"]?.itemInfo;
  const items: any[] = itemModule
    ? Object.values(itemModule)
    : (scope["webapp.user-detail"]?.itemList ?? []);
  for (const it of items) {
    if (!it?.id) continue;
    channel.videos.push({
      platformVideoId: String(it.id),
      url: `https://www.tiktok.com/@${handle}/video/${it.id}`,
      thumbnailUrl: it.video?.cover ?? it.video?.dynamicCover,
      title: (it.desc ?? "").slice(0, 500),
      publishedAt: it.createTime ? new Date(Number(it.createTime) * 1000) : undefined,
      views: Number(it.stats?.playCount ?? 0),
      likes: Number(it.stats?.diggCount ?? 0),
      comments: Number(it.stats?.commentCount ?? 0),
      shares: Number(it.stats?.shareCount ?? 0),
      durationSec: it.video?.duration ? Number(it.video.duration) : undefined,
    });
  }
  return channel;
}

// ─── Apify: fallback affidabile per Instagram/TikTok ──────────────────────────
// Instagram e TikTok bloccano il fetch anonimo ovunque; Apify gestisce proxy e
// blocchi. Costi (tier FREE, $5/mese inclusi): IG ~$0.0026/profilo per refresh,
// TikTok ~$0.003/video. Richiede APIFY_TOKEN nelle env (Railway Variables).

export function hasApifyToken(): boolean {
  return Boolean(process.env.APIFY_TOKEN);
}

export async function apifyRunSync<T>(actorId: string, input: unknown): Promise<T[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN non configurato nelle variabili d'ambiente");
  await assertAndChargeApify(actorId); // budget guard mensile (piano free $5)
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify ${actorId}: HTTP ${res.status} ${text.slice(0, 180)}`);
  }
  const json = (await res.json()) as T[];
  return Array.isArray(json) ? json : [];
}

/**
 * Run asincrono + polling: `run-sync-get-dataset-items` muore a 120-300s, quindi
 * per gli scrape grossi (centinaia di ads di un brand) serve avviare il run,
 * aspettare che finisca e poi leggere il dataset paginato.
 */
export async function apifyRunAsync<T>(
  actorId: string,
  input: unknown,
  opts: { maxWaitMs?: number; limit?: number } = {},
): Promise<T[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN non configurato nelle variabili d'ambiente");
  await assertAndChargeApify(actorId); // budget guard mensile (piano free $5)
  const maxWaitMs = opts.maxWaitMs ?? 8 * 60_000;
  const limit = opts.limit ?? 1000;

  const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  });
  if (!startRes.ok) {
    const text = await startRes.text().catch(() => "");
    throw new Error(`Apify ${actorId}: avvio run HTTP ${startRes.status} ${text.slice(0, 180)}`);
  }
  const startJson = (await startRes.json()) as { data?: { id?: string; defaultDatasetId?: string } };
  const runId = startJson.data?.id;
  const datasetId = startJson.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error(`Apify ${actorId}: run non avviato (risposta inattesa)`);

  const deadline = Date.now() + maxWaitMs;
  let status = "READY";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const stRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!stRes.ok) continue;
    const stJson = (await stRes.json()) as { data?: { status?: string } };
    status = stJson.data?.status ?? status;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) break;
  }
  if (status === "FAILED" || status === "ABORTED") throw new Error(`Apify ${actorId}: run ${status}`);

  // Anche su TIMED-OUT/run ancora attivo leggiamo ciò che è già stato raccolto.
  const items: T[] = [];
  let offset = 0;
  while (items.length < limit) {
    const pageSize = Math.min(1000, limit - items.length);
    const dsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&offset=${offset}&limit=${pageSize}&clean=true`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!dsRes.ok) break;
    const page = (await dsRes.json()) as T[];
    if (!Array.isArray(page) || page.length === 0) break;
    items.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return items;
}

export async function fetchInstagramViaApify(handle: string): Promise<FetchedChannel> {
  type IgProfile = {
    error?: string;
    username?: string;
    fullName?: string;
    followersCount?: number;
    profilePicUrl?: string;
    profilePicUrlHD?: string;
    id?: string;
    latestPosts?: Array<{
      id?: string; type?: string; shortCode?: string; caption?: string; url?: string;
      displayUrl?: string; likesCount?: number; commentsCount?: number;
      videoViewCount?: number; videoPlayCount?: number; timestamp?: string;
    }>;
  };
  const items = await apifyRunSync<IgProfile>("apify~instagram-profile-scraper", { usernames: [handle] });
  const p = items.find((i) => !i.error);
  if (!p) throw new Error(`Apify: profilo Instagram "@${handle}" non trovato (${items[0]?.error ?? "nessun risultato"})`);
  return {
    handle,
    displayName: p.fullName || handle,
    avatarUrl: p.profilePicUrlHD ?? p.profilePicUrl,
    followers: Number(p.followersCount ?? 0),
    platformChannelId: p.id,
    videos: (p.latestPosts ?? []).filter((m) => m.shortCode || m.url).map((m) => ({
      platformVideoId: String(m.shortCode ?? m.id),
      url: m.url ?? `https://www.instagram.com/p/${m.shortCode}/`,
      thumbnailUrl: m.displayUrl,
      title: m.caption?.slice(0, 500),
      publishedAt: m.timestamp ? new Date(m.timestamp) : undefined,
      views: Number(m.videoViewCount ?? m.videoPlayCount ?? 0),
      likes: Number(m.likesCount ?? 0),
      comments: Number(m.commentsCount ?? 0),
    })),
  };
}

export async function fetchTikTokViaApify(handle: string, maxVideos = 25): Promise<FetchedChannel> {
  type TtItem = {
    id?: string; text?: string; createTimeISO?: string; webVideoUrl?: string;
    playCount?: number; diggCount?: number; commentCount?: number; shareCount?: number;
    videoMeta?: { coverUrl?: string; duration?: number };
    authorMeta?: { name?: string; nickName?: string; fans?: number; avatar?: string; id?: string };
  };
  const items = await apifyRunSync<TtItem>("clockworks~tiktok-profile-scraper", {
    profiles: [handle],
    resultsPerPage: maxVideos,
    profileSorting: "latest",
    excludePinnedPosts: false,
  });
  const withAuthor = items.find((i) => i.authorMeta?.name);
  if (!withAuthor && items.length === 0) throw new Error(`Apify: profilo TikTok "@${handle}" non trovato o senza video`);
  const author = withAuthor?.authorMeta;
  return {
    handle,
    displayName: author?.nickName || handle,
    avatarUrl: author?.avatar,
    followers: Number(author?.fans ?? 0),
    platformChannelId: author?.id,
    videos: items.filter((i) => i.id).map((i) => ({
      platformVideoId: String(i.id),
      url: i.webVideoUrl ?? `https://www.tiktok.com/@${handle}/video/${i.id}`,
      thumbnailUrl: i.videoMeta?.coverUrl,
      title: (i.text ?? "").slice(0, 500),
      publishedAt: i.createTimeISO ? new Date(i.createTimeISO) : undefined,
      views: Number(i.playCount ?? 0),
      likes: Number(i.diggCount ?? 0),
      comments: Number(i.commentCount ?? 0),
      shares: Number(i.shareCount ?? 0),
      durationSec: i.videoMeta?.duration != null ? Number(i.videoMeta.duration) : undefined,
    })),
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
export async function fetchChannel(platform: WatchPlatform, handle: string): Promise<FetchedChannel> {
  if (platform === "youtube") return fetchYouTubeChannel(handle);
  if (platform === "instagram") return fetchInstagramChannel(handle);
  return fetchTikTokChannel(handle);
}
