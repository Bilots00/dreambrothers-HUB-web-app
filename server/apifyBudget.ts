/**
 * Budget guard mensile per Apify (piano free = $5/mese).
 * Traccia la spesa STIMATA per mese di calendario in user_settings e blocca le
 * chiamate PRIMA di sbattere contro il muro rigido di Apify (che altrimenti
 * aborta tutti gli Actor). Così la web app degrada in modo controllato e resta
 * gratis. Soglia alzabile con APIFY_MONTHLY_CAP_USD se un giorno passi a un piano.
 */
import { getAllUserSettings, upsertUserSetting } from "./db";

const OWNER_USER_ID = 1;
const CAP_USD = Number(process.env.APIFY_MONTHLY_CAP_USD ?? "4.5"); // margine sotto i $5

// costo stimato per run/chiamata in base all'actor (tier free, ordini di grandezza reali)
function estimatedCostUsd(actorId: string): number {
  const a = actorId.toLowerCase();
  if (a.includes("tiktok")) return 0.08;
  if (a.includes("pinterest")) return 0.04;
  if (a.includes("instagram")) return 0.01;
  if (a.includes("ad-library") || a.includes("facebook") || a.includes("ads")) return 0.03;
  return 0.03;
}

function monthKey(): string {
  // YYYYMM in UTC (Date.now() è deterministico anche nel workflow)
  const d = new Date();
  return `apify_spend_${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Spesa stimata del mese corrente + se siamo sopra la soglia. */
export async function getApifyBudget(): Promise<{ spentUsd: number; capUsd: number; blocked: boolean }> {
  const s = await getAllUserSettings(OWNER_USER_ID);
  const spent = Number(s[monthKey()] ?? 0) || 0;
  return { spentUsd: Math.round(spent * 100) / 100, capUsd: CAP_USD, blocked: spent >= CAP_USD };
}

/** Lancia se il budget è esaurito; altrimenti pre-addebita la stima (evita over-spend concorrente). */
export async function assertAndChargeApify(actorId: string): Promise<void> {
  const key = monthKey();
  const s = await getAllUserSettings(OWNER_USER_ID);
  const spent = Number(s[key] ?? 0) || 0;
  if (spent >= CAP_USD) {
    throw new Error(
      `Budget Apify mensile raggiunto (~$${spent.toFixed(2)}/$${CAP_USD}). ` +
      `Salto la chiamata per restare nel piano free — riparte il 1° del mese, ` +
      `oppure alza APIFY_MONTHLY_CAP_USD. I dati IG/TikTok/Pinterest possono comunque ` +
      `arrivare dall'agente VPS (browser gratis) via gli endpoint /ingest.`
    );
  }
  await upsertUserSetting(OWNER_USER_ID, key, String(Math.round((spent + estimatedCostUsd(actorId)) * 1000) / 1000));
}
