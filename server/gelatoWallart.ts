/**
 * Gelato Wall Art — la pubblicazione automatica dei quadri, senza Bulk Creator.
 *
 * PERCHE' ESISTE
 * Il Bulk Creator fa tutto dal browser del PC: carica i file sul worker
 * Cloudflare (R2), poi chiama `gelato-bulk-create` che crea il prodotto su
 * Gelato e lo spinge su Shopify. Andrea vuole poter approvare un quadro dal
 * telefono e vederlo online senza PC: questo modulo replica ESATTAMENTE le
 * chiamate del Bulk Creator (stessi endpoint, stessi nomi file, stesso
 * payload), ma dal server Railway.
 *
 * Le scelte che nel Bulk Creator si fanno a mano (template, prodotto da cui
 * copiare prezzi e inventario, opzioni Material/Frame) qui si leggono dalle
 * impostazioni salvate nel DB: il Bulk Creator le specchia dal localStorage a
 * ogni modifica, quindi la modalita' automatica usa le ULTIME scelte fatte da
 * Andrea, non un default inventato.
 */

import { getAllUserSettings } from "./db";

const WORKER_BASE = "https://gelato-backend.andrea-bilotta00.workers.dev";
const CHUNK = 6 * 1024 * 1024;
const OWNER_USER_ID = 1;

/** Stessa chiave amministrativa che usa il browser (VITE_* vive anche nell'env Railway). */
function headersWorker(extra?: Record<string, string>): Record<string, string> {
  const key = process.env.WORKER_KEY || process.env.VITE_WORKER_KEY || "";
  return { ...(key ? { "x-db-key": key } : {}), ...(extra || {}) };
}

/**
 * Lo store Gelato su cui pubblicare — OPZIONALE, e non e' una svista.
 *
 * Lo store vero lo tiene il worker nelle sue variabili (`GELATO_STORE_ID` su
 * Cloudflare): e' lui che chiama `stores/<id>/products:create-from-template`.
 * Il Bulk Creator passa `storeId` solo quando il browser ce l'ha, e quando
 * manca il worker usa il suo — che e' il caso normale. Pretenderlo anche qui
 * ha bloccato una pubblicazione per una variabile che non serviva a nessuno
 * (successo il 2026-09-01, primo quadro in automatico).
 */
function storeId(): string | null {
  return (process.env.GELATO_STORE_ID || process.env.VITE_GELATO_STORE_ID || "").trim() || null;
}

/* ------------------------------------------------------------------ */
/* Le impostazioni del Bulk Creator, salvate dal browser nel DB        */
/* ------------------------------------------------------------------ */

type RefProdotto = { legacyId: string; title?: string } | null;

type ImpostazioniBulk = {
  /** i template Gelato scelti nello step 3: il principale + gli extra */
  templates: { id: string; label: string }[];
  mostPopular: string;
  refsByTemplate: Record<string, { priceRef: RefProdotto; inventoryRef: RefProdotto }>;
  listingUnica: boolean;
  materialValues: string[];
  frameValues: string[];
};

const isUuid = (s?: string) =>
  !!s?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export async function impostazioniBulkCreator(): Promise<ImpostazioniBulk> {
  const s = await getAllUserSettings(OWNER_USER_ID);

  let templates: { id: string; label: string }[] = [];
  try {
    const t = JSON.parse(s["gelato.templates"] || "{}");
    if (isUuid(t?.selectedProduct?.id)) templates.push({ id: t.selectedProduct.id, label: "" });
    for (const slot of t?.extraSlots || []) {
      if (isUuid(slot?.product?.id)) templates.push({ id: slot.product.id, label: (slot.product.name || "").trim() });
    }
  } catch { /* impostazione assente o corrotta: il controllo sotto parla chiaro */ }

  if (!templates.length) {
    throw new Error(
      "Nessun template Gelato salvato. Apri il Bulk Creator una volta (anche dal telefono) e " +
        "scegli il template nello Step 3: da li' in poi la modalita' automatica riusa le tue scelte.",
    );
  }

  let auto: any = {};
  try { auto = JSON.parse(s["gelato.automation"] || "{}"); } catch { auto = {}; }

  const split = (v: unknown, fallback: string) =>
    String(typeof v === "string" && v.trim() ? v : fallback).split(",").map(x => x.trim()).filter(Boolean);

  return {
    templates,
    mostPopular: typeof auto.mostPopularVariant === "string" ? auto.mostPopularVariant.trim() : "",
    refsByTemplate: auto.refsByTemplate && typeof auto.refsByTemplate === "object" ? auto.refsByTemplate : {},
    listingUnica: auto.listingUnica === true,
    materialValues: split(auto.materialValues, "Poster, Canvas"),
    frameValues: split(auto.frameValues, "Without Frame, Black Frame, White Frame"),
  };
}

