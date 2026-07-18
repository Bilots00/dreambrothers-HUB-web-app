/**
 * Orchestrazione Watchlist: aggiunta canali, refresh dati, ricalcolo outlier.
 * Usato sia dal router tRPC (web app) sia dalle route REST (agente VPS / n8n).
 */
import {
  findWatchlistChannel, insertWatchlistChannel, updateWatchlistChannel,
  getWatchlistChannelById, getWatchlistChannels, upsertWatchlistVideo,
  getWatchlistVideoViews, setWatchlistVideoOutlier, getMetaAccountsByUserId,
} from "./db";
import { getInstagramBusinessId, instagramBusinessDiscovery } from "./metaApi";
import { delegateToVpsAgent, watchlistScrapeTask } from "./vpsAgent";
import {
  parseChannelInput, fetchChannel, computeOutlierScores, computeEngagementRate,
  fetchInstagramViaApify, fetchTikTokViaApify, hasApifyToken,
  type WatchPlatform, type FetchedChannel, type FetchedVideo,
} from "./watchlist";

const OUTLIER_WINDOW_DAYS = 90;
const REFRESH_CONCURRENCY = 3;

/** Normalizzazione handle unica per add e ingest (evita canali duplicati). */
function cleanHandle(raw: string): string {
  return raw.replace(/^@+/, "").replace(/[/?#].*$/, "").trim();
}

async function getOrCreateChannel(userId: number, platform: WatchPlatform, handle: string): Promise<number> {
  const existing = await findWatchlistChannel(userId, platform, handle);
  if (existing) return existing.id;
  return insertWatchlistChannel({ userId, platform, handle, status: "pending" });
}

/** Ricalcola l'outlier score di tutti i video del canale (mediana ultimi 90gg). */
export async function recomputeChannelOutliers(channelId: number): Promise<void> {
  const since = new Date(Date.now() - OUTLIER_WINDOW_DAYS * 86_400_000);
  let vids = await getWatchlistVideoViews(channelId, since);
  // canali con pochi post recenti: usa tutto lo storico come baseline
  if (vids.filter((v) => v.views > 0).length < 3) vids = await getWatchlistVideoViews(channelId);
  // Instagram via business_discovery non espone le views dei reel: se il canale
  // non ha views usabili, l'outlier si calcola sulla stessa metrica per tutti (i like)
  const useLikes = vids.filter((v) => v.views > 0).length < 3 && vids.filter((v) => v.likes > 0).length >= 3;
  const scores = computeOutlierScores(vids.map((v) => ({ id: v.id, views: useLikes ? v.likes : v.views })));
  const entries: Array<[number, number]> = [];
  scores.forEach((score, id) => entries.push([id, score]));
  for (const [id, score] of entries) await setWatchlistVideoOutlier(id, score);
}

/** Scrive canale + video arrivati da un fetch (o dall'ingest dell'agente VPS). */
export async function storeFetchedChannel(
  userId: number,
  channelId: number,
  platform: WatchPlatform,
  fetched: FetchedChannel
): Promise<{ videosStored: number }> {
  let stored = 0;
  for (const v of fetched.videos) {
    if (!v.platformVideoId) continue;
    const engagement = computeEngagementRate(v);
    await upsertWatchlistVideo({
      userId,
      channelId,
      platform,
      platformVideoId: v.platformVideoId,
      url: v.url,
      thumbnailUrl: v.thumbnailUrl ?? null,
      title: v.title ?? null,
      publishedAt: v.publishedAt ?? null,
      views: v.views ?? 0,
      likes: v.likes ?? 0,
      comments: v.comments ?? 0,
      shares: v.shares ?? 0,
      durationSec: v.durationSec ?? null,
      engagementRate: engagement != null ? engagement.toFixed(4) : null,
    });
    stored++;
  }
  await updateWatchlistChannel(channelId, {
    displayName: fetched.displayName ?? undefined,
    avatarUrl: fetched.avatarUrl ?? undefined,
    followers: fetched.followers ?? undefined,
    platformChannelId: fetched.platformChannelId ?? undefined,
    status: "active",
    lastError: null,
    lastRefreshAt: new Date(),
  });
  await recomputeChannelOutliers(channelId);
  return { videosStored: stored };
}

/**
 * Fallback Instagram: Graph API business_discovery col token Meta già collegato
 * (funziona per account IG business/creator; niente views dei reel, ma follower,
 * like e commenti sì — l'outlier passa automaticamente sui like).
 */
async function fetchInstagramViaMeta(userId: number, handle: string): Promise<FetchedChannel | null> {
  const accounts = await getMetaAccountsByUserId(userId);
  let lastError: unknown = null;
  for (const acc of accounts) {
    if (!acc.accessToken) continue;
    try {
      const igId = await getInstagramBusinessId(acc.accessToken);
      if (!igId) continue;
      const bd = await instagramBusinessDiscovery(acc.accessToken, igId, handle);
      if (!bd) continue;
      return {
        handle,
        displayName: bd.name || handle,
        avatarUrl: bd.profile_picture_url,
        followers: Number(bd.followers_count ?? 0),
        platformChannelId: bd.id,
        videos: (bd.media?.data ?? []).filter((m) => m.permalink).map((m) => ({
          platformVideoId: String(m.id),
          url: String(m.permalink),
          thumbnailUrl: m.thumbnail_url ?? m.media_url,
          title: m.caption?.slice(0, 500),
          publishedAt: m.timestamp ? new Date(m.timestamp) : undefined,
          views: 0, // business_discovery non espone le views: outlier sui like
          likes: Number(m.like_count ?? 0),
          comments: Number(m.comments_count ?? 0),
        })),
      };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/** Refresh completo di un canale: fetch piattaforma → upsert video → outlier. */
export async function refreshWatchlistChannel(channelId: number): Promise<{ ok: boolean; videosStored: number; delegated?: boolean; error?: string }> {
  const channel = await getWatchlistChannelById(channelId);
  if (!channel) return { ok: false, videosStored: 0, error: "Canale non trovato" };
  try {
    let fetched: FetchedChannel;
    try {
      fetched = await fetchChannel(channel.platform as WatchPlatform, channel.handle);
    } catch (err) {
      // IG/TikTok bloccano il fetch web anonimo: catena di fallback.
      // 1) Apify (se APIFY_TOKEN configurato) — proxy gestiti, dati completi
      // 2) solo IG: Graph API business_discovery col token Meta collegato
      const reasons: string[] = [err instanceof Error ? err.message : String(err)];
      let recovered: FetchedChannel | null = null;
      if (channel.platform !== "youtube" && hasApifyToken()) {
        try {
          recovered = channel.platform === "instagram"
            ? await fetchInstagramViaApify(channel.handle)
            : await fetchTikTokViaApify(channel.handle);
        } catch (apifyErr) {
          reasons.push(`Apify: ${apifyErr instanceof Error ? apifyErr.message : String(apifyErr)}`);
        }
      }
      if (!recovered && channel.platform === "instagram") {
        try {
          recovered = await fetchInstagramViaMeta(channel.userId, channel.handle);
        } catch (metaErr) {
          reasons.push(`Graph API: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`);
        }
      }
      if (!recovered) {
        // PIANO B: tutto fallito (Apify esaurito incluso) → delega all'agente VPS
        // che scrapa col browser gratis e ri-carica via /ingest
        if (channel.platform !== "youtube") {
          const d = await delegateToVpsAgent(
            channel.userId,
            `watchlist_${channel.platform}_${channel.handle}`,
            watchlistScrapeTask(channel.platform, channel.handle),
          );
          if (d.delegated) {
            await updateWatchlistChannel(channelId, { status: "pending", lastError: "In attesa di sync dal browser: apri instagram.com (con lo script Watchlist attivo) e il canale si popola da solo", lastRefreshAt: new Date() });
            return { ok: true, videosStored: 0, delegated: true };
          }
        }
        throw new Error(reasons.join(" — "));
      }
      fetched = recovered;
    }
    const { videosStored } = await storeFetchedChannel(channel.userId, channel.id, channel.platform as WatchPlatform, fetched);
    return { ok: true, videosStored };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateWatchlistChannel(channelId, { status: "error", lastError: message, lastRefreshAt: new Date() });
    return { ok: false, videosStored: 0, error: message };
  }
}

/** Aggiunge un canale (da URL o handle+piattaforma) e fa subito il primo refresh. */
export async function addWatchlistChannel(
  userId: number,
  rawInput: string,
  platformHint?: WatchPlatform
): Promise<{ channelId: number; platform: WatchPlatform; handle: string; refresh: { ok: boolean; videosStored: number; error?: string } }> {
  const { platform, handle } = parseChannelInput(rawInput, platformHint);
  const channelId = await getOrCreateChannel(userId, platform, handle);
  const refresh = await refreshWatchlistChannel(channelId);
  return { channelId, platform, handle, refresh };
}

/** Refresh di tutti i canali dell'utente, a piccoli lotti concorrenti (rate limit ok). */
export async function refreshAllWatchlistChannels(userId: number): Promise<{ refreshed: number; errors: { handle: string; error: string }[]; skipped?: number }> {
  const all = await getWatchlistChannels(userId);
  // I canali IG/TikTok costano Apify: nel refresh massivo (bottone/scheduler)
  // salta quelli aggiornati nelle ultime 20h. YouTube è gratis → sempre.
  const COOLDOWN_MS = 20 * 3_600_000;
  const channels = all.filter((ch) => {
    if (ch.platform === "youtube") return true;
    const last = ch.lastRefreshAt ? new Date(ch.lastRefreshAt).getTime() : 0;
    return Date.now() - last > COOLDOWN_MS;
  });
  const skipped = all.length - channels.length;
  let refreshed = 0;
  const errors: { handle: string; error: string }[] = [];
  for (let i = 0; i < channels.length; i += REFRESH_CONCURRENCY) {
    const batch = channels.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.all(batch.map((ch) => refreshWatchlistChannel(ch.id)));
    results.forEach((r, j) => {
      if (r.ok) refreshed++;
      else errors.push({ handle: `${batch[j].platform}/@${batch[j].handle}`, error: r.error ?? "sconosciuto" });
    });
  }
  return { refreshed, errors, skipped };
}

/** Ingest dall'agente VPS: upsert canale per handle + video già scrapeati. */
export async function ingestWatchlistData(
  userId: number,
  payload: {
    platform: WatchPlatform;
    handle: string;
    displayName?: string;
    avatarUrl?: string;
    followers?: number;
    videos?: Array<Partial<FetchedVideo> & { platformVideoId?: string; url?: string; publishedAt?: string | Date }>;
  }
): Promise<{ channelId: number; videosStored: number }> {
  const handle = cleanHandle(payload.handle);
  if (!handle) throw new Error("handle mancante");
  const channelId = await getOrCreateChannel(userId, payload.platform, handle);

  // url obbligatorio (è il link cliccabile della UI); id ricavabile dall'url ma
  // troncato a 191 char (VARCHAR + chiave unica)
  const videos: FetchedVideo[] = (payload.videos ?? [])
    .filter((v) => v.url)
    .map((v) => ({
      platformVideoId: String(v.platformVideoId ?? v.url).slice(0, 191),
      url: String(v.url),
      thumbnailUrl: v.thumbnailUrl,
      title: v.title,
      publishedAt: v.publishedAt ? new Date(v.publishedAt) : undefined,
      views: Number(v.views ?? 0),
      likes: Number(v.likes ?? 0),
      comments: Number(v.comments ?? 0),
      shares: Number(v.shares ?? 0),
      durationSec: v.durationSec != null ? Number(v.durationSec) : undefined,
    }));

  const { videosStored } = await storeFetchedChannel(userId, channelId, payload.platform, {
    handle,
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl,
    followers: payload.followers != null ? Number(payload.followers) : undefined,
    videos,
  });
  return { channelId, videosStored };
}
