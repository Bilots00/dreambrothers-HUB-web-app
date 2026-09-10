import type { Express, Request, Response } from "express";

/* FocusLock — "Frase del giorno".
 *
 * Le frasi sono quelle della pagina wishlist del sito (metafield custom.daily_quotes): una
 * stringa con le frasi separate da "|" e l'autore dopo "~".
 *
 * <h3>Perché la pagina viene letta e non solo l'Admin API</h3>
 * Il metafield è TRADOTTO con Translate & Adapt. L'Admin API senza indicazione di lingua
 * restituisce il valore primario, cioè l'inglese: l'app mostrava una frase di Justin Bieber
 * mentre dreambrothers.it mostrava Paulo Coelho. La pagina italiana, invece, è per
 * definizione quello che il sito sta dicendo oggi, quindi è la fonte principale; l'Admin API
 * (con la traduzione italiana, quando c'è) resta per dare all'app l'elenco intero, così può
 * ruotare anche senza rete.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const PAGE_URL = "https://dreambrothers.it/pages/wishlist";
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; body: any } | null = null;

async function admin<T>(query: string): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN mancanti");
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error("Shopify: " + JSON.stringify(j.errors).slice(0, 200));
  return j.data as T;
}

/** Stessa pulizia del tema: newline via, split su "|", vuoti scartati. */
function split(raw: string): string[] {
  return String(raw || "").replace(/\r\n|\r|\n/g, " ").split("|").map((q) => q.trim()).filter(Boolean);
}

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** L'elenco intero, nella traduzione italiana del metafield quando esiste. */
async function listFromAdmin(): Promise<string[]> {
  const d: any = await admin(`{
    pages(first: 1, query: "handle:wishlist") { nodes { metafield(namespace: "custom", key: "daily_quotes") { id value } } }
  }`);
  const mf = d?.pages?.nodes?.[0]?.metafield;
  if (!mf?.value) return [];
  let value = String(mf.value);
  try {
    const t: any = await admin(`{
      translatableResourcesByIds(resourceIds: ["${mf.id}"], first: 1) {
        nodes { translations(locale: "it") { key value } }
      }
    }`);
    const it = t?.translatableResourcesByIds?.nodes?.[0]?.translations?.find((x: any) => x?.value);
    if (it?.value) value = String(it.value);
  } catch (e: any) {
    console.warn("[focuslock] quotes translation:", e?.message || e);
  }
  return split(value);
}

/** La frase che il sito sta mostrando adesso, in italiano. */
async function todayFromPage(): Promise<string | null> {
  const r = await fetch(PAGE_URL, { headers: { "user-agent": "FocusLock/1.0", "accept-language": "it-IT,it" } });
  const html = await r.text();
  const m = html.match(/id="karaoke-quote"[^>]*data-full-text="([^"]*)"/);
  if (!m) return null;
  const text = decode(m[1]).trim();
  if (!text) return null;
  const a = html.match(/class="wishlist-author"[^>]*>~\s*([^<]*)</);
  const author = a ? decode(a[1]).trim() : "";
  return author ? `${text} ~ ${author}` : text;
}

export function registerFocusLockQuoteRoutes(app: Express) {
  app.get("/api/focuslock/quotes", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) { res.json({ ...cache.body, cached: true }); return; }

    let today: string | null = null;
    try { today = await todayFromPage(); }
    catch (e: any) { console.warn("[focuslock] quotes page:", e?.message || e); }

    let quotes: string[] = [];
    try { quotes = await listFromAdmin(); }
    catch (e: any) { console.warn("[focuslock] quotes admin:", e?.message || e); }

    // Se la pagina ha risposto, quella è la frase di oggi, punto: l'elenco serve solo come
    // scorta offline, e se è in un'altra lingua non deve mai vincere sulla pagina.
    const body = { today: today, quotes: quotes.length ? quotes : (today ? [today] : []), day: new Date().toISOString().slice(0, 10) };
    if (today || quotes.length) cache = { at: Date.now(), body };
    res.json(body);
  });
}
