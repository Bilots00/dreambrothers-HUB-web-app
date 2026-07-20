/**
 * Market Intelligence & Product Research Strategist — l'agente fuso.
 * Incrocia i candidati (Meta/TikTok Ad Library, Etsy, Shopify, Google Trends) e seleziona
 * i "prodotti in evidenza" del giorno (6 Meta/TikTok + 2 Etsy + 2 Shopify) applicando la
 * FUSIONE delle metodologie dei migliori guru + le 8 competenze del ruolo, adattate al brand.
 *
 * Motore AI: Claude (agente VPS via REST /api/market/picks) è il primario; qui c'è un
 * fallback server (Gemini via runResearchLLM) + un fallback deterministico. Mai bloccarsi.
 */
import {
  getRecentAdFinds, getTopEtsyListings, getTopMarketProducts, getResearchItems,
  replaceDailyPicks,
} from "./db";
import { runResearchLLM, extractJson, sanitizeText } from "./research";
import { getResearchConfig } from "./researchService";
import { getBrandContext } from "./brainClient";

// Fusione delle metodologie (GIO · Protocollo Jay · Welch · Ferrari · Cappelli · Miller) + ruolo.
export const FUSED_METHOD = `Sei il più grande Market Intelligence & Product Research Strategist mai esistito: fondi i metodi dei top guru e-commerce e le 8 competenze del ruolo (trend forecasting, competitive/ad-spy, market gap, product validation, data mastery, voice-of-customer, pricing/offer, sintesi).
FILTRI DI VALIDAZIONE (fusione):
- Prodotto PROVATO da dati reali (ads attive in scaling, recensioni dei competitor, best-seller rank) — non ipotesi.
- Margine POD alto e valore percepito alto (Jay: ≥70% quando possibile); prezzo/AOV sensato.
- Risolve un problema o incarna un desiderio forte (Jay "legge del dolore"; GIO "must solve a problem/unique mechanism").
- Meta-compliant, basso reso, differenziabile con un ANGLE unico (Jay barriere; GIO unique mechanism).
- Momentum reale ORA: incrocia Google Trends + ad in crescita (Welch/Ferrari "scaling rising"); evita fad saturi.
- Arbitraggio geografico ok (Jay L1): vincitori esteri portabili in IT/EU.
- Preferisci brand one-product / nicchia verticale a store generalisti di massa (Ferrari).
ADATTAMENTO BRAND: ogni pick deve essere coerente con la visione/mission del brand DreamBrothers (Wall Art + Streetwear, dreamers/anticonformisti, "diventa l'eroe della tua storia") — se un vincitore non è adattabile al brand, scartalo.
OUTPUT: per ogni pick, un "reason" di 1 frase (perché ORA + angle per il brand) e uno "score" 0-100 (priorità come opportunità).`;

interface Candidate { source: string; title: string; url: string | null; imageUrl: string | null; price: string | null; signal: string; }

async function gatherCandidates(userId: number): Promise<Candidate[]> {
  const [adsMeta, adsTt, etsy, shopify, trends] = await Promise.all([
    getRecentAdFinds(userId, "meta", 336, 40).catch(() => []),
    getRecentAdFinds(userId, "tiktok", 336, 20).catch(() => []),
    getTopEtsyListings(userId, 30).catch(() => []),
    getTopMarketProducts(userId, 20).catch(() => []),
    getResearchItems(userId, { source: "trends", sort: "best", limit: 20 } as any).catch(() => []),
  ]);
  const cands: Candidate[] = [];
  for (const a of adsMeta as any[]) cands.push({ source: "meta", title: a.title, url: a.url ?? (a.domain ? `https://${a.domain}` : null), imageUrl: a.imageUrl ?? null, price: null, signal: `${a.adCount ?? "?"} ads attive${a.isShopify ? " · Shopify" : ""}` });
  for (const a of adsTt as any[]) cands.push({ source: "tiktok", title: a.title, url: a.url ?? null, imageUrl: a.imageUrl ?? null, price: null, signal: `${a.views ?? "?"} views` });
  for (const l of etsy as any[]) cands.push({ source: "etsy", title: l.title, url: l.url ?? null, imageUrl: l.imageUrl ?? null, price: l.price != null ? `${l.currency ?? ""} ${l.price}` : null, signal: `${l.estSales ?? "?"} vendite · ${l.reviewCount} rec` });
  for (const p of shopify as any[]) cands.push({ source: "shopify", title: p.title, url: p.url ?? null, imageUrl: p.imageUrl ?? null, price: p.minPrice != null ? `€${p.minPrice}` : null, signal: `${p.reviewCount != null ? p.reviewCount + " rec" : "rank #" + (p.bestSellerRank ?? "?")}` });
  const trendLine = (trends as any[]).slice(0, 10).map((t) => t.title).join(" · ");
  if (trendLine) cands.push({ source: "trends", title: `[GOOGLE TRENDS] ${trendLine}`, url: null, imageUrl: null, price: null, signal: "domanda" });
  return cands;
}

