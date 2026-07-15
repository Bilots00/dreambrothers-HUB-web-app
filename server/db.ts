import { eq, desc, and, or, isNull, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, metaAccounts, campaigns, adSets, ads, kpiSnapshots, goals, agentLogs, abTests, alerts, copyGenerations, trackingConfigs, userSettings, csConversations, csMessages, socialDrafts, socialChatMessages, watchlistChannels, watchlistVideos, researchItems } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Meta Accounts ────────────────────────────────────────────────────────────
export async function getMetaAccountsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(metaAccounts).where(eq(metaAccounts.userId, userId)).orderBy(desc(metaAccounts.createdAt));
}

export async function getMetaAccountById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(metaAccounts).where(eq(metaAccounts.id, id)).limit(1);
  return result[0];
}

export async function upsertMetaAccount(data: typeof metaAccounts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(metaAccounts).values(data).onDuplicateKeyUpdate({ set: { accountName: data.accountName, accessToken: data.accessToken, status: data.status, updatedAt: new Date() } });
}

export async function updateMetaAccountStatus(id: number, status: "active" | "disconnected" | "error") {
  const db = await getDb();
  if (!db) return;
  await db.update(metaAccounts).set({ status, updatedAt: new Date() }).where(eq(metaAccounts.id, id));
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
export async function getCampaignsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns).where(eq(campaigns.userId, userId)).orderBy(desc(campaigns.createdAt));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}

export async function createCampaign(data: typeof campaigns.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(campaigns).values(data);
  return result[0];
}

export async function updateCampaign(id: number, data: Partial<typeof campaigns.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(campaigns).set({ ...data, updatedAt: new Date() }).where(eq(campaigns.id, id));
}

// ─── Ad Sets ──────────────────────────────────────────────────────────────────
export async function getAdSetsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adSets).where(eq(adSets.campaignId, campaignId)).orderBy(desc(adSets.createdAt));
}

export async function createAdSet(data: typeof adSets.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(adSets).values(data);
}

export async function updateAdSet(id: number, data: Partial<typeof adSets.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(adSets).set({ ...data, updatedAt: new Date() }).where(eq(adSets.id, id));
}

// ─── Ads ──────────────────────────────────────────────────────────────────────
export async function getAdsByAdSetId(adSetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(ads).where(eq(ads.adSetId, adSetId)).orderBy(desc(ads.createdAt));
}

export async function getAdById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(ads).where(eq(ads.id, id)).limit(1);
  return result[0];
}

export async function createAd(data: typeof ads.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(ads).values(data);
  return result[0];
}

export async function updateAdStatus(id: number, status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED") {
  const db = await getDb();
  if (!db) return;
  await db.update(ads).set({ status, updatedAt: new Date() }).where(eq(ads.id, id));
}

// ─── KPI Snapshots ────────────────────────────────────────────────────────────
export async function getKpiSnapshotsByUserId(userId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.userId, userId), gte(kpiSnapshots.snapshotDate, since))).orderBy(desc(kpiSnapshots.snapshotDate)).limit(500);
}

export async function getKpiSnapshotsByCampaign(campaignId: number, days = 30) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.select().from(kpiSnapshots).where(and(eq(kpiSnapshots.campaignId, campaignId), gte(kpiSnapshots.snapshotDate, since))).orderBy(desc(kpiSnapshots.snapshotDate)).limit(200);
}

export async function insertKpiSnapshot(data: typeof kpiSnapshots.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(kpiSnapshots).values(data);
}

// ─── Goals ────────────────────────────────────────────────────────────────────
export async function getGoalsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(goals).where(eq(goals.userId, userId)).orderBy(desc(goals.createdAt));
}

export async function getGoalById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return result[0];
}

export async function createGoal(data: typeof goals.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(goals).values(data);
  return result[0];
}

export async function updateGoal(id: number, data: Partial<typeof goals.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(goals).set({ ...data, updatedAt: new Date() }).where(eq(goals.id, id));
}

