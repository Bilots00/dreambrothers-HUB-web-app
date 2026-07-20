import { eq, desc, asc, and, or, isNull, gte, lte, sql, notInArray, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, metaAccounts, campaigns, adSets, ads, kpiSnapshots, goals, agentLogs, abTests, alerts, copyGenerations, trackingConfigs, userSettings, csConversations, csMessages, socialDrafts, socialChatMessages, watchlistChannels, watchlistVideos, researchItems, marketStores, marketProducts, marketSnapshots, marketChanges, etsyShops, etsyShopSnapshots, etsyListings, adFinds, dailyPicks, mcAgents, mcActivity, mcCampaignState, metaChatMessages, adBrands, adInspirations, claudeSessions, claudeSessionMessages, claudeAttachments, InsertClaudeSession } from "../drizzle/schema";
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
  liked?: boolean;
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
  if (f.liked) conds.push(eq(watchlistVideos.liked, true));
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
    liked: watchlistVideos.liked,
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
// CREATE minimale ultra-compatibile TiDB: solo PK + UNIQUE (per il dedup), nessun
// ENUM, nessun DEFAULT CURRENT_TIMESTAMP (i timestamp li passiamo espliciti dal codice),
// nessun indice secondario. Eseguibile a ogni refresh (IF NOT EXISTS = idempotente).
const RESEARCH_CREATE_SQL = sql`CREATE TABLE IF NOT EXISTS research_items (
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
  country VARCHAR(8) NOT NULL DEFAULT 'GLOBAL',
  publishedAt TIMESTAMP NULL,
  enrichedAt TIMESTAMP NULL,
  fetchedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NULL,
  UNIQUE KEY uq_research_item (userId, urlHash)
) DEFAULT CHARSET=utf8mb4`;

/** Crea la tabella se manca; ritorna l'errore SQL preciso se il CREATE fallisce. */
export async function ensureResearchTable(): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "DB non disponibile (DATABASE_URL)" };
  try {
    await db.execute(RESEARCH_CREATE_SQL);
    return { ok: true };
  } catch (err) {
    const cause = (err as { cause?: { sqlMessage?: string; message?: string } })?.cause;
    return { ok: false, error: cause?.sqlMessage || cause?.message || (err instanceof Error ? err.message.split("\n")[0] : String(err)) };
  }
}

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
  country?: string; // ISO-2; "GLOBAL" = solo senza-geo; omesso = tutti
  hours?: number; // 0 = tutti
  minVirality?: number;
  minTarget?: number;
  search?: string;
  limit?: number;
  // best = punteggio combinato (viralità + 1.5×target + 1.2×interesse)
  sort?: "best" | "virality" | "target" | "interest" | "engagement" | "recent";
}

export async function getResearchItems(userId: number, f: ResearchFilters = {}) {
  const db = await getDb();
  if (!db) return [];
  const conds = [eq(researchItems.userId, userId)];
  if (f.source) conds.push(eq(researchItems.source, f.source));
  if (f.country) conds.push(eq(researchItems.country, f.country.toUpperCase()));
  if (f.status) conds.push(eq(researchItems.status, f.status as "da_leggere" | "salvato" | "usato" | "cestinato"));
  else conds.push(sql`${researchItems.status} != 'cestinato'`);
  if (f.hours && f.hours > 0) {
    const since = new Date(Date.now() - f.hours * 3_600_000);
    conds.push(or(gte(researchItems.publishedAt, since), and(isNull(researchItems.publishedAt), gte(researchItems.fetchedAt, since)))!);
  }
  if (f.minVirality && f.minVirality > 0) conds.push(gte(researchItems.viralityScore, f.minVirality));
  if (f.minTarget && f.minTarget > 0) conds.push(gte(researchItems.targetScore, f.minTarget));
  if (f.search) conds.push(sql`${researchItems.title} LIKE ${`%${f.search}%`}`);
  // "best" = miglior rapporto combinato: il target pesa più di tutto (lezione
  // anti-traffico-freddo), poi interesse, poi viralità
  const combined = sql`(${researchItems.viralityScore} + COALESCE(${researchItems.targetScore}, 0) * 1.5 + COALESCE(${researchItems.interestScore}, 0) * 1.2)`;
  const orderBy =
    f.sort === "virality" ? [desc(researchItems.viralityScore)]
    : f.sort === "target" ? [desc(sql`COALESCE(${researchItems.targetScore}, -1)`)]
    : f.sort === "interest" ? [desc(sql`COALESCE(${researchItems.interestScore}, -1)`)]
    : f.sort === "engagement" ? [desc(researchItems.engagement)]
    : f.sort === "recent" ? [desc(researchItems.publishedAt)]
    : [desc(combined)];
  return db.select().from(researchItems)
    .where(and(...conds))
    .orderBy(...orderBy, desc(researchItems.publishedAt))
    .limit(Math.min(f.limit ?? 100, 300));
}

