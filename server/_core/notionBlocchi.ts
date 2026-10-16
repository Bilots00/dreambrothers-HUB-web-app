/*
 * I BLOCCHI DEL PIANO E I BLOCCHI DI NOTION (sync 0.9.227).
 *
 * Qui solo le conversioni, senza rete e senza database: dal blocco di Notion al blocco del piano e
 * ritorno, l'impronta del contenuto dei due lati e la struttura (chi e' il genitore in Notion di un
 * blocco del piano). I blocchi che il piano tiene come HTML (colonne, tabelle, schede, galleria,
 * immagini, file) restano agganciati ma in sola lettura: non si spingono e non si tirano.
 */
import { createHash } from "crypto";

export type BloccoP = { id: number; kind: string; text?: string; html?: string; checked?: boolean; color?: string; emoji?: string; indent?: number; children?: BloccoP[]; mod?: number; nid?: string; [k: string]: unknown };
export type BloccoN = { id: string; type: string; has_children: boolean; last_edited_time: string; in_trash?: boolean; archived?: boolean; [k: string]: any };

// i tipi che vanno e vengono; tutto il resto e' «sola lettura»
const DA_NOTION: Record<string, string> = {
  paragraph: "text", heading_1: "h1", heading_2: "h2", heading_3: "h3", bulleted_list_item: "bullet",
  numbered_list_item: "number", to_do: "todo", toggle: "toggle", quote: "quote", callout: "callout", code: "code", divider: "divider",
};
const A_NOTION: Record<string, string> = Object.fromEntries(Object.entries(DA_NOTION).map(([n, p]) => [p, n]));
export const SINCRONIZZABILE = (k: string) => k in A_NOTION || /^theading[123]$/.test(k);
// nel piano tengono i figli in `children`; gli altri li tengono come righe rientrate (indent)
export const CONTENITORE = (k: string) => k === "toggle" || k.startsWith("theading") || k === "tabs" || k === "tab";

export function kindDi(n: BloccoN): string | null {
  if (/^heading_[123]$/.test(n.type) && n[n.type]?.is_toggleable) return "theading" + n.type.slice(-1);
  return DA_NOTION[n.type] ?? null;
}
/** Per l'aggancio: che cosa e' un blocco, ai due lati, in una parola. */
export function classeN(n: BloccoN): string {
  const k = kindDi(n); if (k) return k.replace(/^theading/, "h");
  if (n.type === "column_list") return "col";
  if (n.type === "pdf") return "file";
  return n.type;
}
export function classeP(b: BloccoP): string {
  if (/^col[234]$/.test(b.kind)) return "col";
  return b.kind.replace(/^theading/, "h");
}
export const normale = (t: string) => t.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- testo formattato
type RT = { type: string; plain_text?: string; text?: { content: string; link?: { url: string } | null }; href?: string | null; annotations?: Record<string, any> };
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLORE_P = (c: string) => c.replace(/_background$/, "_bg");
const COLORE_N = (c: string) => c.replace(/_bg$/, "_background");

export function testoDi(rt: RT[]): string { return (rt ?? []).map(r => r.plain_text ?? r.text?.content ?? "").join(""); }
/** Il rich_text di Notion come l'HTML piccolo del piano (rich.ts); undefined se non c'e' formattazione. */
export function htmlDi(rt: RT[]): string | undefined {
  let formattato = false;
  const h = (rt ?? []).map(r => {
    const a = r.annotations ?? {};
    let s = esc(r.plain_text ?? r.text?.content ?? "").replace(/\n/g, "<br>");
    if (a.code) { s = `<code>${s}</code>`; formattato = true; }
    if (a.bold) { s = `<b>${s}</b>`; formattato = true; }
    if (a.italic) { s = `<i>${s}</i>`; formattato = true; }
    if (a.underline) { s = `<u>${s}</u>`; formattato = true; }
    if (a.strikethrough) { s = `<s>${s}</s>`; formattato = true; }
    if (a.color && a.color !== "default") { s = `<span data-c="${COLORE_P(a.color)}">${s}</span>`; formattato = true; }
    const url = r.href ?? r.text?.link?.url;
    if (url && /^(https?:|mailto:|tel:)/i.test(url)) { s = `<a href="${esc(url).replace(/"/g, "&quot;")}">${s}</a>`; formattato = true; }
    return s;
  }).join("");
  return formattato ? h : undefined;
}
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const deEnt = (t: string) => t.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : m));
/** L'HTML del piano come rich_text di Notion (pezzi da al massimo 2000 caratteri). */
export function richDi(text: string, html?: string): any[] {
  const pezzi: { t: string; a: Record<string, any>; url?: string }[] = [];
  if (!html) pezzi.push({ t: text ?? "", a: {} });
  else {
    const pila: { tag: string; a: Record<string, any>; url?: string }[] = [{ tag: "", a: {} }];
    const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const cima = pila[pila.length - 1]!;
      if (m[4] !== undefined) { pezzi.push({ t: deEnt(m[4]), a: cima.a, url: cima.url }); continue; }
      const tag = m[2]!.toLowerCase();
      if (tag === "br") { pezzi.push({ t: "\n", a: cima.a, url: cima.url }); continue; }
      if (m[1]) { for (let i = pila.length - 1; i > 0; i--) if (pila[i]!.tag === tag) { pila.length = i; break; } continue; }
      if (/\/\s*$/.test(m[3] ?? "")) continue;
      const a = { ...cima.a }; let url = cima.url;
      if (tag === "b" || tag === "strong") a.bold = true;
      else if (tag === "i" || tag === "em") a.italic = true;
      else if (tag === "u") a.underline = true;
      else if (tag === "s" || tag === "del") a.strikethrough = true;
      else if (tag === "code") a.code = true;
      else if (tag === "a") { const h = /href="([^"]*)"/i.exec(m[3] ?? ""); if (h) url = deEnt(h[1]!); }
      else if (tag === "span") { const c = /data-c="([a-z_]+)"/i.exec(m[3] ?? ""); if (c) a.color = COLORE_N(c[1]!); }
      pila.push({ tag, a, url });
    }
  }
  const out: any[] = [];
  for (const p of pezzi) {
    if (!p.t) continue;
    const ultimo = out[out.length - 1];
    if (ultimo && JSON.stringify(ultimo._a) === JSON.stringify(p.a) && ultimo._u === p.url) { ultimo.text.content += p.t; continue; }
    out.push({ type: "text", text: { content: p.t, ...(p.url ? { link: { url: p.url } } : {}) }, annotations: p.a, _a: p.a, _u: p.url });
  }
  const finale: any[] = [];
  for (const r of out) {
    const { _a, _u, ...x } = r;
    for (let i = 0; i < x.text.content.length || i === 0; i += 2000) {
      finale.push({ ...x, text: { ...x.text, content: x.text.content.slice(i, i + 2000) } });
      if (!x.text.content.length) break;
    }
  }
  return finale;
}