// ─── Agent Logs ───────────────────────────────────────────────────────────────
export async function getAgentLogsByUserId(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agentLogs).where(eq(agentLogs.userId, userId)).orderBy(desc(agentLogs.createdAt)).limit(limit);
}

export async function insertAgentLog(data: typeof agentLogs.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(agentLogs).values(data);
}

// ─── AB Tests ─────────────────────────────────────────────────────────────────
export async function getAbTestsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(abTests).where(eq(abTests.userId, userId)).orderBy(desc(abTests.createdAt));
}

export async function getAbTestById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(abTests).where(eq(abTests.id, id)).limit(1);
  return result[0];
}

export async function createAbTest(data: typeof abTests.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(abTests).values(data);
}

export async function updateAbTest(id: number, data: Partial<typeof abTests.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(abTests).set({ ...data, updatedAt: new Date() }).where(eq(abTests.id, id));
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
export async function getAlertsByUserId(userId: number, onlyUnread = false) {
  const db = await getDb();
  if (!db) return [];
  const conditions = onlyUnread
    ? and(eq(alerts.userId, userId), eq(alerts.isRead, false))
    : eq(alerts.userId, userId);
  return db.select().from(alerts).where(conditions).orderBy(desc(alerts.createdAt)).limit(100);
}

export async function insertAlert(data: typeof alerts.$inferInsert) {
  const db = await getDb();
  if (!db) return;
  await db.insert(alerts).values(data);
}

export async function markAlertRead(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, id));
}

export async function resolveAlert(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(alerts).set({ isResolved: true, resolvedAt: new Date() }).where(eq(alerts.id, id));
}

// ─── Copy Generations ─────────────────────────────────────────────────────────
export async function getCopyGenerationsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(copyGenerations).where(eq(copyGenerations.userId, userId)).orderBy(desc(copyGenerations.createdAt)).limit(50);
}

export async function insertCopyGeneration(data: typeof copyGenerations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const result = await db.insert(copyGenerations).values(data);
  return result[0];
}

export async function updateCopyGenerationSelection(id: number, headline: string, primaryText: string, description: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(copyGenerations).set({ selectedHeadline: headline, selectedPrimaryText: primaryText, selectedDescription: description }).where(eq(copyGenerations.id, id));
}

// ─── Tracking Configs ─────────────────────────────────────────────────────────
export async function getTrackingConfigByAccount(metaAccountId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(trackingConfigs).where(eq(trackingConfigs.metaAccountId, metaAccountId)).limit(1);
  return result[0];
}

export async function upsertTrackingConfig(data: typeof trackingConfigs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(trackingConfigs).values(data).onDuplicateKeyUpdate({ set: { pixelId: data.pixelId, pixelName: data.pixelName, pixelInstalled: data.pixelInstalled, capiEnabled: data.capiEnabled, websiteUrl: data.websiteUrl, trackedEvents: data.trackedEvents, updatedAt: new Date() } });
}


// ─── User Settings ──────────────────────────────────────────────────────────
export async function getAllUserSettings(userId: number): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  const out: Record<string, string> = {};
  for (const r of rows) { if (r.settingValue != null) out[r.settingKey] = r.settingValue; }
  return out;
}

export async function upsertUserSetting(userId: number, key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(userSettings).values({ userId, settingKey: key, settingValue: value }).onDuplicateKeyUpdate({ set: { settingValue: value } });
}