/** Paesi distinti presenti nel feed dell'utente (per il dropdown filtro). */
export async function getResearchCountries(userId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.selectDistinct({ country: researchItems.country })
    .from(researchItems)
    .where(and(eq(researchItems.userId, userId), sql`${researchItems.status} != 'cestinato'`));
  return rows.map((r) => r.country).filter(Boolean).sort();
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

// ─── Market Intelligence (competitor Shopify monitor) ─────────────────────────
export async function addMarketStore(userId: number, s: { label: string; domain: string; frequencyHours?: number; collectionsFilter?: string | null; isShopify?: boolean }): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const now = new Date();
  const r = await db.insert(marketStores).values({
    userId, label: s.label, domain: s.domain, status: "pending",
    frequencyHours: s.frequencyHours ?? 24, collectionsFilter: s.collectionsFilter ?? null,
    isShopify: s.isShopify ?? true, createdAt: now, updatedAt: now,
  }).onDuplicateKeyUpdate({ set: { label: s.label, updatedAt: now, status: "pending" } });
  return (r as unknown as { insertId?: number }[])[0]?.insertId ?? 0;
}
export async function removeMarketStore(userId: number, id: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.delete(marketStores).where(and(eq(marketStores.id, id), eq(marketStores.userId, userId)));
}
export async function listMarketStores(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(marketStores).where(eq(marketStores.userId, userId)).orderBy(desc(marketStores.createdAt));
}
export async function getMarketStore(userId: number, id: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(marketStores).where(and(eq(marketStores.id, id), eq(marketStores.userId, userId))).limit(1);
  return r[0];
}
export async function updateMarketStore(id: number, patch: Partial<typeof marketStores.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(marketStores).set({ ...patch, updatedAt: new Date() }).where(eq(marketStores.id, id));
}
export async function getMarketProducts(storeId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(marketProducts).where(eq(marketProducts.storeId, storeId));
}
export async function upsertMarketProduct(row: typeof marketProducts.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(marketProducts).values(row).onDuplicateKeyUpdate({ set: {
    title: row.title, handle: row.handle, productType: row.productType, vendor: row.vendor, tags: row.tags,
    url: row.url, imageUrl: row.imageUrl, minPrice: row.minPrice, compareAtPrice: row.compareAtPrice,
    available: row.available, totalVariants: row.totalVariants, variantsAvailable: row.variantsAvailable,
    lastSeenAt: row.lastSeenAt, active: true,
    ...(row.bestSellerRank != null ? { bestSellerRank: row.bestSellerRank } : {}),
    ...(row.reviewCount != null ? { reviewCount: row.reviewCount } : {}),
    ...(row.estUnits != null ? { estUnits: row.estUnits } : {}),
    ...(row.estMethod != null ? { estMethod: row.estMethod } : {}),
    ...(row.estConfidence != null ? { estConfidence: row.estConfidence } : {}),
  } });
}
export async function markMarketProductsInactive(storeId: number, keepProductIds: string[]) {
  const db = await getDb(); if (!db) return;
  if (keepProductIds.length === 0) { await db.update(marketProducts).set({ active: false }).where(eq(marketProducts.storeId, storeId)); return; }
  await db.update(marketProducts).set({ active: false }).where(and(eq(marketProducts.storeId, storeId), notInArray(marketProducts.productId, keepProductIds)));
}
export async function insertMarketSnapshot(row: typeof marketSnapshots.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(marketSnapshots).values({ ...row, capturedAt: row.capturedAt ?? new Date() });
}
export async function insertMarketChanges(rows: Array<typeof marketChanges.$inferInsert>) {
  const db = await getDb(); if (!db || rows.length === 0) return;
  await db.insert(marketChanges).values(rows.map((r) => ({ ...r, detectedAt: r.detectedAt ?? new Date() })));
}
export async function getMarketChanges(userId: number, f: { storeId?: number; changeType?: string; status?: string; minScore?: number; hours?: number; limit?: number } = {}) {
  const db = await getDb(); if (!db) return [];
  const conds = [eq(marketChanges.userId, userId)];
  if (f.storeId) conds.push(eq(marketChanges.storeId, f.storeId));
  if (f.changeType) conds.push(eq(marketChanges.changeType, f.changeType));
  if (f.status) conds.push(eq(marketChanges.status, f.status as "nuovo" | "letto" | "archiviato"));
  if (f.minScore) conds.push(gte(marketChanges.score, f.minScore));
  if (f.hours) conds.push(gte(marketChanges.detectedAt, new Date(Date.now() - f.hours * 3600_000)));
  return db.select().from(marketChanges).where(and(...conds)).orderBy(desc(marketChanges.detectedAt)).limit(Math.min(f.limit ?? 100, 500));
}
export async function getTopMarketProducts(userId: number, limit = 12) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(marketProducts)
    .where(and(eq(marketProducts.userId, userId), eq(marketProducts.active, true)))
    .orderBy(desc(marketProducts.reviewCount), marketProducts.bestSellerRank)
    .limit(Math.min(limit, 100));
}
export async function getUnenrichedMarketChanges(userId: number, limit = 15) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(marketChanges).where(and(eq(marketChanges.userId, userId), isNull(marketChanges.score))).orderBy(desc(marketChanges.detectedAt)).limit(limit);
}
export async function getMarketChangeById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(marketChanges).where(eq(marketChanges.id, id)).limit(1);
  return r[0];
}
export async function updateMarketChange(id: number, patch: Partial<typeof marketChanges.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(marketChanges).set(patch).where(eq(marketChanges.id, id));
}