function deterministicPicks(cands: Candidate[]): Array<{ source: string; title: string; url: string | null; imageUrl: string | null; price: string | null; reason: string; score: number }> {
  const take = (src: string, n: number) => cands.filter((c) => c.source === src).slice(0, n).map((c, i) => ({
    source: c.source === "tiktok" ? "meta" : c.source, title: c.title, url: c.url, imageUrl: c.imageUrl, price: c.price,
    reason: `Segnale forte: ${c.signal}. Da validare come angle per il brand.`, score: 70 - i * 3,
  }));
  const ads = [...cands.filter((c) => c.source === "meta"), ...cands.filter((c) => c.source === "tiktok")].slice(0, 6)
    .map((c, i) => ({ source: "meta", title: c.title, url: c.url, imageUrl: c.imageUrl, price: c.price, reason: `Ad in scaling (${c.signal}) — porta l'angle sul brand.`, score: 72 - i * 3 }));
  return [...ads, ...take("etsy", 2), ...take("shopify", 2)];
}

export async function generateDailyPicks(userId: number, pickDate: string): Promise<{ count: number; usedLLM: boolean }> {
  const cands = await gatherCandidates(userId);
  if (cands.length === 0) { await replaceDailyPicks(userId, pickDate, []); return { count: 0, usedLLM: false }; }
  const cfg = await getResearchConfig(userId).catch(() => ({ brandContext: "" as string }));
  const brandContext = await getBrandContext((cfg as any).brandContext).catch(() => "");
  let picks: Array<{ source: string; title: string; url: string | null; imageUrl: string | null; price: string | null; reason: string; score: number }> = [];
  let usedLLM = false;
  try {
    const sys = `${FUSED_METHOD}\n\nBRAND (dal company Brain):\n${brandContext}\n\nRispondi SOLO con JSON: {"picks":[{"source":"meta|etsy|shopify","title":str,"url":str|null,"imageUrl":str|null,"price":str|null,"reason":"1 frase it","score":0-100}]}. Esattamente 6 pick con source meta (dai candidati Meta/TikTok), 2 con source etsy, 2 con source shopify. Scegli i migliori incrociando i segnali e Google Trends.`;
    const usr = `CANDIDATI (source · titolo · segnale · url · img):\n${cands.map((c, i) => `${i}. [${c.source}] ${c.title} — ${c.signal}${c.url ? " — " + c.url : ""}${c.imageUrl ? " — img:" + c.imageUrl : ""}`).join("\n")}`;
    const out = await runResearchLLM(sys, usr);
    const parsed = extractJson<{ picks: typeof picks }>(out);
    if (parsed?.picks?.length) {
      picks = parsed.picks.slice(0, 10).map((p) => ({
        source: ["meta", "etsy", "shopify", "tiktok"].includes(p.source) ? (p.source === "tiktok" ? "meta" : p.source) : "meta",
        title: sanitizeText(p.title, 300) ?? "", url: p.url ?? null, imageUrl: p.imageUrl ?? null, price: p.price ?? null,
        reason: sanitizeText(p.reason, 400) ?? "", score: Math.max(0, Math.min(100, Math.round(Number(p.score ?? 50)))),
      })).filter((p) => p.title);
      usedLLM = picks.length > 0;
    }
  } catch { /* fallback sotto */ }
  if (picks.length === 0) picks = deterministicPicks(cands);
  await replaceDailyPicks(userId, pickDate, picks);
  return { count: picks.length, usedLLM };
}