// ─── Customer Care ────────────────────────────────────────────────────────────
export async function upsertCsConversation(data: {
  userId: number; channel: string; customerName?: string | null; customerHandle: string; channelUrl?: string | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const existing = await db.select().from(csConversations)
    .where(and(eq(csConversations.channel, data.channel), eq(csConversations.customerHandle, data.customerHandle)))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    await db.update(csConversations).set({
      customerName: data.customerName ?? row.customerName,
      channelUrl: data.channelUrl ?? row.channelUrl,
      status: row.status === "archived" ? "open" : row.status,
      unread: true,
      lastMessageAt: new Date(),
    }).where(eq(csConversations.id, row.id));
    return row.id;
  }
  const r = await db.insert(csConversations).values({
    userId: data.userId, channel: data.channel, customerName: data.customerName ?? null,
    customerHandle: data.customerHandle, channelUrl: data.channelUrl ?? null,
    status: "open", unread: true,
  });
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function insertCsMessage(data: typeof csMessages.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(csMessages).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function getCsConversationsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(csConversations).where(eq(csConversations.userId, userId)).orderBy(desc(csConversations.lastMessageAt)).limit(200);
}

export async function getCsMessagesForConversation(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(csMessages).where(eq(csMessages.conversationId, conversationId)).orderBy(csMessages.createdAt);
}

export async function getPendingCsMessages(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    messageId: csMessages.id,
    conversationId: csMessages.conversationId,
    text: csMessages.text,
    createdAt: csMessages.createdAt,
    channel: csConversations.channel,
    customerName: csConversations.customerName,
    customerHandle: csConversations.customerHandle,
  }).from(csMessages)
    .innerJoin(csConversations, eq(csMessages.conversationId, csConversations.id))
    .where(and(eq(csMessages.direction, "in"), eq(csMessages.status, "new")))
    .orderBy(csMessages.createdAt).limit(limit);
}

// Whether a conversation still has an inbound message not yet handled (by Claude/OpenAI/human).
// Used by the n8n ears to decide if they should run the OpenAI fallback or defer to the local Claude agent.
export async function conversationHasPending(conversationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: csMessages.id }).from(csMessages)
    .where(and(eq(csMessages.conversationId, conversationId), eq(csMessages.direction, "in"), eq(csMessages.status, "new")))
    .limit(1);
  return rows.length > 0;
}

export async function recordCsReply(params: {
  conversationId: number; text?: string | null; sender: "ai" | "human"; handledBy: "claude" | "openai" | "human";
  needsHuman?: boolean; reason?: string | null;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const { conversationId, text, sender, handledBy, needsHuman, reason } = params;
  await db.update(csMessages).set({ status: "handled", handledBy, handledAt: new Date() })
    .where(and(eq(csMessages.conversationId, conversationId), eq(csMessages.direction, "in"), eq(csMessages.status, "new")));
  let messageId: number | null = null;
  if (text && text.trim()) {
    const r = await db.insert(csMessages).values({
      conversationId, direction: "out", sender, text, status: "handled", handledBy,
      needsHuman: needsHuman ?? false, reason: reason ?? null,
    });
    messageId = Number((r as unknown as { insertId: number }[])[0].insertId);
  }
  await db.update(csConversations).set({
    status: needsHuman ? "needs_human" : "ai_handled",
    flagReason: needsHuman ? (reason ?? null) : null,
    // AI drafts/escalations keep the thread UNREAD so Andrea sees there is something to review;
    // a human reply means Andrea already handled it, so mark it read.
    unread: handledBy !== "human",
    lastMessageAt: new Date(),
  }).where(eq(csConversations.id, conversationId));
  return messageId;
}

export async function deleteCsConversation(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(csMessages).where(eq(csMessages.conversationId, id));
  await db.delete(csConversations).where(eq(csConversations.id, id));
}

// ─── Social: AI Manager chat + Drafts ─────────────────────────────────────────
export async function insertSocialChatMessage(data: typeof socialChatMessages.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(socialChatMessages).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function getPendingSocialChat(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    messageId: socialChatMessages.id,
    userId: socialChatMessages.userId,
    text: socialChatMessages.text,
    source: socialChatMessages.source,
    createdAt: socialChatMessages.createdAt,
  }).from(socialChatMessages)
    .where(and(eq(socialChatMessages.role, "user"), eq(socialChatMessages.status, "new")))
    .orderBy(desc(socialChatMessages.createdAt))
    .limit(limit);
}

