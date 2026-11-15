/**
 * Tee Studio -> Printify.
 *
 * Le magliette create nel configuratore del tema non sono prodotti Printify:
 * il carrello porta con se' tutto quello che serve per stamparle.
 *   _pfy                 {"bp":6,"pp":99,"v":12100}  blueprint, fornitore, variante Printify
 *   _Print front / back / left sleeve / right sleeve / neck   link CDN Shopify del file di stampa
 * All'arrivo dell'ordine (webhook orders/create) si crea UN ordine Printify con
 * tutte le righe Tee Studio, usando i file come "print_areas" (Printify li
 * scarica e li adatta all'area: i file hanno gia' la proporzione esatta).
 *
 * L'ordine nasce su Printify in attesa di approvazione. Con
 * TEE_PRINTIFY_AUTOSEND=1 viene anche mandato in produzione subito (addebito
 * immediato sul conto Printify).
 */
import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.printify.com/v1";
const SHOP = Number(process.env.PRINTIFY_SHOP_ID || 23834278);
const sent = new Set<string>();

const AREE: Record<string, string> = {
  "_Print front": "front",
  "_Print back": "back",
  "_Print left sleeve": "left_sleeve",
  "_Print right sleeve": "right_sleeve",
  "_Print neck": "neck",
};

function props(r: any): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of r?.properties || []) if (p && p.name) o[String(p.name)] = String(p.value ?? "");
  return o;
}

export function isTeeStudioLine(r: any): boolean {
  return !!props(r)._pfy;
}

async function pfy(method: string, path: string, body?: unknown) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}`, "Content-Type": "application/json", "User-Agent": "dreambrothers-tee-studio" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch { /* testo */ }
  if (!r.ok) throw new Error(`Printify ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

async function tag(orderId: number | string, tags: string[]) {
  const shop = process.env.SHOPIFY_SHOP, token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return;
  await fetch(`https://${String(shop).replace(/^https?:\/\//, "")}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-04"}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "mutation($id: ID!, $t: [String!]!){ tagsAdd(id: $id, tags: $t){ userErrors { message } } }", variables: { id: `gid://shopify/Order/${orderId}`, t: tags } }),
  }).catch(() => {});
}

export async function inviaTeeStudio(ordine: any): Promise<any> {
  const righe = (ordine?.line_items || []).filter(isTeeStudioLine);
  if (!righe.length) return null;
  if (ordine.test && process.env.TEE_PRINTIFY_TEST_ORDERS !== "1") return { saltato: "ordine di prova" };
  const ext = `teestudio-${ordine.id}`;
  if (sent.has(ext)) return { saltato: "gia' inviato" };
  const s = ordine.shipping_address;
  if (!s || !s.country_code) return { saltato: "ordine senza indirizzo di spedizione" };

  const line_items = righe.map((r: any) => {
    const p = props(r);
    const meta = JSON.parse(p._pfy);
    const print_areas: Record<string, string> = {};
    for (const [k, area] of Object.entries(AREE)) if (/^https?:\/\//.test(p[k] || "")) print_areas[area] = p[k];
    if (!meta.v) throw new Error(`riga ${r.title}: variante Printify mancante`);
    if (!Object.keys(print_areas).length) throw new Error(`riga ${r.title}: nessun file di stampa`);
    return { blueprint_id: Number(meta.bp), print_provider_id: Number(meta.pp), variant_id: Number(meta.v), quantity: r.quantity || 1, print_areas };
  });

  const body = {
    external_id: ext,
    label: `${ordine.name || ordine.order_number} · Tee Studio`,
    line_items,
    shipping_method: 1,
    send_shipping_notification: false,
    address_to: {
      first_name: s.first_name || "Cliente", last_name: s.last_name || "",
      email: ordine.email || ordine.contact_email || "", phone: s.phone || ordine.phone || "",
      country: s.country_code, region: s.province_code || s.province || "",
      address1: s.address1 || "", address2: s.address2 || "", city: s.city || "", zip: s.zip || "",
    },
  };
  sent.add(ext);
  try {
    const o = await pfy("POST", `/shops/${SHOP}/orders.json`, body);
    const id = o?.id;
    let produzione = false;
    if (id && process.env.TEE_PRINTIFY_AUTOSEND === "1") {
      await pfy("POST", `/shops/${SHOP}/orders/${id}/send_to_production.json`);
      produzione = true;
    }
    await tag(ordine.id, ["tee-studio", `printify-${id}`]);
    return { printify: id, righe: line_items.length, produzione };
  } catch (e) {
    sent.delete(ext);
    await tag(ordine.id, ["tee-studio", "printify-errore"]);
    throw e;
  }
}

async function leggiOrdine(id: string): Promise<any> {
  const shop = String(process.env.SHOPIFY_SHOP || "").replace(/^https?:\/\//, ""), token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("SHOPIFY_SHOP/SHOPIFY_ADMIN_TOKEN mancanti");
  const r = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION_REST || "2025-07"}/orders/${id}.json`, { headers: { "X-Shopify-Access-Token": token } });
  if (!r.ok) throw new Error(`Shopify ordine ${id}: ${r.status}`);
  return (await r.json()).order;
}

/** Firma Shopify sul corpo grezzo (req.rawBody, messo da express.json verify in _core/index.ts). */
function firmaValida(req: Request): boolean {
  const secrets = [process.env.SHOPIFY_WEBHOOK_SECRET, process.env.SHOPIFY_API_SECRET].filter(Boolean) as string[];
  const inviata = String(req.headers["x-shopify-hmac-sha256"] || "");
  const raw: Buffer | undefined = (req as any).rawBody;
  if (!raw || !inviata) return false;
  return secrets.some((sec) => {
    const c = createHmac("sha256", sec).update(raw).digest("base64");
    const a = Buffer.from(inviata), b = Buffer.from(c);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export function registerTeeStudioOrderRoutes(app: Express) {
  // webhook orders/create dedicato: tocca SOLO le righe Tee Studio, il resto dell'ordine resta com'e'
  app.post("/api/tee-studio/order", (req: Request, res: Response) => {
    // con il segreto si usa il corpo firmato; senza, l'ordine si rilegge da Shopify (fonte vera)
    const firmato = firmaValida(req);
    const id = String(req.body?.id || "").replace(/\D/g, "");
    res.status(200).end();
    if (!id) return;
    (firmato ? Promise.resolve(req.body) : leggiOrdine(id))
      .then((o) => (o && !(String(o.tags || "").includes("tee-studio")) ? inviaTeeStudio(o) : null))
      .then((x) => { if (x) console.log(`[tee-studio] ordine ${req.body?.name}: ${JSON.stringify(x)}`); })
      .catch((e) => console.error(`[tee-studio] ordine ${req.body?.name} NON inviato a Printify:`, e));
  });
}
