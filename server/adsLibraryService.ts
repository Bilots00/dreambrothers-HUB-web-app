/**
 * Ads Inspiration — orchestrazione (replica CreativeOS dentro META Ads).
 *
 * Motori di scraping della Facebook Ads Library, in ordine:
 *   1) Apify (se APIFY_TOKEN configurato) — actor configurabile via APIFY_FB_ADS_ACTOR
 *   2) Agente Claude su VPS via chat-bridge (fallback: task [ADS LIBRARY → SCRAPE])
 * Le ads normalizzate finiscono in ad_inspirations; il 🩷 le porta nella tab
 * Templates; "Clone" manda la creative al Creative Director (bridge chat) che
 * genera la variante ON-BRAND e la salva nelle Bozze.
 */

import {
  getAdBrands, getAdBrandById, getAdBrandByPageId, insertAdBrand, updateAdBrand, deleteAdBrand,
  upsertAdInspiration, getAdInspirations, getAdInspirationById, setAdInspirationLiked,
  countAdInspirationsByBrand, insertSocialChatMessage, getAllUserSettings, insertMcActivity,
} from "./db";
import { apifyRunAsync, hasApifyToken } from "./watchlist";
import {
  parsePageIdInput, adsLibraryUrlForPage, mapScrapedAd, buildScrapeHandoffTask,
} from "./adsLibrary";

const FB_ADS_ACTOR = process.env.APIFY_FB_ADS_ACTOR || "curious_coder~facebook-ads-library-scraper";
const LOCAL_AGENT_ONLINE_MS = 300_000;
// Quante ads scaricare per brand: la Ads Library di un brand attivo ne ha
// centinaia (Andy okay ~890), il vecchio cap a 50 ne mostrava una frazione.
const MAX_ADS_PER_BRAND = Number(process.env.ADS_LIBRARY_MAX_PER_BRAND ?? 500);

async function logLyra(userId: number, message: string, details?: Record<string, unknown>) {
  await insertMcActivity({ userId, agentCode: "lyra", message, details }).catch(() => {});
}

async function vpsAgentOnline(userId: number): Promise<boolean> {
  const s = await getAllUserSettings(userId);
  const lastSeen = Number(s.social_local_agent_last_seen ?? 0);
  return lastSeen > 0 && Date.now() - lastSeen < LOCAL_AGENT_ONLINE_MS;
}

// ─── Brands (watchlist ad account) ────────────────────────────────────────────
export async function addBrand(userId: number, input: { name: string; pageInput: string; category?: string }) {
  const pageId = parsePageIdInput(input.pageInput);
  if (!pageId) {
    throw new Error("Page ID non riconosciuto. Incolla l'URL della pagina nella Facebook Ads Library (contiene view_all_page_id=...) o il Page ID numerico.");
  }
  const existing = await getAdBrandByPageId(userId, pageId);
  if (existing) return { id: existing.id, alreadyExists: true } as const;
  const id = await insertAdBrand({ userId, name: input.name.trim() || pageId, pageId, category: input.category, status: "pending" });
  // primo refresh best-effort, senza bloccare la UI a lungo
  refreshBrand(userId, id).catch((err) => console.warn("[AdsLibrary] primo refresh fallito:", err));
  return { id, alreadyExists: false } as const;
}

export async function removeBrand(userId: number, id: number) {
  await deleteAdBrand(userId, id);
  return { success: true } as const;
}

export async function listBrands(userId: number) {
  return getAdBrands(userId);
}