// ─── Etsy watchlist (metodo Alura) ────────────────────────────────────────────
export async function addEtsyShop(userId: number, s: { shopName: string; url?: string | null }): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const now = new Date();
  const r = await db.insert(etsyShops).values({ userId, shopName: s.shopName, url: s.url ?? null, status: "pending", createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { status: "pending", updatedAt: now } });
  return (r as unknown as { insertId?: number }[])[0]?.insertId ?? 0;
}
export async function removeEtsyShop(userId: number, id: number): Promise<void> {
  const db = await getDb(); if (!db) return;
  await db.delete(etsyShops).where(and(eq(etsyShops.id, id), eq(etsyShops.userId, userId)));
}
export async function listEtsyShops(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(etsyShops).where(eq(etsyShops.userId, userId)).orderBy(desc(etsyShops.lastTotalSales));
}
export async function getEtsyShop(userId: number, id: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(etsyShops).where(and(eq(etsyShops.id, id), eq(etsyShops.userId, userId))).limit(1);
  return r[0];
}
export async function updateEtsyShop(id: number, patch: Partial<typeof etsyShops.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(etsyShops).set({ ...patch, updatedAt: new Date() }).where(eq(etsyShops.id, id));
}
export async function insertEtsyShopSnapshot(row: typeof etsyShopSnapshots.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(etsyShopSnapshots).values({ ...row, capturedAt: row.capturedAt ?? new Date() });
}
/** Snapshot precedente (per la velocità di vendita): il più recente prima di adesso. */
export async function getPrevEtsyShopSnapshot(shopId: number) {
  const db = await getDb(); if (!db) return undefined;
  const r = await db.select().from(etsyShopSnapshots).where(eq(etsyShopSnapshots.shopId, shopId)).orderBy(desc(etsyShopSnapshots.capturedAt)).limit(1);
  return r[0];
}
export async function upsertEtsyListing(row: typeof etsyListings.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(etsyListings).values({ ...row, capturedAt: row.capturedAt ?? new Date() }).onDuplicateKeyUpdate({ set: {
    title: row.title, url: row.url, price: row.price, currency: row.currency, reviewCount: row.reviewCount,
    favorites: row.favorites, inCarts: row.inCarts, isBestseller: row.isBestseller, estSales: row.estSales,
    estRevenue: row.estRevenue, opportunityScore: row.opportunityScore, capturedAt: row.capturedAt ?? new Date(),
  } });
}
export async function getEtsyListingsByShop(shopId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(etsyListings).where(eq(etsyListings.shopId, shopId)).orderBy(desc(etsyListings.estSales));
}
export async function getTopEtsyListings(userId: number, limit = 50) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(etsyListings).where(eq(etsyListings.userId, userId)).orderBy(desc(etsyListings.estSales)).limit(Math.min(limit, 300));
}

