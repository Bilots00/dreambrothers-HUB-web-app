import type { Express, Request, Response } from "express";

/* FocusLock — "Frase del giorno".
 *
 * Le frasi sono le stesse della pagina wishlist del sito (metafield custom.daily_quotes della
 * pagina "wishlist", o "daily-quotes" se esiste): una stringa con le frasi separate da "|" e
 * l'autore dopo "~". L'app le riceve intere e sceglie quella del giorno con lo stesso calcolo
 * del tema Liquid (ordinate per lunghezza, indice = giorni dall'epoca modulo n), così telefono
 * e sito dicono la stessa frase. Nessuna identità: la rotta è pubblica come il sito.
 *
 * Se l'Admin API non risponde, si legge la pagina pubblica e si estrae la frase di oggi. */

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; quotes: string[] } | null = null;

async function fromAdmin(): Promise<string[]> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN mancanti");
  const query = `{
    quotesPage: pages(first: 1, query: "handle:daily-quotes") { nodes { metafield(namespace: "custom", key: "daily_quotes") { value } } }
    wishlistPage: pages(first: 1, query: "handle:wishlist") { nodes { metafield(namespace: "custom", key: "daily_quotes") { value } } }
  }`;
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error("Shopify: " + JSON.stringify(j.errors).slice(0, 200));
  const raw = j.data?.quotesPage?.nodes?.[0]?.metafield?.value
    || j.data?.wishlistPage?.nodes?.[0]?.metafield?.value || "";
  return split(String(raw));
}

/* Stessa pulizia del tema: newline via, split su "|", vuoti scartati. */
function split(raw: string): string[] {
  return raw.replace(/\r\n|\r|\n/g, " ").split("|").map((q) => q.trim()).filter(Boolean);
}

/* La pagina pubblica mostra solo la frase di oggi: data-full-text e l'autore. */
async function fromPage(): Promise<string[]> {
  const r = await fetch("https://dreambrothers.it/pages/wishlist", { headers: { "user-agent": "FocusLock/1.0" } });
  const html = await r.text();
  const m = html.match(/id="karaoke-quote"[^>]*data-full-text="([^"]*)"/);
  if (!m) return [];
  const text = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const a = html.match(/class="wishlist-author"[^>]*>~\s*([^<]*)</);
  const author = a ? a[1].trim() : "";
  return [author ? `${text} ~ ${author}` : text];
}

export function registerFocusLockQuoteRoutes(app: Express) {
  app.get("/api/focuslock/quotes", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) { res.json({ quotes: cache.quotes, cached: true }); return; }
    let quotes: string[] = [];
    let source = "admin";
    try { quotes = await fromAdmin(); } catch (e: any) { console.warn("[focuslock] quotes admin:", e?.message || e); }
    if (!quotes.length) {
      source = "page";
      try { quotes = await fromPage(); } catch (e: any) { console.warn("[focuslock] quotes page:", e?.message || e); }
    }
    if (quotes.length) cache = { at: Date.now(), quotes };
    res.json({ quotes, source, todayOnly: source === "page" });
  });
}
