import type { Express, Request, Response } from "express";

/* FocusLock — "Frase del giorno".
 *
 * Le frasi sono quelle della pagina wishlist del sito (metafield custom.daily_quotes): una
 * stringa con le frasi separate da "|" e l'autore dopo "~".
 *
 * <h3>Perché la lingua è un problema, e come è risolto</h3>
 * Il metafield è TRADOTTO con Translate & Adapt. L'Admin API senza indicazione di lingua
 * restituisce il valore primario, cioè l'inglese: l'app mostrava Justin Bieber mentre
 * dreambrothers.it mostrava Paulo Coelho. Le due fonti usate qui parlano entrambe italiano:
 *
 *  1. la pagina italiana, che è per definizione quello che il sito sta dicendo oggi;
 *  2. la Storefront API del dominio .it con `@inContext(language: IT)`, che restituisce
 *     l'elenco intero già tradotto — serve per le frasi dei giorni scorsi e per far ruotare
 *     l'app anche senza rete.
 *
 * Il token Storefront non è scritto qui: è pubblico e sta nella pagina stessa, quindi viene
 * letto da lì insieme alla frase di oggi. Un segreto in meno da custodire.
 */

const PAGE_URL = "https://dreambrothers.it/pages/wishlist";
const STOREFRONT_URL = "https://dreambrothers.it/api/2025-04/graphql.json";
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; body: any } | null = null;

function decode(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Stessa pulizia del tema: newline via, split su "|", vuoti scartati. */
function split(raw: string): string[] {
  return String(raw || "").replace(/\r\n|\r|\n/g, " ").split("|").map((q) => q.trim()).filter(Boolean);
}

/** Una sola lettura della pagina: la frase di oggi e il token pubblico della vetrina. */
async function readPage(): Promise<{ today: string | null; token: string | null }> {
  const r = await fetch(PAGE_URL, { headers: { "user-agent": "FocusLock/1.0", "accept-language": "it-IT,it" } });
  const html = await r.text();

  let today: string | null = null;
  const m = html.match(/id="karaoke-quote"[^>]*data-full-text="([^"]*)"/);
  if (m) {
    const text = decode(m[1]).trim();
    const a = html.match(/class="wishlist-author"[^>]*>~\s*([^<]*)</);
    const author = a ? decode(a[1]).trim() : "";
    if (text) today = author ? `${text} ~ ${author}` : text;
  }
  const t = html.match(/storefrontToken:\s*"([^"]+)"/);
  return { today, token: t ? t[1] : null };
}

/** L'elenco intero, in italiano, dalla vetrina del dominio .it. */
async function listFromStorefront(token: string): Promise<string[]> {
  const query = `query { page(handle: "wishlist") { metafield(namespace: "custom", key: "daily_quotes") { value } } }`;
  const r = await fetch(STOREFRONT_URL, {
    method: "POST",
    headers: {
      "X-Shopify-Storefront-Access-Token": token,
      "Content-Type": "application/json",
      "Accept-Language": "it-IT",
    },
    body: JSON.stringify({ query }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  return split(j?.data?.page?.metafield?.value || "");
}

export function registerFocusLockQuoteRoutes(app: Express) {
  app.get("/api/focuslock/quotes", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) { res.json({ ...cache.body, cached: true }); return; }

    let today: string | null = null;
    let token: string | null = null;
    try { const p = await readPage(); today = p.today; token = p.token; }
    catch (e: any) { console.warn("[focuslock] quotes page:", e?.message || e); }

    let quotes: string[] = [];
    if (token) {
      try { quotes = await listFromStorefront(token); }
      catch (e: any) { console.warn("[focuslock] quotes storefront:", e?.message || e); }
    }

    // Se la pagina ha risposto, quella è la frase di oggi, punto: l'elenco serve per i giorni
    // scorsi e come scorta offline, e non deve mai vincere sulla pagina.
    const body = { today, quotes: quotes.length ? quotes : (today ? [today] : []), day: new Date().toISOString().slice(0, 10) };
    if (today || quotes.length) cache = { at: Date.now(), body };
    res.json(body);
  });
}