// ─── Ad finds (Meta/TikTok scans persistiti) ──────────────────────────────────
export async function insertAdFinds(rows: Array<typeof adFinds.$inferInsert>) {
  const db = await getDb(); if (!db || rows.length === 0) return;
  await db.insert(adFinds).values(rows.map((r) => ({ ...r, capturedAt: r.capturedAt ?? new Date() })));
}
export async function getRecentAdFinds(userId: number, source: string | undefined, hours = 168, limit = 60) {
  const db = await getDb(); if (!db) return [];
  const conds = [eq(adFinds.userId, userId), gte(adFinds.capturedAt, new Date(Date.now() - hours * 3600_000))];
  if (source) conds.push(eq(adFinds.source, source));
  return db.select().from(adFinds).where(and(...conds)).orderBy(desc(adFinds.adCount), desc(adFinds.capturedAt)).limit(Math.min(limit, 200));
}

// ─── Daily picks (prodotti in evidenza scelti dall'AI agent) ──────────────────
export async function replaceDailyPicks(userId: number, pickDate: string, rows: Array<Omit<typeof dailyPicks.$inferInsert, "userId" | "pickDate">>) {
  const db = await getDb(); if (!db) return;
  await db.delete(dailyPicks).where(and(eq(dailyPicks.userId, userId), eq(dailyPicks.pickDate, pickDate)));
  if (rows.length) await db.insert(dailyPicks).values(rows.map((r) => ({ ...r, userId, pickDate, createdAt: new Date() })));
}
export async function getDailyPicks(userId: number, pickDate: string) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(dailyPicks).where(and(eq(dailyPicks.userId, userId), eq(dailyPicks.pickDate, pickDate))).orderBy(desc(dailyPicks.score));
}
export async function getLatestDailyPicks(userId: number) {
  const db = await getDb(); if (!db) return [];
  const latest = await db.select({ d: dailyPicks.pickDate }).from(dailyPicks).where(eq(dailyPicks.userId, userId)).orderBy(desc(dailyPicks.pickDate)).limit(1);
  if (!latest[0]) return [];
  return db.select().from(dailyPicks).where(and(eq(dailyPicks.userId, userId), eq(dailyPicks.pickDate, latest[0].d))).orderBy(desc(dailyPicks.score));
}
export async function setDailyPickChecked(userId: number, id: number, checked: boolean) {
  const db = await getDb(); if (!db) return;
  await db.update(dailyPicks).set({ checked }).where(and(eq(dailyPicks.id, id), eq(dailyPicks.userId, userId)));
}