export async function getSocialChatMessages(userId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(socialChatMessages)
    .where(eq(socialChatMessages.userId, userId))
    .orderBy(desc(socialChatMessages.createdAt))
    .limit(limit);
}

export async function recordSocialChatReply(params: { userId: number; text: string; replyToId?: number; source?: string }): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (params.replyToId != null) {
    // marca gestito SOLO il messaggio a cui rispondiamo (evita race web/telegram)
    await db.update(socialChatMessages)
      .set({ status: "handled", handledAt: new Date() })
      .where(eq(socialChatMessages.id, params.replyToId));
  } else {
    await db.update(socialChatMessages)
      .set({ status: "handled", handledAt: new Date() })
      .where(and(eq(socialChatMessages.userId, params.userId), eq(socialChatMessages.role, "user"), eq(socialChatMessages.status, "new")));
  }
  const r = await db.insert(socialChatMessages).values({ userId: params.userId, role: "assistant", text: params.text, status: "handled", source: params.source ?? "web" });
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function insertSocialDraft(data: typeof socialDrafts.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(socialDrafts).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function getSocialDraftsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(socialDrafts).where(eq(socialDrafts.userId, userId)).orderBy(desc(socialDrafts.createdAt)).limit(200);
}

export async function updateSocialDraft(id: number, patch: Partial<typeof socialDrafts.$inferInsert>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(socialDrafts).set(patch).where(eq(socialDrafts.id, id));
}

export async function deleteSocialDraft(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(socialDrafts).where(eq(socialDrafts.id, id));
}

export async function getCsConversationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(csConversations).where(eq(csConversations.id, id)).limit(1);
  return result[0];
}

export async function updateCsConversation(id: number, data: Partial<typeof csConversations.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  await db.update(csConversations).set({ ...data, updatedAt: new Date() }).where(eq(csConversations.id, id));
}

// ─── Social: Watchlist (canali competitor + video, replica Sandcastles) ────────
export async function getWatchlistChannels(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(watchlistChannels)
    .where(eq(watchlistChannels.userId, userId))
    .orderBy(desc(watchlistChannels.createdAt));
}

export async function getWatchlistChannelById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(watchlistChannels).where(eq(watchlistChannels.id, id)).limit(1);
  return rows[0];
}

export async function findWatchlistChannel(userId: number, platform: string, handle: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(watchlistChannels)
    .where(and(eq(watchlistChannels.userId, userId), eq(watchlistChannels.platform, platform), eq(watchlistChannels.handle, handle)))
    .limit(1);
  return rows[0];
}

export async function insertWatchlistChannel(data: typeof watchlistChannels.$inferInsert): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(watchlistChannels).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function updateWatchlistChannel(id: number, patch: Partial<typeof watchlistChannels.$inferInsert>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(watchlistChannels).set(patch).where(eq(watchlistChannels.id, id));
}

export async function deleteWatchlistChannel(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(watchlistVideos).where(eq(watchlistVideos.channelId, id));
  await db.delete(watchlistChannels).where(eq(watchlistChannels.id, id));
}

export async function upsertWatchlistVideo(data: typeof watchlistVideos.$inferInsert): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // Non degradare mai dati buoni: un fetch parziale (scrape fallito a metà, ingest
  // minimale dell'agente) aggiorna solo i campi che conosce davvero.
  await db.insert(watchlistVideos).values(data).onDuplicateKeyUpdate({
    set: {
      ...(data.views != null && data.views > 0 ? { views: data.views } : {}),
      ...(data.likes != null && data.likes > 0 ? { likes: data.likes } : {}),
      ...(data.comments != null && data.comments > 0 ? { comments: data.comments } : {}),
      ...(data.shares != null && data.shares > 0 ? { shares: data.shares } : {}),
      ...(data.title ? { title: data.title } : {}),
      ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}),
      ...(data.engagementRate ? { engagementRate: data.engagementRate } : {}),
      ...(data.durationSec != null ? { durationSec: data.durationSec } : {}),
      ...(data.publishedAt ? { publishedAt: data.publishedAt } : {}),
      fetchedAt: new Date(),
    },
  });
}

