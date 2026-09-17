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
 *  2. l'Admin API, che legge il metafield e poi la sua TRADUZIONE italiana — serve per le
 *     frasi dei giorni scorsi e per far ruotare l'app anche senza rete.
 *
 * <h3>Perché non la Storefront API</h3>
 * Ci si passava, con il token pubblico del tema, e non ha mai funzionato: quel token non ha
 * lo scope `unauthenticated_read_content`, quindi il campo `page` risponde ACCESS_DENIED.
 * L'errore finiva in un console.warn e da fuori sembrava solo che l'elenco non esistesse —
 * l'app riceveva un elenco di una voce sola e per ogni giorno passato diceva «non ho ancora
 * una frase». L'Admin API usa le credenziali che questo server ha già, e legge tutto.
 *
 * <h3>Da quale pagina</h3>
 * Dalla pagina `daily-quotes`, che è la prima che guarda anche il tema
 * (`pages['daily-quotes'] | default: pages['wishlist']`). Chiedere solo `wishlist` — come si
 * faceva qui — voleva dire chiedere a una pagina che quel metafield non ce l'ha.
 */

const PAGE_URL = "https://dreambrothers.it/pages/wishlist";
/* Gli stessi due handle del tema, nello stesso ordine. */
const HANDLES = ["daily-quotes", "wishlist"];
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

/** Una sola lettura della pagina: la frase che il sito sta mostrando adesso. */
async function readPage(): Promise<string | null> {
  const r = await fetch(PAGE_URL, { headers: { "user-agent": "FocusLock/1.0", "accept-language": "it-IT,it" } });
  const html = await r.text();

  const m = html.match(/id="karaoke-quote"[^>]*data-full-text="([^"]*)"/);
  if (!m) return null;
  const text = decode(m[1]).trim();
  const a = html.match(/class="wishlist-author"[^>]*>~\s*([^<]*)</);
  const author = a ? decode(a[1]).trim() : "";
  if (!text) return null;
  return author ? `${text} ~ ${author}` : text;
}

/** Una chiamata all'Admin API, con le credenziali che questo server ha già su Railway. */
async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN");
  const url = `https://${String(shop).replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    + `/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/graphql.json`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data as T;
}

/**
 * L'elenco intero, in italiano.
 *
 * <p>Due passaggi, e il secondo è quello che nessuno si aspetta: il valore che l'Admin API
 * restituisce è il PRIMARIO, cioè l'inglese. La traduzione italiana di un metafield è una
 * risorsa traducibile a sé, indirizzata dall'id del metafield stesso. Senza il secondo
 * passaggio l'app mostrerebbe Justin Bieber mentre il sito mostra Paulo Coelho — ed è
 * esattamente il bug che questo file era nato per risolvere.</p>
 */
async function listFromAdmin(): Promise<string[]> {
  for (const handle of HANDLES) {
    const d = await admin<{ pages: { nodes: Array<{ metafield: { id: string; value: string } | null }> } }>(
      `query($q: String!){ pages(first: 1, query: $q){ nodes {
         metafield(namespace: "custom", key: "daily_quotes"){ id value } } } }`,
      { q: `handle:${handle}` },
    );
    const mf = d?.pages?.nodes?.[0]?.metafield;
    if (!mf || !mf.value) continue;

    let value = mf.value;
    try {
      const t = await admin<{ translatableResource: { translations: Array<{ key: string; value: string }> } | null }>(
        `query($id: ID!){ translatableResource(resourceId: $id){ translations(locale: "it"){ key value } } }`,
        { id: mf.id },
      );
      const it = (t?.translatableResource?.translations || []).find((x) => x.key === "value");
      if (it && it.value) value = it.value;
    } catch (e: any) {
      // Senza traduzione si tiene il primario: in inglese è peggio, ma è meglio di niente.
      console.warn("[focuslock] quotes translation:", e?.message || e);
    }
    const list = split(value);
    if (list.length) return list;
  }
  return [];
}

export function registerFocusLockQuoteRoutes(app: Express) {
  app.get("/api/focuslock/quotes", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) { res.json({ ...cache.body, cached: true }); return; }

    let today: string | null = null;
    try { today = await readPage(); }
    catch (e: any) { console.warn("[focuslock] quotes page:", e?.message || e); }

    let quotes: string[] = [];
    try { quotes = await listFromAdmin(); }
    catch (e: any) { console.warn("[focuslock] quotes admin:", e?.message || e); }

    // Se la pagina ha risposto, quella è la frase di oggi, punto: l'elenco serve per i giorni
    // scorsi e come scorta offline, e non deve mai vincere sulla pagina.
    const body = { today, quotes: quotes.length ? quotes : (today ? [today] : []), day: new Date().toISOString().slice(0, 10) };
    if (today || quotes.length) cache = { at: Date.now(), body };
    res.json(body);
  });
}