// ─── Mission Control: agenti, activity, stato campagne ────────────────────────
export async function upsertMcAgent(data: typeof mcAgents.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(mcAgents).values(data).onDuplicateKeyUpdate({ set: { name: data.name, role: data.role, department: data.department, isLiaison: data.isLiaison, colorHue: data.colorHue } });
}
export async function getMcAgents(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(mcAgents).where(eq(mcAgents.userId, userId)).orderBy(mcAgents.id);
}
export async function updateMcAgentStatus(userId: number, code: string, status: "idle" | "working") {
  const db = await getDb(); if (!db) return;
  await db.update(mcAgents).set({ status, lastActiveAt: new Date() }).where(and(eq(mcAgents.userId, userId), eq(mcAgents.code, code)));
}
export async function setAllMcAgentsIdle(userId: number) {
  const db = await getDb(); if (!db) return;
  await db.update(mcAgents).set({ status: "idle" }).where(eq(mcAgents.userId, userId));
}
export async function insertMcActivity(data: typeof mcActivity.$inferInsert): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(mcActivity).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}
export async function getMcActivity(userId: number, opts: { agentCode?: string; campaignId?: number; limit?: number } = {}) {
  const db = await getDb(); if (!db) return [];
  const conds = [eq(mcActivity.userId, userId)];
  if (opts.agentCode) conds.push(eq(mcActivity.agentCode, opts.agentCode));
  if (opts.campaignId != null) conds.push(eq(mcActivity.campaignId, opts.campaignId));
  return db.select().from(mcActivity).where(and(...conds)).orderBy(desc(mcActivity.createdAt)).limit(Math.min(opts.limit ?? 50, 300));
}
export async function countMcActivityToday(userId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const rows = await db.select({ n: sql<number>`count(*)` }).from(mcActivity)
    .where(and(eq(mcActivity.userId, userId), gte(mcActivity.createdAt, start)));
  return Number(rows[0]?.n ?? 0);
}
export async function getMcCampaignStates(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(mcCampaignState).where(eq(mcCampaignState.userId, userId));
}
export async function upsertMcCampaignState(data: typeof mcCampaignState.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(mcCampaignState).values(data).onDuplicateKeyUpdate({
    set: {
      managed: data.managed ?? true,
      ...(data.assignedAgentCode ? { assignedAgentCode: data.assignedAgentCode } : {}),
      ...(data.mcStatus ? { mcStatus: data.mcStatus } : {}),
    },
  });
}
export async function updateMcCampaignState(campaignId: number, patch: Partial<typeof mcCampaignState.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(mcCampaignState).set(patch).where(eq(mcCampaignState.campaignId, campaignId));
}

// ─── AI Manager: chat con l'orchestrator (Polaris) ────────────────────────────
export async function insertMetaChatMessage(data: typeof metaChatMessages.$inferInsert): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(metaChatMessages).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}
export async function getMetaChatMessages(userId: number, limit = 100) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(metaChatMessages).where(eq(metaChatMessages.userId, userId)).orderBy(desc(metaChatMessages.createdAt)).limit(limit);
}
export async function getMetaChatMessageById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(metaChatMessages).where(eq(metaChatMessages.id, id)).limit(1);
  return rows[0];
}
export async function updateMetaChatMessage(id: number, patch: Partial<typeof metaChatMessages.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(metaChatMessages).set(patch).where(eq(metaChatMessages.id, id));
}

// ─── Ads Inspiration: brand watchlist + creative ──────────────────────────────
export async function getAdBrands(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(adBrands).where(eq(adBrands.userId, userId)).orderBy(desc(adBrands.adCount));
}
export async function getAdBrandById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(adBrands).where(eq(adBrands.id, id)).limit(1);
  return rows[0];
}
export async function getAdBrandByPageId(userId: number, pageId: string) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(adBrands).where(and(eq(adBrands.userId, userId), eq(adBrands.pageId, pageId))).limit(1);
  return rows[0];
}
export async function insertAdBrand(data: typeof adBrands.$inferInsert): Promise<number> {
  const db = await getDb(); if (!db) throw new Error("DB not available");
  const r = await db.insert(adBrands).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}