export async function refreshBrand(userId: number, brandId: number): Promise<{ ingested: number; engine: string }> {
  const brand = await getAdBrandById(brandId);
  if (!brand || brand.userId !== userId) throw new Error("Brand non trovato");

  // 1) Apify
  if (hasApifyToken()) {
    try {
      const items = await apifyRunAsync<Record<string, unknown>>(FB_ADS_ACTOR, {
        urls: [{ url: adsLibraryUrlForPage(brand.pageId) }],
        count: MAX_ADS_PER_BRAND,
        "scrapePageAds.activeStatus": "active",
        period: "",
      }, { limit: MAX_ADS_PER_BRAND });
      const { ingested, skipped } = await ingestAdsForBrand(userId, brand.id, items);
      await updateAdBrand(brand.id, { status: "active", lastError: null, lastRefreshAt: new Date(), adCount: await countAdInspirationsByBrand(userId, brand.id) });
      if (ingested > 0) {
        await logLyra(userId, `Ads Library: ${ingested} creative aggiornate dal brand "${brand.name}" (${items.length} ads analizzate${skipped > 0 ? `, ${skipped} senza media utilizzabile` : ""}). Le trovi in Inspiration.`);
      }
      // Trasparenza: se lo scraper tocca il tetto, dillo invece di far sembrare che siano tutte.
      if (items.length >= MAX_ADS_PER_BRAND) {
        console.log(`[AdsLibrary] ${brand.name}: raggiunto il cap di ${MAX_ADS_PER_BRAND} ads (alza ADS_LIBRARY_MAX_PER_BRAND per scaricarne di più)`);
      }
      return { ingested, engine: "apify" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AdsLibrary] Apify fallito per ${brand.name}:`, msg);
      await updateAdBrand(brand.id, { status: "error", lastError: `Apify: ${msg.slice(0, 300)}` });
      // continua col fallback agente
    }
  }

  // 2) Fallback: agente Claude su VPS via chat-bridge
  if (await vpsAgentOnline(userId)) {
    await insertSocialChatMessage({
      userId, role: "user", source: "web", status: "new",
      text: buildScrapeHandoffTask(brand.name, brand.pageId),
    });
    await updateAdBrand(brand.id, { status: "pending", lastError: null });
    await logLyra(userId, `Ads Library: scraping del brand "${brand.name}" delegato all'agente Claude (VPS). Le creative arriveranno a breve in Inspiration.`);
    return { ingested: 0, engine: "vps-agent" };
  }

  await updateAdBrand(brand.id, {
    status: "error",
    lastError: "Nessun motore disponibile: imposta APIFY_TOKEN nelle Railway Variables oppure accendi l'agente VPS.",
  });
  throw new Error("Nessun motore di scraping disponibile (APIFY_TOKEN mancante e agente VPS offline).");
}

export async function refreshAllBrands(userId: number): Promise<{ brands: number; ingested: number; errors: string[] }> {
  const brands = await getAdBrands(userId);
  let ingested = 0;
  const errors: string[] = [];
  for (const b of brands) {
    try {
      const r = await refreshBrand(userId, b.id);
      ingested += r.ingested;
    } catch (err) {
      errors.push(`${b.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { brands: brands.length, ingested, errors };
}

// ─── Ingest (Apify o REST dall'agente VPS) ────────────────────────────────────
export async function ingestAdsForBrand(userId: number, brandId: number | null, items: Array<Record<string, unknown>>): Promise<{ ingested: number; skipped: number }> {
  let ingested = 0;
  let skipped = 0;
  let logoUrl: string | null = null;
  for (const item of items) {
    const ad = mapScrapedAd(item);
    if (!ad) { skipped++; continue; }
    // Il logo dell'advertiser arriva dallo snapshot dell'ad (page_profile_picture_url):
    // è la stessa immagine che la Ads Library mostra accanto al nome del brand.
    if (!logoUrl && ad.pageProfilePictureUrl) logoUrl = ad.pageProfilePictureUrl;
    // Senza NESSUN media né testo la card sarebbe vuota: solo in quel caso saltiamo.
    if (!ad.imageUrl && !ad.videoUrl && !ad.thumbnailUrl && !ad.bodyText && !ad.title) { skipped++; continue; }
    await upsertAdInspiration({
      userId,
      brandId: brandId ?? undefined,
      source: "fb_ads_library",
      adArchiveId: ad.adArchiveId,
      pageName: ad.pageName,
      format: "ads",
      title: ad.title,
      bodyText: ad.bodyText,
      ctaText: ad.ctaText,
      landingUrl: ad.landingUrl,
      imageUrl: ad.imageUrl,
      videoUrl: ad.videoUrl,
      thumbnailUrl: ad.thumbnailUrl,
      startedRunningAt: ad.startedRunningAt,
      activeDays: ad.activeDays,
      score: ad.score,
      raw: ad.raw,
    });
    ingested++;
  }
  if (brandId != null && logoUrl) {
    await updateAdBrand(brandId, { logoUrl }).catch(() => {});
  }
  return { ingested, skipped };
}

export async function ingestFromRest(userId: number, pageId: string, items: Array<Record<string, unknown>>): Promise<{ ingested: number; brandId: number | null }> {
  const brand = await getAdBrandByPageId(userId, pageId);
  const { ingested } = await ingestAdsForBrand(userId, brand?.id ?? null, items);
  if (brand) {
    await updateAdBrand(brand.id, { status: "active", lastError: null, lastRefreshAt: new Date(), adCount: await countAdInspirationsByBrand(userId, brand.id) });
    if (ingested > 0) await logLyra(userId, `Ads Library: l'agente ha ingestato ${ingested} creative del brand "${brand.name}".`);
  }
  return { ingested, brandId: brand?.id ?? null };
}

// ─── Feed / Templates / Like ──────────────────────────────────────────────────
export async function listInspirations(userId: number, opts: { q?: string; brandId?: number; liked?: boolean; format?: string; sort?: "trending" | "newest"; limit?: number }) {
  return getAdInspirations(userId, opts);
}

export async function toggleLike(userId: number, id: number) {
  const insp = await getAdInspirationById(id);
  if (!insp || insp.userId !== userId) throw new Error("Creative non trovata");
  await setAdInspirationLiked(userId, id, !insp.liked);
  return { success: true, liked: !insp.liked } as const;
}

// ─── Clone: manda la reference al Creative Director (on-brand remix) ──────────
export async function cloneInspiration(userId: number, id: number, note?: string) {
  const insp = await getAdInspirationById(id);
  if (!insp || insp.userId !== userId) throw new Error("Creative non trovata");

  const media = insp.videoUrl ?? insp.imageUrl ?? insp.thumbnailUrl ?? "(nessun media)";
  const task = `[CREATIVE → CLONE] Task dal reparto Paid Advertising (Ads Inspiration).
Andrea vuole CLONARE/REMIXARE questa ad vincente come reference, adattandola ON-BRAND a DreamBrothers (leggi il Brain: brand-voice, template-creativita, creative-learnings, lessico-dreamer; NIENTE false claims).
REFERENCE:
- Brand: ${insp.pageName ?? "sconosciuto"} (in run da ${insp.activeDays} giorni → creative vincente)
- Hook/Title: ${insp.title ?? "—"}
- Copy: ${(insp.bodyText ?? "—").slice(0, 500)}
- CTA: ${insp.ctaText ?? "—"} → ${insp.landingUrl ?? "—"}
- Media: ${media}
${note ? `NOTE DI ANDREA: ${note}` : ""}
DELIVERABLE: genera la creative on-brand (Kie.ai/Higgsfield) usando la reference come template di partenza, poi salvala come bozza via POST $SOCIAL_BASE_URL/api/social/draft (platform "meta-ads", format "ad-creative", sourceUrl = media della reference). Draft-first: nessuna pubblicazione. Rispondi in chat con un riepilogo di 2 righe.`;

  await insertSocialChatMessage({ userId, role: "user", source: "web", status: "new", text: task });
  await logLyra(userId, `Clone richiesto: creative di "${insp.pageName ?? "brand"}" (${insp.activeDays}gg live) inviata al Creative Director per la versione on-brand. Arriverà nelle Bozze.`, { inspirationId: id });
  return { success: true } as const;
}