/* ------------------------------------------------------------------ */
/* Upload su R2 via worker (stesso multipart del browser)              */
/* ------------------------------------------------------------------ */

async function caricaSuR2(nomeEsatto: string, bytes: Buffer): Promise<string> {
  const start = await fetch(`${WORKER_BASE}/upload-start?filename=${encodeURIComponent(nomeEsatto)}`, {
    method: "POST",
    headers: headersWorker(),
  });
  if (!start.ok) throw new Error(`Worker upload-start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const { uploadId, key } = (await start.json()) as { uploadId: string; key: string };

  const qs = `uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}`;
  const parts: unknown[] = [];
  const totale = Math.ceil(bytes.length / CHUNK);
  for (let i = 0; i < totale; i++) {
    const chunk = bytes.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.length));
    let ultimo = "";
    let fatto = false;
    // Stessi 3 tentativi per chunk del Bulk Creator: un upload da 40 MB non
    // deve morire per un singhiozzo di rete a meta' strada.
    for (let tentativo = 0; tentativo < 3 && !fatto; tentativo++) {
      try {
        const res = await fetch(`${WORKER_BASE}/upload-part?${qs}&partNumber=${i + 1}`, {
          method: "POST",
          headers: headersWorker({ "Content-Type": "application/octet-stream" }),
          body: new Uint8Array(chunk),
        });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        parts.push(await res.json());
        fatto = true;
      } catch (e) {
        ultimo = e instanceof Error ? e.message : String(e);
        if (tentativo < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!fatto) throw new Error(`Upload fallito al chunk ${i + 1}/${totale}: ${ultimo}`);
  }

  const complete = await fetch(`${WORKER_BASE}/upload-complete?${qs}`, {
    method: "POST",
    headers: headersWorker({ "Content-Type": "application/json" }),
    body: JSON.stringify({ parts }),
  });
  if (!complete.ok) throw new Error(`Worker upload-complete ${complete.status}: ${(await complete.text()).slice(0, 200)}`);
  return ((await complete.json()) as { url: string }).url;
}

/* ------------------------------------------------------------------ */
/* Creazione prodotto (stesso payload del Bulk Creator)                */
/* ------------------------------------------------------------------ */

/** Da "50x70 cm" al rapporto del file: specchio di getVariantRatioTag del Bulk Creator. */
function ratioVariante(titolo: string): string {
  const l = (titolo || "").toLowerCase();
  if (l.includes("30x40") || l.includes("40x30") || l.includes("60x45") || l.includes("75x100")) return "3x4";
  if (l.includes("50x70") || l.includes("70x50") || l.includes("100x140") || l.includes("140x100")) return "5x7";
  if (l.includes("30x30") || l.includes("50x50") || l.includes("100x100") || l.includes("70x70")) return "1x1";
  return "default";
}

export type EsitoWallart = { titolo: string; stato: string; errore?: string };

export async function pubblicaWallartAuto(input: {
  /** titolo commerciale del quadro (fa anche da nome file su R2) */
  titolo: string;
  /**
   * La descrizione dipende dal MATERIALE, quindi si chiede una volta per
   * template: la stessa frase su carta e su tela farebbe dire a una delle due
   * schede una cosa falsa (successo il 2026-09-01: canvas venduto come
   * "heavyweight matte paper").
   */
  descrizione: (materiale: string | null) => string;
  tags: string[];
  /** i due file di stampa gia' trovati nella repo dell'agente */
  files: { tag: string; nome: string }[];
  /** come leggere i byte di un file dalla repo (la repo e' privata) */
  scarica: (nome: string) => Promise<Buffer>;
}): Promise<{ esiti: EsitoWallart[]; ok: number }> {
  const conf = await impostazioniBulkCreator();
  const shop = storeId();
  const key = process.env.WORKER_KEY || process.env.VITE_WORKER_KEY || "";
  if (!key) {
    throw new Error(
      "Manca WORKER_KEY (o VITE_WORKER_KEY) nelle variabili Railway: il worker Gelato " +
        "rifiuta le richieste senza la chiave amministrativa.",
    );
  }

  // Il nome file deve reggere R2 e la query string: stessi caratteri vietati
  // che pulisce l'upscale (titoloDa), cosi' i due mondi coincidono.
  const base = input.titolo.replace(/[\\/:*?"<>|()]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Art Print";

  // 1) Upload dei file, una volta sola, con i NOMI che il flusso Gelato conosce.
  const urls: Record<string, string> = {};
  for (const f of input.files) {
    const nomeUpload = f.tag === "5x7" ? `${base} ISO (5x7).jpg` : `${base} (${f.tag}).jpg`;
    urls[f.tag] = await caricaSuR2(nomeUpload, await input.scarica(f.nome));
  }

  // 2) Per ogni template: varianti abbinate al rapporto giusto, poi bulk-create.
  const esiti: EsitoWallart[] = [];
  for (const t of conf.templates) {
    const tplRes = await fetch(`${WORKER_BASE}/gelato-get-template?templateId=${t.id}`, { headers: headersWorker() });
    if (!tplRes.ok) {
      esiti.push({ titolo: t.label || t.id.slice(0, 8), stato: "error", errore: "Template non trovato" });
      continue;
    }
    const tpl: any = await tplRes.json();
    const varianti: any[] = tpl?.variants ?? [];
    if (!varianti.length) {
      esiti.push({ titolo: tpl?.title || t.id.slice(0, 8), stato: "error", errore: "Nessuna variante nel template" });
      continue;
    }

    const variantsPayload = varianti.map(v => {
      const nome = v?.imagePlaceholders?.[0]?.name || tpl?.imagePlaceholders?.[0]?.name || "front";
      const ratio = ratioVariante(v.title);
      const url = urls[ratio] || urls["default"] || Object.values(urls)[0];
      return { templateVariantId: v.id, imagePlaceholders: [{ name: nome, fileUrl: url }] };
    });

    // Il materiale si separa con la pipe, MAI con l'em dash: il Brain lo vieta
    // ("nessun umano lo digita") e productArtistApprovals lo ripulisce ovunque.
    // Il Bulk Creator dal browser lo usa ancora, ed e' un difetto suo.
    const suffix = t.label ? ` | ${t.label}` : "";
    const tref = conf.refsByTemplate[t.id] || { priceRef: null, inventoryRef: null };
    const res = await fetch(`${WORKER_BASE}/gelato-bulk-create`, {
      method: "POST",
      headers: headersWorker({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        templateId: tpl.id,
        publish: true,
        products: [{
          title: `${input.titolo}${suffix}`,
          // Il materiale vero: l'etichetta che Andrea ha dato allo slot, o in
          // mancanza il nome del template su Gelato.
          description: input.descrizione(t.label || tpl?.title || tpl?.productType || null),
          tags: input.tags,
          variants: variantsPayload,
        }],
        // Solo se ce l'abbiamo: senza, il worker usa il suo (vedi storeId()).
        ...(shop ? { storeId: shop } : {}),
        salesChannels: ["shopify"],
        settings: {
          mostPopular: conf.mostPopular,
          priceRef: tref.priceRef?.legacyId || "",
          inventoryRef: tref.inventoryRef?.legacyId || "",
        },
        // Le opzioni Material/Frame le aggiunge il worker quando il prodotto
        // compare su Shopify, come nel flusso manuale: qui non si aspetta.
        combine: {
          unified: conf.listingUnica,
          options: {
            ...(conf.listingUnica ? { Material: conf.materialValues } : {}),
            Frame: conf.frameValues,
          },
          priceRef: tref.priceRef?.legacyId || "",
        },
      }),
    });
    let data: any = {};
    try { data = await res.json(); } catch { /* risposta non JSON: gestita sotto */ }
    const results: any[] = data.results || [];
    if (!res.ok && !results.length) {
      esiti.push({ titolo: `${input.titolo}${suffix}`, stato: "error", errore: data.error || `Worker ${res.status}` });
    } else {
      for (const r of results) {
        esiti.push({
          titolo: r.templateName ? `${r.title} (${r.templateName})` : (r.title || `${input.titolo}${suffix}`),
          stato: r.status || "error",
          errore: r.error || undefined,
        });
      }
    }
  }

  const ok = esiti.filter(e => e.stato === "active" || e.stato === "created_in_background").length;
  if (!ok) {
    const primo = esiti.find(e => e.errore)?.errore || "nessun prodotto creato";
    throw new Error(`Pubblicazione su Gelato fallita: ${primo}`);
  }
  return { esiti, ok };
}