export async function updateAdBrand(id: number, patch: Partial<typeof adBrands.$inferInsert>) {
  const db = await getDb(); if (!db) return;
  await db.update(adBrands).set(patch).where(eq(adBrands.id, id));
}
export async function deleteAdBrand(userId: number, id: number) {
  const db = await getDb(); if (!db) return;
  await db.delete(adInspirations).where(and(eq(adInspirations.userId, userId), eq(adInspirations.brandId, id)));
  await db.delete(adBrands).where(and(eq(adBrands.userId, userId), eq(adBrands.id, id)));
}
export async function upsertAdInspiration(data: typeof adInspirations.$inferInsert) {
  const db = await getDb(); if (!db) return;
  await db.insert(adInspirations).values(data).onDuplicateKeyUpdate({ set: {
    pageName: data.pageName, title: data.title, bodyText: data.bodyText, ctaText: data.ctaText,
    landingUrl: data.landingUrl, imageUrl: data.imageUrl, videoUrl: data.videoUrl, thumbnailUrl: data.thumbnailUrl,
    startedRunningAt: data.startedRunningAt, activeDays: data.activeDays, score: data.score,
    ...(data.brandId != null ? { brandId: data.brandId } : {}),
  } });
}
export async function getAdInspirations(userId: number, opts: { q?: string; brandId?: number; liked?: boolean; format?: string; sort?: "trending" | "newest"; limit?: number } = {}) {
  const db = await getDb(); if (!db) return [];
  const conds = [eq(adInspirations.userId, userId)];
  if (opts.brandId != null) conds.push(eq(adInspirations.brandId, opts.brandId));
  if (opts.liked != null) conds.push(eq(adInspirations.liked, opts.liked));
  if (opts.format) conds.push(eq(adInspirations.format, opts.format));
  if (opts.q) {
    const pat = "%" + opts.q + "%";
    conds.push(or(sql`${adInspirations.pageName} LIKE ${pat}`, sql`${adInspirations.title} LIKE ${pat}`, sql`${adInspirations.bodyText} LIKE ${pat}`)!);
  }
  const orderCol = opts.sort === "newest" ? desc(adInspirations.createdAt) : desc(adInspirations.score);
  return db.select().from(adInspirations).where(and(...conds)).orderBy(orderCol, desc(adInspirations.createdAt)).limit(Math.min(opts.limit ?? 120, 400));
}
export async function getAdInspirationById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(adInspirations).where(eq(adInspirations.id, id)).limit(1);
  return rows[0];
}
export async function setAdInspirationLiked(userId: number, id: number, liked: boolean) {
  const db = await getDb(); if (!db) return;
  await db.update(adInspirations).set({ liked, likedAt: liked ? new Date() : null })
    .where(and(eq(adInspirations.userId, userId), eq(adInspirations.id, id)));
}
export async function countAdInspirationsByBrand(userId: number, brandId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const rows = await db.select({ n: sql`count(*)` }).from(adInspirations)
    .where(and(eq(adInspirations.userId, userId), eq(adInspirations.brandId, brandId)));
  return Number((rows[0] as { n: unknown })?.n ?? 0);
}

// ─── Watchlist: 🩷 Templates (video salvati da remixare) ──────────────────────
export async function getWatchlistVideoById(id: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(watchlistVideos).where(eq(watchlistVideos.id, id)).limit(1);
  return rows[0];
}

export async function setWatchlistVideoLiked(id: number, liked: boolean) {
  const db = await getDb(); if (!db) return;
  await db.update(watchlistVideos).set({ liked, likedAt: liked ? new Date() : null }).where(eq(watchlistVideos.id, id));
}

// ─── Claude Sessions ──────────────────────────────────────────────────────────
// Le sessioni Claude di Andrea, continuabili da qualsiasi superficie: web app,
// Telegram, o Claude Code (che importa/esporta il transcript via externalId).
// L'agente Claude fa polling su getPendingClaudeMessages e risponde con
// recordClaudeReply, esattamente come l'agente social su social_chat_messages.