/** Video di un canale (id + views) nella finestra, per il calcolo outlier. */
export async function getWatchlistVideoViews(channelId: number, since?: Date) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(watchlistVideos.channelId, channelId)];
  // publishedAt NULL (data sconosciuta, es. Shorts scrapeati) = trattato come recente
  if (since) conds.push(or(gte(watchlistVideos.publishedAt, since), isNull(watchlistVideos.publishedAt))!);
  return db.select({ id: watchlistVideos.id, views: watchlistVideos.views, likes: watchlistVideos.likes })
    .from(watchlistVideos).where(and(...conds));
}

export async function setWatchlistVideoOutlier(id: number, score: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // clamp: DECIMAL(8,2) regge max 999999.99 — un virale su un micro-canale può superarlo
  const clamped = Math.min(score, 9999.99);
  await db.update(watchlistVideos).set({ outlierScore: clamped.toFixed(2) }).where(eq(watchlistVideos.id, id));
}

export interface WatchlistVideoFilters {
  channelId?: number;
  platform?: string;
  lookbackDays?: number;
  minOutlier?: number;
  minViews?: number;
  sort?: "outlier" | "views" | "recent";
  limit?: number;
}

/** Feed video della watchlist con join sul canale (equivalente di search_my_videos). */
export async function getWatchlistVideos(userId: number, f: WatchlistVideoFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(watchlistVideos.userId, userId)];
  if (f.channelId) conds.push(eq(watchlistVideos.channelId, f.channelId));
  if (f.platform) conds.push(eq(watchlistVideos.platform, f.platform));
  if (f.lookbackDays && f.lookbackDays > 0) {
    const since = new Date(Date.now() - f.lookbackDays * 86_400_000);
    // publishedAt NULL (data sconosciuta) resta visibile nel feed
    conds.push(or(gte(watchlistVideos.publishedAt, since), isNull(watchlistVideos.publishedAt))!);
  }
  if (f.minViews && f.minViews > 0) conds.push(gte(watchlistVideos.views, f.minViews));
  if (f.minOutlier && f.minOutlier > 0) {
    conds.push(sql`${watchlistVideos.outlierScore} >= ${f.minOutlier}`);
  }
  const orderBy =
    f.sort === "views" ? desc(watchlistVideos.views)
    : f.sort === "recent" ? desc(watchlistVideos.publishedAt)
    : desc(watchlistVideos.outlierScore);
  return db.select({
    id: watchlistVideos.id,
    channelId: watchlistVideos.channelId,
    platform: watchlistVideos.platform,
    platformVideoId: watchlistVideos.platformVideoId,
    url: watchlistVideos.url,
    thumbnailUrl: watchlistVideos.thumbnailUrl,
    title: watchlistVideos.title,
    publishedAt: watchlistVideos.publishedAt,
    views: watchlistVideos.views,
    likes: watchlistVideos.likes,
    comments: watchlistVideos.comments,
    shares: watchlistVideos.shares,
    durationSec: watchlistVideos.durationSec,
    engagementRate: watchlistVideos.engagementRate,
    outlierScore: watchlistVideos.outlierScore,
    analyzedAt: watchlistVideos.analyzedAt,
    channelHandle: watchlistChannels.handle,
    channelName: watchlistChannels.displayName,
    channelAvatar: watchlistChannels.avatarUrl,
  }).from(watchlistVideos)
    .innerJoin(watchlistChannels, eq(watchlistVideos.channelId, watchlistChannels.id))
    .where(and(...conds))
    .orderBy(orderBy)
    .limit(Math.min(f.limit ?? 60, 200));
}

