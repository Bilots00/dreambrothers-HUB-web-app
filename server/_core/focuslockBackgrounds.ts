import type { Express, Request, Response } from "express";

/* FocusLock — gli sfondi di "Ispirazione quotidiana".
 *
 * Ogni giorno la frase del giorno sta su un'immagine diversa, e le immagini sono le opere
 * dello store: i quadri delle collezioni motivazionale, spirituale e natura. L'app sceglie
 * l'immagine con la stessa aritmetica delle frasi (giorno epoch modulo lunghezza), quindi
 * a parità di elenco tutti vedono la stessa opera nello stesso giorno, e condividerla nelle
 * storie porta con sé il link al prodotto.
 *
 * Il token Storefront è pubblico e sta nella pagina wishlist: viene letto da lì, come per
 * le frasi. Niente segreti in questo file.
 */

const PAGE_URL = "https://dreambrothers.it/pages/wishlist";
const STOREFRONT_URL = "https://dreambrothers.it/api/2025-04/graphql.json";
const SHOP_URL = "https://dream-brothers.com";
const COLLECTIONS = ["motivazionali", "spiritual-mindfulness", "nature-and-landscape"];
const CACHE_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; body: any } | null = null;

type Bg = { image: string; title: string; handle: string; url: string };

async function readToken(): Promise<string | null> {
  const r = await fetch(PAGE_URL, { headers: { "user-agent": "FocusLock/1.0" } });
  const html = await r.text();
  const t = html.match(/storefrontToken:\s*"([^"]+)"/);
  return t ? t[1] : null;
}

async function collection(token: string, handle: string): Promise<Bg[]> {
  const query = `query($h: String!) {
    collection(handle: $h) {
      products(first: 40) {
        edges { node { handle title featuredImage { url(transform: { maxWidth: 1200 }) } } }
      }
    }
  }`;
  const r = await fetch(STOREFRONT_URL, {
    method: "POST",
    headers: { "X-Shopify-Storefront-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { h: handle } }),
  });
  const j: any = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
  const edges: any[] = j?.data?.collection?.products?.edges || [];
  return edges
    .map((e) => e.node)
    .filter((n) => n && n.featuredImage && n.featuredImage.url)
    .map((n) => ({ image: n.featuredImage.url, title: n.title, handle: n.handle, url: `${SHOP_URL}/products/${n.handle}` }));
}

export function registerFocusLockBackgroundRoutes(app: Express) {
  app.get("/api/focuslock/backgrounds", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) { res.json({ ...cache.body, cached: true }); return; }

    let token: string | null = null;
    try { token = await readToken(); }
    catch (e: any) { console.warn("[focuslock] backgrounds page:", e?.message || e); }

    const seen = new Set<string>();
    const items: Bg[] = [];
    if (token) {
      for (const h of COLLECTIONS) {
        try {
          for (const b of await collection(token, h)) {
            if (seen.has(b.handle)) continue;
            seen.add(b.handle);
            items.push(b);
          }
        } catch (e: any) { console.warn("[focuslock] backgrounds", h, ":", e?.message || e); }
      }
    }
    // L'ordine è quello delle collezioni, stabile: il giorno N sceglie sempre lo stesso quadro.
    const body = { items, day: new Date().toISOString().slice(0, 10) };
    if (items.length) cache = { at: Date.now(), body };
    res.json(body);
  });
}
