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
  source: varchar("source", { length: 24 }).notNull(), // reddit | news | trends | substack | gmail | manual
  sourceDetail: varchar("sourceDetail", { length: 191 }), // r/sub, nome feed, query
  title: text("title").notNull(),
  url: text("url"),
  // sha256(url|title) per dedup: le url delle news sono troppo lunghe per una chiave
  urlHash: varchar("urlHash", { length: 64 }).notNull(),
  excerpt: text("excerpt"),
  fullText: text("fullText"),
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