const CLAUDE_PREVIEW_MAX = 280;

// Il preview vive in una colonna VARCHAR(280): niente newline, niente code fence.
function claudePreview(text: string): string {
  const flat = text.replace(/```[\s\S]*?```/g, " [codice] ").replace(/\s+/g, " ").trim();
  return flat.length > CLAUDE_PREVIEW_MAX ? flat.slice(0, CLAUDE_PREVIEW_MAX - 1) + "…" : flat;
}

export async function createClaudeSession(data: InsertClaudeSession): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(claudeSessions).values(data);
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function getClaudeSessionById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(claudeSessions).where(eq(claudeSessions.id, id)).limit(1);
  return rows[0];
}

export async function findClaudeSessionByExternalId(userId: number, externalId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(claudeSessions)
    .where(and(eq(claudeSessions.userId, userId), eq(claudeSessions.externalId, externalId)))
    .limit(1);
  return rows[0];
}

export async function getClaudeSessions(
  userId: number,
  opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
) {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(opts.limit ?? 100, 200);
  const filters = [eq(claudeSessions.userId, userId)];
  if (!opts.includeArchived) filters.push(eq(claudeSessions.status, "active"));

  const q = opts.q?.trim();
  if (q) {
    // Ricerca full-text: il titolo O il contenuto di un qualsiasi messaggio.
    // I match sul contenuto arrivano da una subquery sugli id di sessione.
    // Escape dei wildcard LIKE: una ricerca per "100%" non deve matchare tutto.
    const needle = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const hits = await db.selectDistinct({ sessionId: claudeSessionMessages.sessionId })
      .from(claudeSessionMessages)
      .where(and(eq(claudeSessionMessages.userId, userId), like(claudeSessionMessages.text, needle)))
      .limit(500);
    const ids = hits.map((h) => h.sessionId);
    const titleMatch = like(claudeSessions.title, needle);
    filters.push(ids.length ? or(titleMatch, inArray(claudeSessions.id, ids))! : titleMatch);
  }

  const rows = await db.select().from(claudeSessions)
    .where(and(...filters))
    .orderBy(desc(claudeSessions.lastMessageAt))
    .limit(limit);
  if (!rows.length) return [];

  // Conteggio messaggi per sessione in una sola query, poi rimappato.
  const counts = await db.select({ sessionId: claudeSessionMessages.sessionId, n: sql<number>`count(*)` })
    .from(claudeSessionMessages)
    .where(inArray(claudeSessionMessages.sessionId, rows.map((r) => r.id)))
    .groupBy(claudeSessionMessages.sessionId);
  const countBy = new Map(counts.map((c) => [c.sessionId, Number(c.n)]));

  return rows.map((r) => ({ ...r, messageCount: countBy.get(r.id) ?? 0 }));
}

export async function getClaudeSessionMessages(sessionId: number, limit = 500) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(claudeSessionMessages)
    .where(eq(claudeSessionMessages.sessionId, sessionId))
    .orderBy(asc(claudeSessionMessages.createdAt), asc(claudeSessionMessages.id))
    .limit(limit);
}

export async function insertClaudeMessage(params: {
  sessionId: number; userId: number; role: "user" | "assistant" | "system";
  text: string; source?: string; status?: "new" | "handled"; createdAt?: Date;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(claudeSessionMessages).values({
    sessionId: params.sessionId,
    userId: params.userId,
    role: params.role,
    text: params.text,
    source: params.source ?? "web",
    status: params.status ?? "new",
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
  });
  // La lista sessioni si ordina su lastMessageAt e mostra lastPreview: teniamoli allineati.
  await db.update(claudeSessions)
    .set({ lastMessageAt: params.createdAt ?? new Date(), lastPreview: claudePreview(params.text) })
    .where(eq(claudeSessions.id, params.sessionId));
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

export async function getPendingClaudeMessages(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    messageId: claudeSessionMessages.id,
    sessionId: claudeSessionMessages.sessionId,
    userId: claudeSessionMessages.userId,
    text: claudeSessionMessages.text,
    source: claudeSessionMessages.source,
    createdAt: claudeSessionMessages.createdAt,
    sessionTitle: claudeSessions.title,
    sessionExternalId: claudeSessions.externalId,
  }).from(claudeSessionMessages)
    .innerJoin(claudeSessions, eq(claudeSessionMessages.sessionId, claudeSessions.id))
    .where(and(eq(claudeSessionMessages.role, "user"), eq(claudeSessionMessages.status, "new")))
    .orderBy(asc(claudeSessionMessages.createdAt))
    .limit(limit);
}

