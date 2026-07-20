import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerCareRoutes } from "./careRoutes";
import { registerSocialRoutes } from "./socialRoutes";
import { registerClaudeRoutes } from "./claudeRoutes";
import { registerWatchlistRoutes } from "./watchlistRoutes";
import { registerImageProxy } from "./imageProxy";
import { registerResearchRoutes } from "./researchRoutes";
import { registerMarketRoutes } from "./marketRoutes";
import { registerAdsLibraryRoutes } from "./adsLibraryRoutes";
import { registerDailySchedules } from "./scheduler";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { sql } from "drizzle-orm";

// Auto-migrazione all'avvio: appena DATABASE_URL e' impostata su Railway,
// crea/aggiorna le tabelle da solo. Niente comandi manuali.
async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log("[Migrate] DATABASE_URL non impostata — salto le migrazioni");
    return;
  }
  const db = drizzle(process.env.DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[Migrate] Tabelle create/aggiornate con successo");
  } catch (err) {
    console.warn("[Migrate] Migrazione fallita (il sito resta su):", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS user_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      settingKey VARCHAR(128) NOT NULL,
      settingValue TEXT,
      updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_setting (userId, settingKey)
    )`);
    console.log("[Migrate] Tabella user_settings pronta");
  } catch (err) {
    console.warn("[Migrate] user_settings non creata:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS cs_conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      channel VARCHAR(32) NOT NULL,
      customerName VARCHAR(255),
      customerHandle VARCHAR(255) NOT NULL,
      status ENUM('open','ai_handled','needs_human','archived') NOT NULL DEFAULT 'open',
      unread BOOLEAN NOT NULL DEFAULT TRUE,
      starred BOOLEAN NOT NULL DEFAULT FALSE,
      flagReason TEXT,
      channelUrl TEXT,
      lastMessageAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cs_conv (channel, customerHandle)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS cs_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversationId INT NOT NULL,
      direction ENUM('in','out') NOT NULL,
      sender ENUM('customer','ai','human') NOT NULL,
      text TEXT NOT NULL,
      status ENUM('new','handled') NOT NULL DEFAULT 'new',
      handledBy ENUM('claude','openai','human'),
      needsHuman BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handledAt TIMESTAMP NULL,
      INDEX idx_cs_msg_conv (conversationId),
      INDEX idx_cs_msg_status (status)
    )`);
    console.log("[Migrate] Tabelle cs_conversations + cs_messages pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle customer care non create:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS social_drafts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      platform VARCHAR(32) NOT NULL,
      format VARCHAR(32) NOT NULL,
      title VARCHAR(255),
      caption TEXT,
      hashtags TEXT,
      assets JSON,
      status ENUM('draft','scheduled','published','rejected') NOT NULL DEFAULT 'draft',
      scheduledAt TIMESTAMP NULL,
      createdBy VARCHAR(64) DEFAULT 'ai',
      sourceUrl TEXT,
      notes TEXT,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_social_drafts_user (userId),
      INDEX idx_social_drafts_status (status)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS social_chat_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      role ENUM('user','assistant') NOT NULL,
      text TEXT NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'web',
      status ENUM('new','handled') NOT NULL DEFAULT 'new',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handledAt TIMESTAMP NULL,
      INDEX idx_social_chat_user (userId),
      INDEX idx_social_chat_status (status)
    )`);
    console.log("[Migrate] Tabelle social_drafts + social_chat_messages pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle social non create:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS watchlist_channels (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      platform VARCHAR(16) NOT NULL,
      handle VARCHAR(191) NOT NULL,
      displayName VARCHAR(255),
      avatarUrl TEXT,
      followers BIGINT NOT NULL DEFAULT 0,
      platformChannelId VARCHAR(191),
      status ENUM('pending','active','error') NOT NULL DEFAULT 'pending',
      lastError TEXT,
      lastRefreshAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_watch_channel (userId, platform, handle)
    )`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS watchlist_videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      channelId INT NOT NULL,
      platform VARCHAR(16) NOT NULL,
      platformVideoId VARCHAR(191) NOT NULL,
      url TEXT NOT NULL,
      thumbnailUrl TEXT,
      title TEXT,
      publishedAt TIMESTAMP NULL,
      views BIGINT NOT NULL DEFAULT 0,
      likes BIGINT NOT NULL DEFAULT 0,
      comments BIGINT NOT NULL DEFAULT 0,
      shares BIGINT NOT NULL DEFAULT 0,
      durationSec INT,
      engagementRate DECIMAL(8,4),
      outlierScore DECIMAL(8,2),
      analysisJson JSON,
      analyzedAt TIMESTAMP NULL,
      fetchedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_watch_video (channelId, platformVideoId),
      INDEX idx_watch_video_user (userId),
      INDEX idx_watch_video_published (publishedAt)
    )`);
    console.log("[Migrate] Tabelle watchlist_channels + watchlist_videos pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle watchlist non create:", err);
  }
  try {
    // DDL minimale ultra-compatibile TiDB (niente ENUM/DEFAULT CURRENT_TIMESTAMP/indici
    // secondari): la stessa usata da ensureResearchTable() nel percorso di refresh
    await db.execute(sql`CREATE TABLE IF NOT EXISTS research_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      source VARCHAR(24) NOT NULL,
      sourceDetail VARCHAR(191),
      title TEXT NOT NULL,
      url TEXT,
      urlHash VARCHAR(64) NOT NULL,
      excerpt TEXT,
      bodyText TEXT,
      brief TEXT,
      angle TEXT,
      commentAnalysis TEXT,
      viralityScore INT NOT NULL DEFAULT 5,
      targetScore INT,
      interestScore INT,
      engagement INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'da_leggere',
      publishedAt TIMESTAMP NULL,
      enrichedAt TIMESTAMP NULL,
      fetchedAt TIMESTAMP NULL,
      createdAt TIMESTAMP NULL,
      UNIQUE KEY uq_research_item (userId, urlHash)
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabella research_items pronta");
    // Migrazione additiva idempotente: colonna `country` + backfill dai dati esistenti
    const colRes: any = await db.execute(sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'research_items' AND COLUMN_NAME = 'country'`);
    const colRows = Array.isArray(colRes) ? (Array.isArray(colRes[0]) ? colRes[0] : colRes) : [];
    if (!colRows || colRows.length === 0) {
      await db.execute(sql`ALTER TABLE research_items ADD COLUMN country VARCHAR(8) NOT NULL DEFAULT 'GLOBAL'`);
      // backfill: estrai il paese ISO-2 dal sourceDetail ("... IT" / "... US") delle righe geolocalizzate
      await db.execute(sql`UPDATE research_items SET country = UPPER(RIGHT(sourceDetail, 2))
        WHERE (source = 'trends' OR source = 'pinterest') AND sourceDetail REGEXP ' [A-Za-z]{2}$'`);
      // le news italiane storiche erano hardcoded su IT
      await db.execute(sql`UPDATE research_items SET country = 'IT' WHERE source = 'news' AND country = 'GLOBAL'`);
      console.log("[Migrate] research_items.country aggiunta + backfill eseguito");
    }
  } catch (err) {
    console.warn("[Migrate] tabella research_items non creata:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS market_stores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      label VARCHAR(255) NOT NULL,
      domain VARCHAR(255) NOT NULL,
      platform VARCHAR(16) NOT NULL DEFAULT 'shopify',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      frequencyHours INT NOT NULL DEFAULT 24,
      collectionsFilter TEXT,
      isShopify BOOLEAN NOT NULL DEFAULT TRUE,
      productCount INT NOT NULL DEFAULT 0,
      lastError TEXT,
      lastRefreshAt TIMESTAMP NULL,
      createdAt TIMESTAMP NULL,
      updatedAt TIMESTAMP NULL,
      UNIQUE KEY uq_market_store (userId, domain)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS market_products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, storeId INT NOT NULL,
      productId VARCHAR(64) NOT NULL, handle VARCHAR(255), title TEXT NOT NULL,
      productType VARCHAR(255), vendor VARCHAR(255), tags TEXT, url TEXT, imageUrl TEXT,
      minPrice DECIMAL(12,2), compareAtPrice DECIMAL(12,2), currency VARCHAR(8),
      available BOOLEAN NOT NULL DEFAULT TRUE, totalVariants INT NOT NULL DEFAULT 0,
      variantsAvailable INT NOT NULL DEFAULT 0, publishedAt TIMESTAMP NULL,
      firstSeenAt TIMESTAMP NULL, lastSeenAt TIMESTAMP NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
      bestSellerRank INT, estUnits INT, estMethod VARCHAR(24), estConfidence VARCHAR(8),
      UNIQUE KEY uq_market_product (storeId, productId)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS market_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      storeId INT NOT NULL, productId VARCHAR(64) NOT NULL,
      minPrice DECIMAL(12,2), compareAtPrice DECIMAL(12,2),
      available BOOLEAN NOT NULL DEFAULT TRUE, variantsAvailable INT NOT NULL DEFAULT 0,
      totalVariants INT NOT NULL DEFAULT 0, trueStock INT, bestSellerRank INT, reviewCount INT,
      capturedAt TIMESTAMP NULL
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS market_changes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, storeId INT NOT NULL, productId VARCHAR(64),
      changeType VARCHAR(24) NOT NULL, title TEXT, url TEXT, oldValue TEXT, newValue TEXT,
      detail TEXT, brief TEXT, angle TEXT, score INT,
      status VARCHAR(16) NOT NULL DEFAULT 'nuovo', detectedAt TIMESTAMP NULL, enrichedAt TIMESTAMP NULL
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle market_* pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle market non create:", err);
  }
  try {
    for (const s of [
      { label: "DotComCanvas", domain: "dotcomcanvas.de" },
      { label: "iKonick", domain: "ikonick.com" },
      { label: "Gernucci", domain: "gernucci.com" },
    ]) {
      await db.execute(sql`INSERT IGNORE INTO market_stores (userId, label, domain, platform, status, frequencyHours, isShopify, createdAt, updatedAt)
        VALUES (1, ${s.label}, ${s.domain}, 'shopify', 'pending', 24, TRUE, NOW(), NOW())`);
    }
    console.log("[Migrate] market_stores seed pronti");
  } catch (err) {
    console.warn("[Migrate] seed market non inserito:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS etsy_shops (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, shopName VARCHAR(191) NOT NULL, url TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      lastTotalSales INT, lastReviewCount INT, reviewRate DECIMAL(6,4), reviewAverage DECIMAL(3,2),
      onEtsySinceYear INT, lastError TEXT, lastRefreshAt TIMESTAMP NULL,
      createdAt TIMESTAMP NULL, updatedAt TIMESTAMP NULL,
      UNIQUE KEY uq_etsy_shop (userId, shopName)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS etsy_shop_snapshots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shopId INT NOT NULL, totalSales INT, reviewCount INT, capturedAt TIMESTAMP NULL
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS etsy_listings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, shopId INT NOT NULL, listingId VARCHAR(32) NOT NULL,
      title TEXT, url TEXT, price DECIMAL(12,2), currency VARCHAR(8),
      reviewCount INT NOT NULL DEFAULT 0, favorites INT, inCarts INT,
      isBestseller BOOLEAN NOT NULL DEFAULT FALSE, estSales INT, estRevenue INT, opportunityScore INT,
      capturedAt TIMESTAMP NULL, UNIQUE KEY uq_etsy_listing (shopId, listingId)
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle etsy_* pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle etsy non create:", err);
  }
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ad_finds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, source VARCHAR(12) NOT NULL, title TEXT NOT NULL,
      domain VARCHAR(255), url TEXT, imageUrl TEXT, adCount INT, views BIGINT, likes INT,
      isShopify BOOLEAN NOT NULL DEFAULT FALSE, keyword VARCHAR(191), capturedAt TIMESTAMP NULL
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS daily_picks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL, pickDate VARCHAR(10) NOT NULL, source VARCHAR(12) NOT NULL,
      title TEXT NOT NULL, url TEXT, imageUrl TEXT, price VARCHAR(32), reason TEXT, score INT,
      checked BOOLEAN NOT NULL DEFAULT FALSE, createdAt TIMESTAMP NULL
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle ad_finds/daily_picks pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle picks non create:", err);
  }
  try { await db.execute(sql`ALTER TABLE market_products ADD COLUMN reviewCount INT`); console.log("[Migrate] market_products.reviewCount aggiunta"); } catch { /* già presente */ }
  try { await db.execute(sql`ALTER TABLE etsy_listings ADD COLUMN imageUrl TEXT`); console.log("[Migrate] etsy_listings.imageUrl aggiunta"); } catch { /* già presente */ }
  // Migrazione additiva idempotente: colonna `source` (web|telegram) su social_chat_messages
  try {
    const res: any = await db.execute(sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_chat_messages' AND COLUMN_NAME = 'source'`);
    const rows = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : [];
    if (!rows || rows.length === 0) {
      await db.execute(sql`ALTER TABLE social_chat_messages ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'web'`);
      console.log("[Migrate] social_chat_messages.source aggiunta");
    }
  } catch (err) {
    console.warn("[Migrate] colonna source non aggiunta:", err);
  }
  // Mission Control (team agenti Paid Advertising) + AI Manager chat
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS mc_agents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      code VARCHAR(16) NOT NULL,
      name VARCHAR(64) NOT NULL,
      role VARCHAR(255) NOT NULL,
      department VARCHAR(64) NOT NULL,
      isLiaison BOOLEAN NOT NULL DEFAULT FALSE,
      colorHue VARCHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'idle',
      lastActiveAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mc_agent (userId, code)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS mc_activity (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      agentCode VARCHAR(16) NOT NULL,
      campaignId INT NULL,
      message TEXT NOT NULL,
      details JSON,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mc_activity_user (userId),
      INDEX idx_mc_activity_campaign (campaignId)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS mc_campaign_state (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      campaignId INT NOT NULL,
      managed BOOLEAN NOT NULL DEFAULT TRUE,
      assignedAgentCode VARCHAR(16) NOT NULL DEFAULT 'polaris',
      mcStatus VARCHAR(24) NOT NULL DEFAULT 'active',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mc_campaign (campaignId)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS meta_chat_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      role ENUM('user','assistant') NOT NULL,
      text TEXT NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'web',
      status ENUM('new','handled') NOT NULL DEFAULT 'new',
      actionJson JSON,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handledAt TIMESTAMP NULL,
      INDEX idx_meta_chat_user (userId),
      INDEX idx_meta_chat_status (status)
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle mc_* + meta_chat_messages pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle mission control non create:", err);
  }
  // Ads Inspiration (replica CreativeOS): brand watchlist + creative scrapate
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ad_brands (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      name VARCHAR(191) NOT NULL,
      pageId VARCHAR(64) NOT NULL,
      category VARCHAR(64),
      logoUrl TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      lastError TEXT,
      adCount INT NOT NULL DEFAULT 0,
      lastRefreshAt TIMESTAMP NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ad_brand (userId, pageId)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS ad_inspirations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      brandId INT NULL,
      source VARCHAR(24) NOT NULL DEFAULT 'fb_ads_library',
      adArchiveId VARCHAR(64) NOT NULL,
      pageName VARCHAR(191),
      format VARCHAR(16) NOT NULL DEFAULT 'ads',
      title TEXT,
      bodyText TEXT,
      ctaText VARCHAR(64),
      landingUrl TEXT,
      imageUrl TEXT,
      videoUrl TEXT,
      thumbnailUrl TEXT,
      startedRunningAt TIMESTAMP NULL,
      activeDays INT NOT NULL DEFAULT 0,
      score INT NOT NULL DEFAULT 0,
      liked BOOLEAN NOT NULL DEFAULT FALSE,
      likedAt TIMESTAMP NULL,
      raw JSON,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ad_inspiration (userId, adArchiveId),
      INDEX idx_ad_insp_brand (brandId),
      INDEX idx_ad_insp_liked (liked)
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle ad_brands + ad_inspirations pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle ads inspiration non create:", err);
  }
  // Claude Sessions: sessioni Claude continuabili da web / Telegram / Claude Code
  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS claude_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'web',
      status ENUM('active','archived') NOT NULL DEFAULT 'active',
      externalId VARCHAR(191) NULL,
      lastPreview VARCHAR(280) NULL,
      lastMessageAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_claude_session_external (userId, externalId),
      INDEX idx_claude_sessions_user (userId),
      INDEX idx_claude_sessions_status (status),
      INDEX idx_claude_sessions_last (lastMessageAt)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS claude_session_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sessionId INT NOT NULL,
      userId INT NOT NULL,
      role ENUM('user','assistant','system') NOT NULL,
      text MEDIUMTEXT NOT NULL,
      source VARCHAR(16) NOT NULL DEFAULT 'web',
      status ENUM('new','handled') NOT NULL DEFAULT 'new',
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handledAt TIMESTAMP NULL,
      INDEX idx_claude_msg_session (sessionId),
      INDEX idx_claude_msg_user (userId),
      INDEX idx_claude_msg_status (status),
      INDEX idx_claude_msg_created (createdAt)
    ) DEFAULT CHARSET=utf8mb4`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS claude_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT NOT NULL,
      sessionId INT NOT NULL,
      messageId INT NULL,
      filename VARCHAR(255) NOT NULL,
      mimeType VARCHAR(128) NOT NULL,
      size INT NOT NULL,
      kind ENUM('file','image','voice') NOT NULL DEFAULT 'file',
      transcript TEXT NULL,
      data MEDIUMBLOB NOT NULL,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_claude_att_session (sessionId),
      INDEX idx_claude_att_message (messageId),
      INDEX idx_claude_att_user (userId)
    ) DEFAULT CHARSET=utf8mb4`);
    console.log("[Migrate] Tabelle claude_sessions + claude_session_messages + claude_attachments pronte");
  } catch (err) {
    console.warn("[Migrate] tabelle claude sessions non create:", err);
  }
  // Migrazione additiva idempotente: 🩷 sui video della Watchlist (tab Templates)
  try {
    const res: any = await db.execute(sql`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'watchlist_videos' AND COLUMN_NAME = 'liked'`);
    const rows = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : [];
    if (!rows || rows.length === 0) {
      await db.execute(sql`ALTER TABLE watchlist_videos ADD COLUMN liked BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE watchlist_videos ADD COLUMN likedAt TIMESTAMP NULL`);
      console.log("[Migrate] watchlist_videos.liked + likedAt aggiunte");
    }
  } catch (err) {
    console.warn("[Migrate] colonna liked su watchlist_videos non aggiunta:", err);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  await runMigrations();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerCareRoutes(app);
  registerSocialRoutes(app);
  registerClaudeRoutes(app);
  registerWatchlistRoutes(app);
  registerImageProxy(app);
  registerResearchRoutes(app);
  registerMarketRoutes(app);
  registerAdsLibraryRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Job giornalieri (research 09:00, watchlist 08:45 — ora italiana)
  registerDailySchedules();
}

startServer().catch(console.error);
