import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  bigint,
  uniqueIndex,
  mediumtext,
  customType,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Meta Accounts ────────────────────────────────────────────────────────────
export const metaAccounts = mysqlTable("meta_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  accountName: varchar("accountName", { length: 255 }),
  accessToken: text("accessToken"),
  tokenExpiresAt: timestamp("tokenExpiresAt"),
  currency: varchar("currency", { length: 8 }).default("EUR"),
  timezone: varchar("timezone", { length: 64 }).default("Europe/Rome"),
  status: mysqlEnum("status", ["active", "disconnected", "error"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MetaAccount = typeof metaAccounts.$inferSelect;

// ─── Campaigns ────────────────────────────────────────────────────────────────
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  metaAccountId: int("metaAccountId").notNull(),
  metaCampaignId: varchar("metaCampaignId", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  objective: mysqlEnum("objective", [
    "OUTCOME_TRAFFIC",
    "OUTCOME_LEADS",
    "OUTCOME_SALES",
    "OUTCOME_AWARENESS",
    "OUTCOME_ENGAGEMENT",
    "OUTCOME_APP_PROMOTION",
  ]).notNull(),
  status: mysqlEnum("status", ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED", "DRAFT"]).default("DRAFT").notNull(),
  dailyBudget: decimal("dailyBudget", { precision: 12, scale: 2 }),
  lifetimeBudget: decimal("lifetimeBudget", { precision: 12, scale: 2 }),
  budgetLimit: decimal("budgetLimit", { precision: 12, scale: 2 }),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  specialAdCategory: varchar("specialAdCategory", { length: 64 }).default("NONE"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;

// ─── Ad Sets ──────────────────────────────────────────────────────────────────
export const adSets = mysqlTable("ad_sets", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  metaAdSetId: varchar("metaAdSetId", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED").notNull(),
  dailyBudget: decimal("dailyBudget", { precision: 12, scale: 2 }),
  bidStrategy: varchar("bidStrategy", { length: 64 }).default("LOWEST_COST_WITHOUT_CAP"),
  billingEvent: varchar("billingEvent", { length: 64 }).default("IMPRESSIONS"),
  optimizationGoal: varchar("optimizationGoal", { length: 64 }).default("CONVERSIONS"),
  targeting: json("targeting"),
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdSet = typeof adSets.$inferSelect;

// ─── Ads ──────────────────────────────────────────────────────────────────────
export const ads = mysqlTable("ads", {
  id: int("id").autoincrement().primaryKey(),
  adSetId: int("adSetId").notNull(),
  metaAdId: varchar("metaAdId", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]).default("PAUSED").notNull(),
  headline: text("headline"),
  primaryText: text("primaryText"),
  description: text("description"),
  callToAction: varchar("callToAction", { length: 64 }).default("LEARN_MORE"),
  imageUrl: text("imageUrl"),
  videoUrl: text("videoUrl"),
  destinationUrl: text("destinationUrl"),
  isAiGenerated: boolean("isAiGenerated").default(false),
  abTestGroup: varchar("abTestGroup", { length: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Ad = typeof ads.$inferSelect;

// ─── KPI Snapshots ────────────────────────────────────────────────────────────
export const kpiSnapshots = mysqlTable("kpi_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  metaAccountId: int("metaAccountId"),
  campaignId: int("campaignId"),
  adId: int("adId"),
  snapshotDate: timestamp("snapshotDate").notNull(),
  impressions: bigint("impressions", { mode: "number" }).default(0),
  clicks: bigint("clicks", { mode: "number" }).default(0),
  spend: decimal("spend", { precision: 12, scale: 2 }).default("0"),
  conversions: int("conversions").default(0),
  leads: int("leads").default(0),
  reach: bigint("reach", { mode: "number" }).default(0),
  frequency: decimal("frequency", { precision: 8, scale: 4 }).default("0"),
  ctr: decimal("ctr", { precision: 8, scale: 4 }).default("0"),
  cpc: decimal("cpc", { precision: 10, scale: 4 }).default("0"),
  cpm: decimal("cpm", { precision: 10, scale: 4 }).default("0"),
  cpa: decimal("cpa", { precision: 10, scale: 4 }).default("0"),
  cpl: decimal("cpl", { precision: 10, scale: 4 }).default("0"),
  roas: decimal("roas", { precision: 10, scale: 4 }).default("0"),
  conversionRate: decimal("conversionRate", { precision: 8, scale: 4 }).default("0"),
  revenue: decimal("revenue", { precision: 12, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;

// ─── Goals ────────────────────────────────────────────────────────────────────
export const goals = mysqlTable("goals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId"),
  metaAccountId: int("metaAccountId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  goalType: mysqlEnum("goalType", ["leads", "sales", "registrations", "traffic", "awareness"]).notNull(),
  targetValue: decimal("targetValue", { precision: 12, scale: 2 }).notNull(),
  targetUnit: varchar("targetUnit", { length: 64 }).default("count"),
  budgetMax: decimal("budgetMax", { precision: 12, scale: 2 }).notNull(),
  budgetSpent: decimal("budgetSpent", { precision: 12, scale: 2 }).default("0"),
  currentValue: decimal("currentValue", { precision: 12, scale: 2 }).default("0"),
  status: mysqlEnum("status", ["pending", "running", "paused", "completed", "failed"]).default("pending").notNull(),
  agentRunning: boolean("agentRunning").default(false),
  agentStartedAt: timestamp("agentStartedAt"),
  agentStoppedAt: timestamp("agentStoppedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Goal = typeof goals.$inferSelect;

// ─── Agent Logs ───────────────────────────────────────────────────────────────
export const agentLogs = mysqlTable("agent_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  goalId: int("goalId"),
  campaignId: int("campaignId"),
  adId: int("adId"),
  actionType: mysqlEnum("actionType", [
    "audit",
    "copy_generation",
    "campaign_create",
    "ad_activate",
    "ad_pause",
    "budget_increase",
    "budget_decrease",
    "budget_reallocate",
    "ab_test_create",
    "ab_test_evaluate",
    "optimization",
    "alert_triggered",
    "goal_started",
    "goal_completed",
    "goal_failed",
    "tracking_setup",
    "disaster_recovery",
  ]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  reasoning: text("reasoning"),
  actionDetails: json("actionDetails"),
  kpiBefore: json("kpiBefore"),
  kpiAfter: json("kpiAfter"),
  impact: mysqlEnum("impact", ["positive", "neutral", "negative", "critical"]).default("neutral"),
  severity: mysqlEnum("severity", ["info", "warning", "error", "critical"]).default("info"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentLog = typeof agentLogs.$inferSelect;

// ─── AB Tests ─────────────────────────────────────────────────────────────────
export const abTests = mysqlTable("ab_tests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  hypothesis: text("hypothesis"),
  variantAAdId: int("variantAAdId"),
  variantBAdId: int("variantBAdId"),
  status: mysqlEnum("status", ["running", "paused", "completed", "cancelled"]).default("running").notNull(),
  winnerVariant: varchar("winnerVariant", { length: 4 }),
  confidenceLevel: decimal("confidenceLevel", { precision: 6, scale: 4 }),
  statisticalSignificance: boolean("statisticalSignificance").default(false),
  startDate: timestamp("startDate").defaultNow(),
  endDate: timestamp("endDate"),
  conclusionNotes: text("conclusionNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AbTest = typeof abTests.$inferSelect;

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId"),
  goalId: int("goalId"),
  alertType: mysqlEnum("alertType", [
    "budget_anomaly",
    "performance_drop",
    "api_error",
    "spend_limit_reached",
    "cpa_spike",
    "roas_drop",
    "ad_rejected",
    "account_disabled",
    "goal_at_risk",
  ]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  details: json("details"),
  isRead: boolean("isRead").default(false),
  isResolved: boolean("isResolved").default(false),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Alert = typeof alerts.$inferSelect;

// ─── Copy Generations ─────────────────────────────────────────────────────────
export const copyGenerations = mysqlTable("copy_generations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId"),
  prompt: text("prompt").notNull(),
  objective: varchar("objective", { length: 255 }),
  targetAudience: text("targetAudience"),
  productDescription: text("productDescription"),
  tone: varchar("tone", { length: 64 }).default("professional"),
  generatedHeadlines: json("generatedHeadlines"),
  generatedPrimaryTexts: json("generatedPrimaryTexts"),
  generatedDescriptions: json("generatedDescriptions"),
  selectedHeadline: text("selectedHeadline"),
  selectedPrimaryText: text("selectedPrimaryText"),
  selectedDescription: text("selectedDescription"),
  usedInAdId: int("usedInAdId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CopyGeneration = typeof copyGenerations.$inferSelect;

// ─── Tracking Configs ─────────────────────────────────────────────────────────
export const trackingConfigs = mysqlTable("tracking_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  metaAccountId: int("metaAccountId").notNull(),
  pixelId: varchar("pixelId", { length: 64 }),
  pixelName: varchar("pixelName", { length: 255 }),
  pixelInstalled: boolean("pixelInstalled").default(false),
  pixelVerifiedAt: timestamp("pixelVerifiedAt"),
  capiEnabled: boolean("capiEnabled").default(false),
  capiAccessToken: text("capiAccessToken"),
  capiTestEventCode: varchar("capiTestEventCode", { length: 64 }),
  websiteUrl: text("websiteUrl"),
  trackedEvents: json("trackedEvents"),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TrackingConfig = typeof trackingConfigs.$inferSelect;

// ─── User Settings (backup cloud di localStorage) ────────────────────────────
export const userSettings = mysqlTable("user_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  settingKey: varchar("settingKey", { length: 128 }).notNull(),
  settingValue: text("settingValue"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSetting = typeof userSettings.$inferSelect;

// ─── Customer Care: Conversations ─────────────────────────────────────────────
export const csConversations = mysqlTable("cs_conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  channel: varchar("channel", { length: 32 }).notNull(),
  customerName: varchar("customerName", { length: 255 }),
  customerHandle: varchar("customerHandle", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["open", "ai_handled", "needs_human", "archived"]).default("open").notNull(),
  unread: boolean("unread").default(true).notNull(),
  starred: boolean("starred").default(false).notNull(),
  flagReason: text("flagReason"),
  channelUrl: text("channelUrl"),
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CsConversation = typeof csConversations.$inferSelect;

// ─── Customer Care: Messages ──────────────────────────────────────────────────
export const csMessages = mysqlTable("cs_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  direction: mysqlEnum("direction", ["in", "out"]).notNull(),
  sender: mysqlEnum("sender", ["customer", "ai", "human"]).notNull(),
  text: text("text").notNull(),
  status: mysqlEnum("status", ["new", "handled"]).default("new").notNull(),
  handledBy: mysqlEnum("handledBy", ["claude", "openai", "human"]),
  needsHuman: boolean("needsHuman").default(false).notNull(),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  handledAt: timestamp("handledAt"),
});

export type CsMessage = typeof csMessages.$inferSelect;

// ─── Social: Drafts (AI-generated content, review-first) ──────────────────────
export const socialDrafts = mysqlTable("social_drafts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  platform: varchar("platform", { length: 32 }).notNull(),
  format: varchar("format", { length: 32 }).notNull(),
  title: varchar("title", { length: 255 }),
  caption: text("caption"),
  hashtags: text("hashtags"),
  assets: json("assets"),
  status: mysqlEnum("status", ["draft", "scheduled", "published", "rejected"]).default("draft").notNull(),
  scheduledAt: timestamp("scheduledAt"),
  createdBy: varchar("createdBy", { length: 64 }).default("ai"),
  sourceUrl: text("sourceUrl"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SocialDraft = typeof socialDrafts.$inferSelect;

// ─── Social: AI Manager chat (local-Claude-primary, mirrors CS) ───────────────
export const socialChatMessages = mysqlTable("social_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  text: text("text").notNull(),
  // canale di origine del messaggio: "web" (AI Manager) | "telegram" (bot db_smm_bot)
  source: varchar("source", { length: 16 }).default("web").notNull(),
  status: mysqlEnum("status", ["new", "handled"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  handledAt: timestamp("handledAt"),
});

export type SocialChatMessage = typeof socialChatMessages.$inferSelect;

// ─── Social: Watchlist canali competitor (replica Sandcastles, dati gratuiti) ──
export const watchlistChannels = mysqlTable("watchlist_channels", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  platform: varchar("platform", { length: 16 }).notNull(), // youtube | instagram | tiktok
  handle: varchar("handle", { length: 191 }).notNull(), // normalizzato senza @
  displayName: varchar("displayName", { length: 255 }),
  avatarUrl: text("avatarUrl"),
  followers: bigint("followers", { mode: "number" }).default(0).notNull(),
  platformChannelId: varchar("platformChannelId", { length: 191 }),
  // pending = appena aggiunto, active = dati ok, error = ultimo refresh fallito
  status: mysqlEnum("status", ["pending", "active", "error"]).default("pending").notNull(),
  lastError: text("lastError"),
  lastRefreshAt: timestamp("lastRefreshAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  uniqueIndex("uq_watch_channel").on(t.userId, t.platform, t.handle),
]);

export type WatchlistChannel = typeof watchlistChannels.$inferSelect;

export const watchlistVideos = mysqlTable("watchlist_videos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  channelId: int("channelId").notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  platformVideoId: varchar("platformVideoId", { length: 191 }).notNull(),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  title: text("title"),
  publishedAt: timestamp("publishedAt"),
  views: bigint("views", { mode: "number" }).default(0).notNull(),
  likes: bigint("likes", { mode: "number" }).default(0).notNull(),
  comments: bigint("comments", { mode: "number" }).default(0).notNull(),
  shares: bigint("shares", { mode: "number" }).default(0).notNull(),
  durationSec: int("durationSec"),
  // engagement = (likes+comments+shares)/views; outlier = views / mediana canale
  engagementRate: decimal("engagementRate", { precision: 8, scale: 4 }),
  outlierScore: decimal("outlierScore", { precision: 8, scale: 2 }),
  // deep-analysis (hook, topic, formato...) compilata dall'agente VPS via REST
  analysisJson: json("analysisJson"),
  analyzedAt: timestamp("analyzedAt"),
  // 🩷 → il video finisce nella tab Templates della Watchlist (da remixare)
  liked: boolean("liked").default(false).notNull(),
  likedAt: timestamp("likedAt"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  // stesso vincolo del CREATE TABLE al boot: l'upsert (onDuplicateKeyUpdate) dipende da questo
  uniqueIndex("uq_watch_video").on(t.channelId, t.platformVideoId),
]);

export type WatchlistVideo = typeof watchlistVideos.$inferSelect;

// ─── SEO & Research: feed di market intelligence (replica dashboard WeAreMarketers) ─
// Notizie/conversazioni/trend da Reddit, Google News, Google Trends, Substack (+
// ingest dall'agente VPS per Gmail ecc.). Punteggi 0-10: viralità (euristica dalla
// fonte), in-target e interesse (LLM, contro la buyer persona del brand).
export const researchItems = mysqlTable("research_items", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  source: varchar("source", { length: 24 }).notNull(), // reddit | news | trends | substack | pinterest | gmail | manual
  sourceDetail: varchar("sourceDetail", { length: 191 }), // r/sub, nome feed, query
  // paese ISO-2 della notizia (IT, US, DE...) o "GLOBAL" per fonti senza geo (reddit/substack in inglese)
  country: varchar("country", { length: 8 }).default("GLOBAL").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  // sha256(url|title) per dedup: le url delle news sono troppo lunghe per una chiave
  urlHash: varchar("urlHash", { length: 64 }).notNull(),
  excerpt: text("excerpt"),
  bodyText: text("bodyText"), // testo integrale (NON "fullText": FULLTEXT è parola riservata MySQL/TiDB)
  brief: text("brief"), // LLM: cosa è successo
  angle: text("angle"), // LLM: chiave di lettura col sistema di credenze del brand
  commentAnalysis: text("commentAnalysis"), // analisi conversazione (agente/LLM)
  viralityScore: int("viralityScore").default(5).notNull(),
  targetScore: int("targetScore"),
  interestScore: int("interestScore"),
  engagement: int("engagement").default(0).notNull(), // metrica grezza (upvotes+commenti)
  status: mysqlEnum("status", ["da_leggere", "salvato", "usato", "cestinato"]).default("da_leggere").notNull(),
  publishedAt: timestamp("publishedAt"),
  enrichedAt: timestamp("enrichedAt"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_research_item").on(t.userId, t.urlHash),
]);

export type ResearchItem = typeof researchItems.$inferSelect;

// ─── Market Intelligence: competitor Shopify stores (clone GLITCH) ────────────
export const marketStores = mysqlTable("market_stores", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 255 }).notNull(), // normalizzato: no schema, no slash finale
  platform: varchar("platform", { length: 16 }).default("shopify").notNull(),
  status: mysqlEnum("status", ["pending", "active", "error", "paused"]).default("pending").notNull(),
  frequencyHours: int("frequencyHours").default(24).notNull(),
  collectionsFilter: text("collectionsFilter"), // JSON array di collection handle (opzionale)
  isShopify: boolean("isShopify").default(true).notNull(),
  productCount: int("productCount").default(0).notNull(),
  lastError: text("lastError"),
  lastRefreshAt: timestamp("lastRefreshAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [uniqueIndex("uq_market_store").on(t.userId, t.domain)]);
export type MarketStore = typeof marketStores.$inferSelect;

export const marketProducts = mysqlTable("market_products", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storeId: int("storeId").notNull(),
  productId: varchar("productId", { length: 64 }).notNull(),
  handle: varchar("handle", { length: 255 }),
  title: text("title").notNull(),
  productType: varchar("productType", { length: 255 }),
  vendor: varchar("vendor", { length: 255 }),
  tags: text("tags"),
  url: text("url"),
  imageUrl: text("imageUrl"),
  minPrice: decimal("minPrice", { precision: 12, scale: 2 }),
  compareAtPrice: decimal("compareAtPrice", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 8 }),
  available: boolean("available").default(true).notNull(),
  totalVariants: int("totalVariants").default(0).notNull(),
  variantsAvailable: int("variantsAvailable").default(0).notNull(),
  publishedAt: timestamp("publishedAt"),
  firstSeenAt: timestamp("firstSeenAt"),
  lastSeenAt: timestamp("lastSeenAt"),
  active: boolean("active").default(true).notNull(),
  bestSellerRank: int("bestSellerRank"),
  reviewCount: int("reviewCount"), // recensioni pubbliche sul prodotto (Judge.me/Loox/JSON-LD) = vendite minime confermate
  estUnits: int("estUnits"),
  estMethod: varchar("estMethod", { length: 24 }),
  estConfidence: varchar("estConfidence", { length: 8 }),
}, (t) => [uniqueIndex("uq_market_product").on(t.storeId, t.productId)]);
export type MarketProduct = typeof marketProducts.$inferSelect;

export const marketSnapshots = mysqlTable("market_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  storeId: int("storeId").notNull(),
  productId: varchar("productId", { length: 64 }).notNull(),
  minPrice: decimal("minPrice", { precision: 12, scale: 2 }),
  compareAtPrice: decimal("compareAtPrice", { precision: 12, scale: 2 }),
  available: boolean("available").default(true).notNull(),
  variantsAvailable: int("variantsAvailable").default(0).notNull(),
  totalVariants: int("totalVariants").default(0).notNull(),
  trueStock: int("trueStock"),
  bestSellerRank: int("bestSellerRank"),
  reviewCount: int("reviewCount"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});
export type MarketSnapshot = typeof marketSnapshots.$inferSelect;

export const marketChanges = mysqlTable("market_changes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storeId: int("storeId").notNull(),
  productId: varchar("productId", { length: 64 }),
  changeType: varchar("changeType", { length: 24 }).notNull(),
  title: text("title"),
  url: text("url"),
  oldValue: text("oldValue"),
  newValue: text("newValue"),
  detail: text("detail"),
  brief: text("brief"),
  angle: text("angle"),
  score: int("score"),
  status: mysqlEnum("status", ["nuovo", "letto", "archiviato"]).default("nuovo").notNull(),
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  enrichedAt: timestamp("enrichedAt"),
});
export type MarketChange = typeof marketChanges.$inferSelect;

// ─── Etsy Product Research (metodo Alura: watchlist shop + vendite per-prodotto) ─
export const etsyShops = mysqlTable("etsy_shops", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  shopName: varchar("shopName", { length: 191 }).notNull(),
  url: text("url"),
  status: mysqlEnum("status", ["pending", "active", "error", "paused"]).default("pending").notNull(),
  lastTotalSales: int("lastTotalSales"),
  lastReviewCount: int("lastReviewCount"),
  reviewRate: decimal("reviewRate", { precision: 6, scale: 4 }), // reviews/sales calibrato
  reviewAverage: decimal("reviewAverage", { precision: 3, scale: 2 }),
  onEtsySinceYear: int("onEtsySinceYear"),
  lastError: text("lastError"),
  lastRefreshAt: timestamp("lastRefreshAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [uniqueIndex("uq_etsy_shop").on(t.userId, t.shopName)]);
export type EtsyShop = typeof etsyShops.$inferSelect;

export const etsyShopSnapshots = mysqlTable("etsy_shop_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  shopId: int("shopId").notNull(),
  totalSales: int("totalSales"),
  reviewCount: int("reviewCount"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});
export type EtsyShopSnapshot = typeof etsyShopSnapshots.$inferSelect;

export const etsyListings = mysqlTable("etsy_listings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  shopId: int("shopId").notNull(),
  listingId: varchar("listingId", { length: 32 }).notNull(),
  title: text("title"),
  url: text("url"),
  imageUrl: text("imageUrl"),
  price: decimal("price", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 8 }),
  reviewCount: int("reviewCount").default(0).notNull(),
  favorites: int("favorites"),
  inCarts: int("inCarts"),
  isBestseller: boolean("isBestseller").default(false).notNull(),
  estSales: int("estSales"),
  estRevenue: int("estRevenue"),
  opportunityScore: int("opportunityScore"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_etsy_listing").on(t.shopId, t.listingId)]);
export type EtsyListingRow = typeof etsyListings.$inferSelect;

// ─── Ad Library finds (Meta/TikTok scans persistiti) + Daily Picks ────────────
export const adFinds = mysqlTable("ad_finds", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  source: varchar("source", { length: 12 }).notNull(), // meta | tiktok
  title: text("title").notNull(),
  domain: varchar("domain", { length: 255 }),
  url: text("url"),
  imageUrl: text("imageUrl"),
  adCount: int("adCount"),
  views: bigint("views", { mode: "number" }),
  likes: int("likes"),
  isShopify: boolean("isShopify").default(false).notNull(),
  keyword: varchar("keyword", { length: 191 }),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
});
export type AdFind = typeof adFinds.$inferSelect;

export const dailyPicks = mysqlTable("daily_picks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  pickDate: varchar("pickDate", { length: 10 }).notNull(), // YYYY-MM-DD Europe/Rome
  source: varchar("source", { length: 12 }).notNull(), // meta | tiktok | etsy | shopify
  title: text("title").notNull(),
  url: text("url"),
  imageUrl: text("imageUrl"),
  price: varchar("price", { length: 32 }),
  reason: text("reason"), // perché l'agente l'ha scelto (brief)
  score: int("score"),
  checked: boolean("checked").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DailyPick = typeof dailyPicks.$inferSelect;

// ─── Mission Control: team di agenti AI del reparto Paid Advertising ──────────
export const mcAgents = mysqlTable("mc_agents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  code: varchar("code", { length: 16 }).notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  role: varchar("role", { length: 255 }).notNull(),
  department: varchar("department", { length: 64 }).notNull(),
  isLiaison: boolean("isLiaison").default(false).notNull(),
  colorHue: varchar("colorHue", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).default("idle").notNull(), // idle | working
  lastActiveAt: timestamp("lastActiveAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_mc_agent").on(t.userId, t.code)]);
export type McAgent = typeof mcAgents.$inferSelect;

export const mcActivity = mysqlTable("mc_activity", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  agentCode: varchar("agentCode", { length: 16 }).notNull(),
  campaignId: int("campaignId"),
  message: text("message").notNull(),
  details: json("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type McActivityRow = typeof mcActivity.$inferSelect;

export const mcCampaignState = mysqlTable("mc_campaign_state", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  campaignId: int("campaignId").notNull(),
  managed: boolean("managed").default(true).notNull(),
  assignedAgentCode: varchar("assignedAgentCode", { length: 16 }).default("polaris").notNull(),
  mcStatus: varchar("mcStatus", { length: 24 }).default("active").notNull(), // generating|publishing|active|needs_attention|review|paused|done
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [uniqueIndex("uq_mc_campaign").on(t.campaignId)]);
export type McCampaignState = typeof mcCampaignState.$inferSelect;

// ─── Ads Inspiration (replica CreativeOS: templates / inspiration / brands) ────
export const adBrands = mysqlTable("ad_brands", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  pageId: varchar("pageId", { length: 64 }).notNull(), // Facebook Page ID (Ads Library)
  category: varchar("category", { length: 64 }),
  logoUrl: text("logoUrl"),
  status: varchar("status", { length: 16 }).default("pending").notNull(), // pending|active|error
  lastError: text("lastError"),
  adCount: int("adCount").default(0).notNull(),
  lastRefreshAt: timestamp("lastRefreshAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [uniqueIndex("uq_ad_brand").on(t.userId, t.pageId)]);
export type AdBrand = typeof adBrands.$inferSelect;

export const adInspirations = mysqlTable("ad_inspirations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  brandId: int("brandId"),
  source: varchar("source", { length: 24 }).default("fb_ads_library").notNull(),
  adArchiveId: varchar("adArchiveId", { length: 64 }).notNull(),
  pageName: varchar("pageName", { length: 191 }),
  format: varchar("format", { length: 16 }).default("ads").notNull(), // ads|emails|landers
  title: text("title"),
  bodyText: text("bodyText"),
  ctaText: varchar("ctaText", { length: 64 }),
  landingUrl: text("landingUrl"),
  imageUrl: text("imageUrl"),
  videoUrl: text("videoUrl"),
  thumbnailUrl: text("thumbnailUrl"),
  startedRunningAt: timestamp("startedRunningAt"),
  activeDays: int("activeDays").default(0).notNull(), // proxy di performance: più gira, più vince
  score: int("score").default(0).notNull(),
  liked: boolean("liked").default(false).notNull(), // 🩷 → appare nella tab Templates
  likedAt: timestamp("likedAt"),
  raw: json("raw"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_ad_inspiration").on(t.userId, t.adArchiveId)]);
export type AdInspiration = typeof adInspirations.$inferSelect;

// ─── AI Manager (chat con l'orchestrator Polaris, stile Athena) ────────────────
export const metaChatMessages = mysqlTable("meta_chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  text: text("text").notNull(),
  source: varchar("source", { length: 16 }).default("web").notNull(),
  status: mysqlEnum("status", ["new", "handled"]).default("new").notNull(),
  actionJson: json("actionJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  handledAt: timestamp("handledAt"),
});
export type MetaChatMessage = typeof metaChatMessages.$inferSelect;

// ─── Claude Sessions (le sessioni Claude, ovunque: web, Telegram, Claude Code) ─
// Stesso modello "agente-primario" di social_chat_messages, ma con la sessione
// come contenitore: la web app scrive i messaggi dell'owner, l'agente Claude
// (VPS o locale) fa polling su /api/claude/pending e risponde via /api/claude/reply.
// externalId = chiave stabile per l'upsert dei transcript importati da Claude Code.
export const claudeSessions = mysqlTable("claude_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  // canale che ha creato la sessione: "web" | "telegram" | "code"
  source: varchar("source", { length: 16 }).default("web").notNull(),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  // slug/id stabile lato Claude Code, per l'upsert idempotente dei transcript
  externalId: varchar("externalId", { length: 191 }),
  lastPreview: varchar("lastPreview", { length: 280 }),
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClaudeSession = typeof claudeSessions.$inferSelect;
export type InsertClaudeSession = typeof claudeSessions.$inferInsert;

export const claudeSessionMessages = mysqlTable("claude_session_messages", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  // MEDIUMTEXT: i turni di Claude Code possono superare i 64KB di TEXT
  text: mediumtext("text").notNull(),
  source: varchar("source", { length: 16 }).default("web").notNull(),
  status: mysqlEnum("status", ["new", "handled"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  handledAt: timestamp("handledAt"),
});

export type ClaudeSessionMessage = typeof claudeSessionMessages.$inferSelect;
export type InsertClaudeSessionMessage = typeof claudeSessionMessages.$inferInsert;

// Allegati delle chat Claude. I byte stanno in MySQL (MEDIUMBLOB, ~16MB): su
// Railway non c'e' object storage configurato e questo evita di aggiungere
// infrastruttura per una feature che gira su pochi file per sessione.
// Se un giorno i volumi crescono, si sposta `data` su S3 tenendo la stessa riga.
export const claudeAttachments = mysqlTable("claude_attachments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionId: int("sessionId").notNull(),
  messageId: int("messageId"),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  size: int("size").notNull(),
  kind: mysqlEnum("kind", ["file", "image", "voice"]).default("file").notNull(),
  // Trascrizione del vocale (dettata dal browser): e' cio' che legge l'agente,
  // che non puo' ascoltare l'audio.
  transcript: text("transcript"),
  data: customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => "mediumblob",
  })("data").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClaudeAttachment = typeof claudeAttachments.$inferSelect;