export async function recordClaudeReply(params: {
  sessionId: number; userId: number; text: string; replyToId?: number; source?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (params.replyToId != null) {
    // Marca gestito SOLO il messaggio a cui rispondiamo (evita race web/telegram).
    await db.update(claudeSessionMessages)
      .set({ status: "handled", handledAt: new Date() })
      .where(eq(claudeSessionMessages.id, params.replyToId));
  } else {
    await db.update(claudeSessionMessages)
      .set({ status: "handled", handledAt: new Date() })
      .where(and(
        eq(claudeSessionMessages.sessionId, params.sessionId),
        eq(claudeSessionMessages.role, "user"),
        eq(claudeSessionMessages.status, "new"),
      ));
  }
  return insertClaudeMessage({
    sessionId: params.sessionId,
    userId: params.userId,
    role: "assistant",
    text: params.text,
    source: params.source ?? "web",
    status: "handled",
  });
}

export async function updateClaudeSession(id: number, patch: { title?: string; status?: "active" | "archived" }) {
  const db = await getDb();
  if (!db) return;
  if (patch.title === undefined && patch.status === undefined) return;
  await db.update(claudeSessions).set(patch).where(eq(claudeSessions.id, id));
}

export async function deleteClaudeSession(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(claudeSessionMessages).where(eq(claudeSessionMessages.sessionId, id));
  await db.delete(claudeSessions).where(eq(claudeSessions.id, id));
}


// ─── Claude: allegati (file, immagini, note vocali) ───────────────────────────
// I byte vivono in MySQL: niente object storage da configurare su Railway.
export async function insertClaudeAttachment(params: {
  userId: number; sessionId: number; messageId?: number | null;
  filename: string; mimeType: string; kind: "file" | "image" | "voice";
  transcript?: string | null; data: Buffer;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const r = await db.insert(claudeAttachments).values({
    userId: params.userId,
    sessionId: params.sessionId,
    messageId: params.messageId ?? null,
    filename: params.filename,
    mimeType: params.mimeType,
    size: params.data.length,
    kind: params.kind,
    transcript: params.transcript ?? null,
    data: params.data,
  });
  return Number((r as unknown as { insertId: number }[])[0].insertId);
}

// Metadati senza i byte: la lista messaggi non deve trascinarsi i blob.
export async function getClaudeAttachmentsForSession(sessionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: claudeAttachments.id,
    messageId: claudeAttachments.messageId,
    filename: claudeAttachments.filename,
    mimeType: claudeAttachments.mimeType,
    size: claudeAttachments.size,
    kind: claudeAttachments.kind,
    transcript: claudeAttachments.transcript,
  }).from(claudeAttachments).where(eq(claudeAttachments.sessionId, sessionId));
}

export async function getClaudeAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(claudeAttachments).where(eq(claudeAttachments.id, id)).limit(1);
  return rows[0];
}

// Gli allegati nascono prima del messaggio (upload, poi invio): qui li si lega.
export async function attachClaudeAttachmentsToMessage(ids: number[], messageId: number, userId: number) {
  const db = await getDb();
  if (!db || !ids.length) return;
  await db.update(claudeAttachments).set({ messageId })
    .where(and(inArray(claudeAttachments.id, ids), eq(claudeAttachments.userId, userId)));
}
