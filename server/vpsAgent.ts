/**
 * Delega all'agente VPS (Claude + browser reale, già pagato con l'abbonamento Max).
 * È il PIANO B gratuito quando Apify è esaurito o blocca: l'agente scrapa con il
 * suo browser i profili/trend che gli endpoint anonimi non raggiungono e ri-carica
 * i dati via gli endpoint /ingest. Costo: zero.
 *
 * Il ponte è la chat esistente (social_chat_messages): l'agente polla, esegue la
 * skill giusta e chiama gli endpoint REST. Nessuna nuova infrastruttura.
 */
import { getAllUserSettings, insertSocialChatMessage } from "./db";

const AGENT_ONLINE_MS = 5 * 60_000; // heartbeat entro 5 minuti = online

export async function isVpsAgentOnline(userId: number): Promise<boolean> {
  const s = await getAllUserSettings(userId);
  const lastSeen = Number(s.social_local_agent_last_seen ?? 0);
  return lastSeen > 0 && Date.now() - lastSeen < AGENT_ONLINE_MS;
}

/**
 * Accoda un task all'agente via chat bridge, con anti-spam: non ripropone lo
 * stesso task se già inviato di recente (dedupKey salvato in user_settings).
 */
export async function delegateToVpsAgent(
  userId: number,
  dedupKey: string,
  taskText: string,
  cooldownMs = 30 * 60_000,
): Promise<{ delegated: boolean; reason?: string }> {
  const online = await isVpsAgentOnline(userId);
  if (!online) return { delegated: false, reason: "agente VPS offline" };

  const settingKey = `agent_task_${dedupKey}`.slice(0, 120);
  const s = await getAllUserSettings(userId);
  const last = Number(s[settingKey] ?? 0);
  if (Date.now() - last < cooldownMs) return { delegated: false, reason: "task già in coda di recente" };

  await insertSocialChatMessage({ userId, role: "user", source: "web", status: "new", text: taskText });
  // salva il timestamp del task (upsert via helper esistente)
  const { upsertUserSetting } = await import("./db");
  await upsertUserSetting(userId, settingKey, String(Date.now()));
  return { delegated: true };
}

const BASE_URL = "$SOCIAL_BASE_URL"; // l'agente ha la env; la lasciamo simbolica nel testo

/** Task watchlist: l'agente scrapa un canale IG/TikTok (curl + cookie di sessione) e fa ingest. */
export function watchlistScrapeTask(platform: string, handle: string): string {
  const igSteps = `1) Se in ~/.social-agent.env c'è IG_SESSION_COOKIE, usa curl con header "Cookie: $IG_SESSION_COOKIE" e "x-ig-app-id: 936619743392459":
   a) GET https://www.instagram.com/api/v1/users/web_profile_info/?username=${handle} → prendi data.user.id, full_name, edge_followed_by.count, profile_pic_url
   b) GET https://www.instagram.com/api/v1/feed/user/{id}/?count=18 → per ogni item: code, caption.text, taken_at, play_count/view_count, like_count, comment_count
2) Se il cookie NON c'è o dà 4xx: NON inventare dati; rispondi in chat che serve IG_SESSION_COOKIE (Railway/VPS) o lo scraping dal PC di Andrea.`;
  const ttSteps = `1) Prova curl sul profilo pubblico https://www.tiktok.com/@${handle} (UA da browser) e leggi il JSON __UNIVERSAL_DATA_FOR_REHYDRATION__; se TikTok blocca (shield/403), rispondi in chat che dal VPS non è raggiungibile e serve il PC di Andrea.
2) NON inventare mai numeri.`;
  return `[WATCHLIST → SCRAPE ${platform.toUpperCase()}] Apify è esaurito: recupera tu i dati di ${platform} @${handle} — costo zero.
${platform === "instagram" ? igSteps : ttSteps}
3) Se hai i dati, POST a ${BASE_URL}/api/social/watchlist/ingest (header x-care-secret: $CARE_WEBHOOK_SECRET) con body JSON:
   {"platform":"${platform}","handle":"${handle}","displayName":"...","avatarUrl":"...","followers":N,"videos":[{"platformVideoId":"...","url":"...","title":"...","publishedAt":"ISO","views":N,"likes":N,"comments":N}]}
Rispondi in chat solo con: quanti video hai caricato per @${handle} (o il motivo del blocco).`;
}

/** Task research: l'agente scrapa i trend Pinterest col browser e fa ingest. */
export function pinterestScrapeTask(country: string, interestIds: string[]): string {
  const url = `https://trends.pinterest.com/${interestIds.length ? `?topicInterestIds=${interestIds.join(",")}` : ""}`;
  return `[SEO → SCRAPE PINTEREST] Apify è esaurito: prendi tu i trend Pinterest col browser (sei loggato) — costo zero.
1) Apri ${url} (Regione: ${country}) e leggi le "Tendenze in aumento": per ogni keyword prendi termine, rank, e la crescita % se visibile.
2) POST a ${BASE_URL}/api/seo/research/ingest (header x-care-secret: $CARE_WEBHOOK_SECRET) con body JSON:
   {"items":[{"source":"pinterest","sourceDetail":"Pinterest Trends ${country}","country":"${country}","title":"(keyword)","url":"https://trends.pinterest.com/detail/?terms=(keyword)&country=${country}","excerpt":"rank #N, +X% crescita","engagement":N}]}
   (engagement = indice 0-100 se disponibile, altrimenti 100 meno il rank).
Rispondi in chat solo con: quante keyword Pinterest hai caricato.`;
}