/** Statistiche aggregate per canale: n. video e somma views negli ultimi 30 giorni. */
export async function getWatchlistChannelStats(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db.select({
    channelId: watchlistVideos.channelId,
    videoCount: sql<number>`COUNT(*)`,
    views30d: sql<number>`COALESCE(SUM(CASE WHEN ${watchlistVideos.publishedAt} >= ${since} THEN ${watchlistVideos.views} ELSE 0 END), 0)`,
  }).from(watchlistVideos)
    .where(eq(watchlistVideos.userId, userId))
    .groupBy(watchlistVideos.channelId);
}

// ─── SEO & Research: feed di market intelligence ───────────────────────────────
export async function insertResearchItemIfNew(data: typeof researchItems.$inferInsert): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    await db.insert(researchItems).values(data);
    return true;
  } catch (err) {
    // duplicato sulla chiave unica (userId, urlHash): già visto, non è un errore
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate/i.test(msg)) return false;
    throw err;
  }
}

export interface ResearchFilters {
  source?: string;
  status?: string;
  hours?: number; // 0 = tutti
  minVirality?: number;
  minTarget?: number;
  search?: string;
  limit?: number;
}

export async function getResearchItems(userId: number, f: ResearchFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(researchItems.userId, userId)];
  if (f.source) conds.push(eq(researchItems.source, f.source));
  if (f.status) conds.push(eq(researchItems.status, f.status as "da_leggere" | "salvato" | "usato" | "cestinato"));
  else conds.push(sql`${researchItems.status} != 'cestinato'`);
  if (f.hours && f.hours > 0) {
    const since = new Date(Date.now() - f.hours * 3_600_000);
    conds.push(or(gte(researchItems.publishedAt, since), and(isNull(researchItems.publishedAt), gte(researchItems.fetchedAt, since)))!);
  }
  if (f.minVirality && f.minVirality > 0) conds.push(gte(researchItems.viralityScore, f.minVirality));
  if (f.minTarget && f.minTarget > 0) conds.push(gte(researchItems.targetScore, f.minTarget));
  if (f.search) conds.push(sql`${researchItems.title} LIKE ${`%${f.search}%`}`);
  return db.select().from(researchItems)
    .where(and(...conds))
    .orderBy(desc(researchItems.viralityScore), desc(researchItems.publishedAt))
    .limit(Math.min(f.limit ?? 100, 300));
}

export async function getResearchItemById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(researchItems).where(eq(researchItems.id, id)).limit(1);
  return rows[0];
}

export async function updateResearchItem(id: number, patch: Partial<typeof researchItems.$inferInsert>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(researchItems).set(patch).where(eq(researchItems.id, id));
}

/** Item non ancora arricchiti dall'LLM, i più virali prima. */
export async function getUnenrichedResearchItems(userId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researchItems)
    .where(and(eq(researchItems.userId, userId), isNull(researchItems.enrichedAt), sql`${researchItems.status} != 'cestinato'`))
    .orderBy(desc(researchItems.viralityScore), desc(researchItems.fetchedAt))
    .limit(limit);
}

/** Salva la deep-analysis di un video (compilata dall'agente VPS). */
export async function setWatchlistVideoAnalysis(params: { userId: number; videoId?: number; url?: string; analysis: unknown }): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const conds = [eq(watchlistVideos.userId, params.userId)];
  if (params.videoId) conds.push(eq(watchlistVideos.id, params.videoId));
  else if (params.url) conds.push(eq(watchlistVideos.url, params.url));
  else return false;
  const r = await db.update(watchlistVideos)
    .set({ analysisJson: params.analysis, analyzedAt: new Date() })
    .where(and(...conds));
  return Number((r as unknown as { affectedRows?: number }[])[0]?.affectedRows ?? 0) > 0;
}