// ---------------------------------------------------------------- un blocco, nei due sensi
/** Il blocco di Notion come contenuto del piano (senza id, figli e rientro). */
export function pianoDi(n: BloccoN): Partial<BloccoP> | null {
  const kind = kindDi(n); if (!kind) return null;
  const d = n[n.type] ?? {};
  if (kind === "divider") return { kind, text: "" };
  const rt: RT[] = d.rich_text ?? [];
  const p: Partial<BloccoP> = { kind, text: testoDi(rt) };
  const h = htmlDi(rt); if (h) p.html = h;
  if (kind === "todo") p.checked = !!d.checked;
  if (d.color && d.color !== "default") p.color = COLORE_P(d.color);
  if (kind === "callout" && d.icon?.type === "emoji") p.emoji = d.icon.emoji;
  return p;
}
/** Il corpo da mandare a Notion per creare (o aggiornare) un blocco del piano. */
export function notionDi(b: BloccoP): { type: string; body: Record<string, any> } | null {
  const th = /^theading([123])$/.exec(b.kind);
  const type = th ? `heading_${th[1]}` : A_NOTION[b.kind];
  if (!type) return null;
  if (type === "divider") return { type, body: {} };
  const body: Record<string, any> = { rich_text: richDi(String(b.text ?? ""), b.html as string | undefined) };
  if (b.color) body.color = COLORE_N(String(b.color));
  if (th) body.is_toggleable = true;
  else if (/^heading_/.test(type)) body.is_toggleable = false;
  if (type === "to_do") body.checked = !!b.checked;
  if (type === "code") body.language = "plain text";
  if (type === "callout" && b.emoji) body.icon = { type: "emoji", emoji: b.emoji };
  return { type, body };
}

// ---------------------------------------------------------------- impronte
const h = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("base64").slice(0, 16);
export function impP(b: BloccoP): string { return h([b.kind, b.text ?? "", b.html ?? "", !!b.checked, b.color ?? "", b.emoji ?? ""]); }
export function impN(n: BloccoN): string {
  const d = n[n.type] ?? {};
  return h([n.type, !!d.is_toggleable, (d.rich_text ?? []).map((r: RT) => [r.plain_text ?? r.text?.content ?? "", r.href ?? null, r.annotations ?? {}]), !!d.checked, d.color ?? "", d.icon?.emoji ?? ""]);
}

// ---------------------------------------------------------------- struttura del piano
export type Posto = { b: BloccoP; padre: number | null; fratelli: number[] };
/**
 * Per ogni blocco della pagina, in ordine: il blocco del piano che in Notion gli fa da genitore
 * (null = la pagina) e i fratelli che ha prima (dal piu' vicino), con lo stesso genitore.
 * Un elenco annidato nel piano e' fatto di righe rientrate: il genitore di una riga con rientro n
 * e' l'ultima riga prima di lei con rientro n-1.
 */
export function struttura(blocks: BloccoP[]): Posto[] {
  const out: Posto[] = [];
  const figliDi = new Map<number | null, number[]>();
  const giro = (list: BloccoP[], padre: number | null) => {
    const pila: BloccoP[] = [];
    for (const b of list) {
      const r = Math.max(0, Number(b.indent) || 0);
      pila.length = Math.min(pila.length, r);
      const p = r > 0 && pila[r - 1] ? pila[r - 1]!.id : padre;
      const fr = figliDi.get(p) ?? []; figliDi.set(p, fr);
      out.push({ b, padre: p, fratelli: [...fr].reverse() });
      fr.push(b.id);
      pila[r] = b;
      // 0.9.272: il blocco sincronizzato del piano non va in Notion, e nemmeno quello che ha dentro (in Notion
      // finirebbe come righe sciolte, una copia per ogni pagina dove e' incollato)
      if (b.children?.length && b.kind !== "sincro") giro(b.children, b.id);
    }
  };
  giro(blocks, null);
  return out;
}
