import type { Express, Request, Response } from "express";
import {
  getWatchlistChannels, getWatchlistVideos, setWatchlistVideoAnalysis,
} from "../db";
import {
  addWatchlistChannel, refreshWatchlistChannel, refreshAllWatchlistChannels, ingestWatchlistData,
} from "../watchlistService";
import type { WatchPlatform } from "../watchlist";

// Watchlist endpoints per l'agente VPS / n8n — replica dei tool MCP di Sandcastles:
//   GET  /api/social/watchlist/channels  ≈ lista watchlist
//   GET  /api/social/watchlist/videos    ≈ search_my_videos (lookback_days, limit,
//        min_outlier_score, min_views, platform, sort)
//   POST /api/social/watchlist/channels  ≈ add_channels_to_watchlist
//   POST /api/social/watchlist/refresh   → refresh 1 canale o tutti (per cron/agente)
//   POST /api/social/watchlist/ingest    → l'agente spinge dati scrapeati (IG/TikTok
//        quando bloccano gli IP datacenter di Railway)
//   POST /api/social/watchlist/analysis  ≈ analyze_video (l'agente salva il payload)
// Stessa auth delle altre route social: header x-care-secret = CARE_WEBHOOK_SECRET.
const OWNER_USER_ID = 1;
const VALID_PLATFORMS: WatchPlatform[] = ["youtube", "instagram", "tiktok"];

function checkSecret(req: Request, res: Response): boolean {
  const expected = process.env.CARE_WEBHOOK_SECRET;
  if (!expected) {
    res.status(503).json({ error: "CARE_WEBHOOK_SECRET not configured on the server" });
    return false;
  }
  if (req.headers["x-care-secret"] !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export function registerWatchlistRoutes(app: Express) {
  // Lista canali in watchlist
  app.get("/api/social/watchlist/channels", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const channels = await getWatchlistChannels(OWNER_USER_ID);
      res.json({
        success: true,
        count: channels.length,
        channels: channels.map((c) => ({
          id: c.id,
          platform: c.platform,
          handle: c.handle,
          display_name: c.displayName,
          platform_channel_id: c.platformChannelId,
          followers: c.followers,
          status: c.status,
          last_error: c.lastError,
          last_refresh_at: c.lastRefreshAt,
        })),
      });
    } catch (err) {
      console.warn("[watchlist/channels] error:", err);
      res.status(500).json({ error: "channels failed" });
    }
  });

  // Feed video (equivalente di search_my_videos di Sandcastles)
  app.get("/api/social/watchlist/videos", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const q = req.query;
      const num = (v: unknown, d: number) => {
        const n = parseFloat(String(v ?? ""));
        return Number.isFinite(n) ? n : d;
      };
      const platform = VALID_PLATFORMS.includes(String(q.platform) as WatchPlatform)
        ? (String(q.platform) as WatchPlatform)
        : undefined;
      const sortRaw = String(q.sort ?? "views");
      const videos = await getWatchlistVideos(OWNER_USER_ID, {
        lookbackDays: num(q.lookback_days, 7),
        limit: Math.min(num(q.limit, 25), 200),
        minOutlier: num(q.min_outlier_score, 0),
        minViews: num(q.min_views, 0),
        platform,
        channelId: q.channel_id ? num(q.channel_id, 0) || undefined : undefined,
        sort: sortRaw === "outlier" ? "outlier" : sortRaw === "recent" ? "recent" : "views",
      });
      res.json({
        success: true,
        count: videos.length,
        videos: videos.map((v) => ({
          id: v.id,
          title: v.title,
          platform: v.platform,
          platform_url: v.url,
          thumbnail_url: v.thumbnailUrl,
          view_count: v.views,
          like_count: v.likes,
          comment_count: v.comments,
          share_count: v.shares,
          engagement_rate: v.engagementRate != null ? parseFloat(String(v.engagementRate)) : null,
          outlier_score: v.outlierScore != null ? parseFloat(String(v.outlierScore)) : null,
          published_at: v.publishedAt,
          analyzed: v.analyzedAt != null,
          channel: { handle: v.channelHandle, name: v.channelName, platform: v.platform },
        })),
      });
    } catch (err) {
      console.warn("[watchlist/videos] error:", err);
      res.status(500).json({ error: "videos failed" });
    }
  });

  // Aggiungi canale (equivalente di add_channels_to_watchlist)
  app.post("/api/social/watchlist/channels", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { input, platform } = req.body ?? {};
      if (!input) {
        res.status(400).json({ error: "input (URL o @handle) is required" });
        return;
      }
      const hint = VALID_PLATFORMS.includes(String(platform) as WatchPlatform)
        ? (String(platform) as WatchPlatform)
        : undefined;
      const result = await addWatchlistChannel(OWNER_USER_ID, String(input), hint);
      res.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "add failed";
      console.warn("[watchlist/channels POST] error:", err);
      res.status(400).json({ error: message });
    }
  });

  // Refresh manuale/schedulato: body {channelId} per uno, vuoto per tutti
  app.post("/api/social/watchlist/refresh", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { channelId } = req.body ?? {};
      if (channelId) {
        const r = await refreshWatchlistChannel(Number(channelId));
        res.json({ success: r.ok, ...r });
      } else {
        const r = await refreshAllWatchlistChannels(OWNER_USER_ID);
        res.json({ success: true, ...r });
      }
    } catch (err) {
      console.warn("[watchlist/refresh] error:", err);
      res.status(500).json({ error: "refresh failed" });
    }
  });

  // Ingest dati scrapeati dall'agente VPS (IG/TikTok quando il server è bloccato)
  app.post("/api/social/watchlist/ingest", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { platform, handle, displayName, avatarUrl, followers, platformChannelId, videos } = req.body ?? {};
      if (!VALID_PLATFORMS.includes(platform)) {
        res.status(400).json({ error: "platform must be youtube|instagram|tiktok" });
        return;
      }
      if (!handle) {
        res.status(400).json({ error: "handle is required" });
        return;
      }
      const result = await ingestWatchlistData(OWNER_USER_ID, {
        platform, handle: String(handle), displayName, avatarUrl,
        followers: followers != null ? Number(followers) : undefined,
        platformChannelId: platformChannelId != null ? String(platformChannelId) : undefined,
        videos: Array.isArray(videos) ? videos : [],
      });
      res.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      console.warn("[watchlist/ingest] error:", err);
      res.status(400).json({ error: message });
    }
  });

  // Salva la deep-analysis di un video (equivalente del payload di analyze_video)
  app.post("/api/social/watchlist/analysis", async (req: Request, res: Response) => {
    if (!checkSecret(req, res)) return;
    try {
      const { videoId, url, analysis } = req.body ?? {};
      if (!analysis || (!videoId && !url)) {
        res.status(400).json({ error: "analysis + (videoId | url) are required" });
        return;
      }
      const found = await setWatchlistVideoAnalysis({
        userId: OWNER_USER_ID,
        videoId: videoId != null ? Number(videoId) : undefined,
        url: url ? String(url) : undefined,
        analysis,
      });
      if (!found) {
        res.status(404).json({ error: "video non trovato in watchlist" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.warn("[watchlist/analysis] error:", err);
      res.status(500).json({ error: "analysis failed" });
    }
  });
}
