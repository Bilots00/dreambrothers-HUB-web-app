import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { rows } from "./focuslockRoutes";
import { conChiave, leggiQuaderno, pianoTabelle, scriviQuaderno } from "./focuslockPiano";
import {
  CONTENITORE, SINCRONIZZABILE, classeN, classeP, impN, impP, kindDi, normale, notionDi, pianoDi, struttura, testoDi,
  type BloccoN, type BloccoP,
} from "./notionBlocchi";

/*
 * IL PIANO DI DREAMMAP E NOTION, NEI DUE SENSI (sync 0.9.227).
 *
 * Andrea scrive la sua «To do list» e la «Knowledge & Tools» sia nel piano (app e sito /piano/) sia in
 * Notion. Questo job, sul server e non sul telefono, tiene allineate le due cose:
 *   - ogni blocco del piano porta `nid`, l'ID del suo blocco in Notion. Si confronta SOLO per nid, mai
 *     per testo: la vecchia sync del telefono (foglio-sync.js) confrontava i testi, leggeva solo 100
 *     figli e ha riempito la pagina di Notion con ~59.000 doppioni;
 *   - per ogni pagina agganciata c'e' un'«ombra» (tabella focuslock_notion): per ogni nid l'impronta
 *     del contenuto com'era all'ultima sincronizzazione, dal lato del piano (hp) e da quello di Notion
 *     (hn), e il posto (genitore, fratello prima). Cambiato da una parte sola = si copia dall'altra;
 *     cambiato da tutte e due = vince il piu' recente;
 *   - ogni lettura dei figli in Notion passa TUTTE le pagine (has_more / next_cursor), senza tetto;
 *   - un blocco creato in Notion dal job si scrive nell'ombra SUBITO, prima di ogni altra cosa: se il
 *     giro si interrompe, al giro dopo il blocco risulta gia' fatto e non si crea due volte;
 *   - NOTION_SYNC=prova: il job calcola e scrive nel registro (/api/focuslock/notion/:k/stato) quello
 *     che farebbe, senza toccare ne' Notion ne' il piano. NOTION_SYNC=on: lo fa. Altro valore: fermo.
 *   - l'aggancio iniziale (i blocchi importati non avevano il nid) allinea i due alberi lista per lista;
 *     i blocchi che non combaciano restano fuori dalla sincronizzazione per sempre (`fuori`, `x`): cosi'
 *     l'aggancio non puo' creare doppioni.
 */

const NV = "2022-06-28";
const OGNI = 20_000;
const SCANSIONE_COMUNQUE = 10 * 60_000; // anche senza segnali, una rilettura completa ogni 10 minuti
const modo = () => (process.env.NOTION_SYNC || "").trim().toLowerCase();
const token = () => (process.env.NOTION_TOKEN || "").trim();
const CHIAVE = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const trattini = (id: string) => { const x = id.replace(/-/g, "").toLowerCase(); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };

// ---------------------------------------------------------------- l'API di Notion, con il freno
// Notion dichiara ~3 chiamate al secondo «in media, con picchi ammessi»: misurato il 12/10/2026,
// 60 letture con 6 in parallelo = 15,8 al secondo senza un solo 429. Si parte una chiamata ogni
// 70 ms, al massimo 8 in volo; al primo 429 TUTTE le chiamate si fermano per il tempo che dice Notion.
let ultima = 0, inVolo = 0, fermiFino = 0;
let chiamate = 0;
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms));
async function turno() {
  for (;;) {
    const ora = Date.now();
    if (ora < fermiFino) { await pausa(fermiFino - ora); continue; }
    if (inVolo >= 8) { await pausa(30); continue; }
    const attesa = ultima + 70 - ora;
    if (attesa > 0) { await pausa(attesa); continue; }
    ultima = ora; inVolo++; return;
  }
}
async function api(method: string, path: string, body?: unknown): Promise<any> {
  if (!token()) throw new Error("manca NOTION_TOKEN");
  for (let tentativo = 0; ; tentativo++) {
    await turno();
    chiamate++;
    let r: globalThis.Response;
    try {
      r = await fetch("https://api.notion.com/v1" + path, {
        method, headers: { Authorization: "Bearer " + token(), "Notion-Version": NV, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } finally { inVolo--; }
    if (r.status === 429 || r.status >= 500) {
      if (tentativo >= 6) throw new Error(`Notion ${r.status} su ${method} ${path}`);
      const ms = Math.max(1000, Number(r.headers.get("retry-after") || 0) * 1000) * (tentativo + 1);
      if (r.status === 429) fermiFino = Math.max(fermiFino, Date.now() + ms);
      await pausa(ms);
      continue;
    }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { const e: any = new Error(`Notion ${r.status} ${j?.code || ""}: ${j?.message || ""} (${method} ${path})`); e.status = r.status; e.code = j?.code; throw e; }
    return j;
  }
}
/** Tutti i figli di un blocco o di una pagina: pagina dopo pagina, finche' Notion dice che non ce n'e' piu'. */
async function figli(id: string): Promise<BloccoN[]> {
  const out: BloccoN[] = [];
  let cur: string | undefined;
  do {
    const j = await api("GET", `/blocks/${id}/children?page_size=100${cur ? "&start_cursor=" + encodeURIComponent(cur) : ""}`);
    out.push(...(j.results ?? []));
    cur = j.has_more ? j.next_cursor : undefined;
  } while (cur);
  return out;
}
// dentro questi non si scende mai: il piano li tiene interi (HTML) o non li ha
const NON_SCENDERE = new Set(["child_page", "child_database", "column_list", "column", "table", "synced_block", "link_to_page", "unsupported", "template"]);

// ---------------------------------------------------------------- l'ombra
type Voce = { pid: number; hp: string; hn: string; hpv?: string; par: string; prv: string | null; ro?: 1; t?: string };
type Ombra = {
  notion: string; at: number; visto: string; scanInizio: number; scanAt: number;
  voci: Record<string, Voce>; x: string[]; fuori: number[];
  ferma?: string; // la sync di questa pagina si e' fermata da sola: serve un'occhiata prima di ripartire
};
type Stato = { giri: number; ultimo?: number; errore?: string; registro: string[]; prova?: string[]; conti?: Record<string, number> };
let pronte: Promise<void> | null = null;
function tabelle(): Promise<void> {
  if (!pronte) pronte = (async () => {
    await pianoTabelle();
    await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_notion (
      chiave VARCHAR(64) NOT NULL,
      pagina VARCHAR(80) NOT NULL,
      ombra LONGTEXT NULL,
      stato LONGTEXT NULL,
      updatedAt TIMESTAMP NULL,
      PRIMARY KEY (chiave, pagina)
    )`);
  })().catch(e => { pronte = null; throw e; });
  return pronte;
}
async function leggiRiga(k: string, pagina: string): Promise<{ ombra: Ombra | null; stato: Stato } | null> {
  const r = await rows(sql`SELECT ombra, stato FROM focuslock_notion WHERE chiave = ${k} AND pagina = ${pagina} LIMIT 1`);
  if (!r.length) return null;
  let ombra: Ombra | null = null, stato: Stato = { giri: 0, registro: [] };
  try { ombra = r[0].ombra ? JSON.parse(String(r[0].ombra)) : null; } catch { ombra = null; }
  try { stato = r[0].stato ? JSON.parse(String(r[0].stato)) : stato; } catch { /* nuovo */ }
  return { ombra, stato };
}
async function salvaOmbra(k: string, pagina: string, o: Ombra) {
  await rows(sql`INSERT INTO focuslock_notion (chiave, pagina, ombra, updatedAt) VALUES (${k}, ${pagina}, ${JSON.stringify(o)}, NOW())
    ON DUPLICATE KEY UPDATE ombra = VALUES(ombra), updatedAt = NOW()`);
}
async function salvaStato(k: string, pagina: string, s: Stato) {
  s.registro = s.registro.slice(-300);
  await rows(sql`INSERT INTO focuslock_notion (chiave, pagina, stato, updatedAt) VALUES (${k}, ${pagina}, ${JSON.stringify(s)}, NOW())
    ON DUPLICATE KEY UPDATE stato = VALUES(stato), updatedAt = NOW()`);
}
const scrivi = (s: Stato, riga: string) => { s.registro.push(new Date().toISOString().slice(0, 19).replace("T", " ") + " " + riga); };

// ---------------------------------------------------------------- il piano: trovare e cambiare blocchi
type Pagina = { id: string; mod?: number; blocks: BloccoP[]; tomb?: Record<string, number>; notion?: string; notionAt?: number; [k: string]: unknown };
type Dove = { list: BloccoP[]; i: number; padre: BloccoP | null };
function trova(list: BloccoP[], f: (b: BloccoP) => boolean, padre: BloccoP | null = null): Dove | null {
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (f(b)) return { list, i, padre };
    if (b.children?.length) { const r = trova(b.children, f, b); if (r) return r; }
  }
  return null;
}
function tutti(list: BloccoP[], out: BloccoP[] = []): BloccoP[] { for (const b of list) { out.push(b); if (b.children?.length) tutti(b.children, out); } return out; }
const rientro = (b: BloccoP) => Math.max(0, Number(b.indent) || 0);
/** Quante righe dopo la i-esima le stanno «sotto» (rientro maggiore): si muovono con lei. */
function coda(list: BloccoP[], i: number): number { const r = rientro(list[i]!); let n = 0; while (i + 1 + n < list.length && rientro(list[i + 1 + n]!) > r) n++; return n; }
let contatore = 0;
const nuovoId = () => Date.now() * 1000 + 500 + (contatore++ % 500);

/**
 * Dove va, nel piano, un blocco che in Notion sta sotto `par` ('' = la pagina) dopo `prv`.
 * Dentro un elenco espandibile: fra i suoi figli. Sotto una riga normale: come riga rientrata.
 */
function posto(p: Pagina, par: string, prv: string | null): { list: BloccoP[]; i: number; rientro: number } | null {
  let list: BloccoP[], inizio: number, r: number;
  if (!par) { list = p.blocks; inizio = 0; r = 0; }
  else {
    const d = trova(p.blocks, b => b.nid === par); if (!d) return null;
    const g = d.list[d.i]!;
    if (CONTENITORE(g.kind)) { g.children = g.children ?? []; list = g.children; inizio = 0; r = 0; }
    else { list = d.list; inizio = d.i + 1 + 0; r = rientro(g) + 1; }
  }
  if (prv) {
    const j = list.findIndex(b => b.nid === prv);
    if (j >= 0) return { list, i: j + 1 + coda(list, j), rientro: r };
  }
  return { list, i: inizio, rientro: r };
}

// ---------------------------------------------------------------- l'aggancio (una volta sola)
/** Le coppie (i, j) della sottosequenza comune piu' lunga; se le liste sono enormi, in avanti e basta. */
function allinea(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  if (n * m > 8_000_000) {
    const out: [number, number][] = []; let j = 0;
    for (let i = 0; i < n && j < m; i++) { const k = b.indexOf(a[i]!, j); if (k >= 0) { out.push([i, k]); j = k + 1; } }
    return out;
  }
  const L = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * (m + 1) + j] = a[i] === b[j] ? L[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(L[(i + 1) * (m + 1) + j]!, L[i * (m + 1) + j + 1]!);
  const out: [number, number][] = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (L[(i + 1) * (m + 1) + j]! >= L[i * (m + 1) + j + 1]!) i++; else j++;
  }
  return out;
}
const chiaveP = (b: BloccoP) => classeP(b) + "|" + (SINCRONIZZABILE(b.kind) ? normale(String(b.text ?? "")) : "");
const chiaveN = (n: BloccoN) => classeN(n) + "|" + (kindDi(n) ? normale(testoDi(n[n.type]?.rich_text ?? [])) : "");

async function aggancia(k: string, paginaId: string, notionId: string, stato: Stato): Promise<Record<string, number>> {
  const q = await leggiQuaderno(k); if (!q) throw new Error("quaderno vuoto");
  const p = (q.dati.pages as unknown as Pagina[]).find(x => x.id === paginaId); if (!p) throw new Error("pagina del piano non trovata: " + paginaId);
  const posti = struttura(p.blocks);
  const gruppi = new Map<number | null, BloccoP[]>();
  posti.forEach(x => { const g = gruppi.get(x.padre) ?? []; g.push(x.b); gruppi.set(x.padre, g); });
  const voci: Record<string, Voce> = {}; const x: string[] = []; const legati = new Map<number, string>();
  let lette = 0;
  const lista = async (nPadre: string, pPadre: number | null, parKey: string) => {
    const nb = await figli(nPadre); lette += nb.length;
    const pl = gruppi.get(pPadre) ?? [];
    const coppie = allinea(pl.map(chiaveP), nb.map(chiaveN));
    const preso = new Set(coppie.map(c => c[1]));
    nb.forEach((n, j) => { if (!preso.has(j)) x.push(n.id); });
    let prv: string | null = null;
    const giu: Promise<void>[] = [];
    for (const [i, j] of coppie) {
      const b = pl[i]!, n = nb[j]!;
      const ro = !SINCRONIZZABILE(b.kind) || !kindDi(n);
      voci[n.id] = { pid: b.id, hp: impP(b), hn: impN(n), par: parKey, prv, t: n.type, ...(ro ? { ro: 1 as const } : {}) };
      legati.set(b.id, n.id); prv = n.id;
      if (!ro && n.has_children && !NON_SCENDERE.has(n.type)) giu.push(lista(n.id, b.id, n.id));
    }
    await Promise.all(giu);
  };
  const pg = await api("GET", `/pages/${notionId}`);
  await lista(notionId, null, "");
  const fuori = tutti(p.blocks).filter(b => !legati.has(b.id)).map(b => b.id);
  const ombra: Ombra = { notion: notionId, at: Date.now(), visto: pg.last_edited_time, scanInizio: Date.now(), scanAt: Date.now(), voci, x, fuori };
  await salvaOmbra(k, paginaId, ombra);
  // i nid nel piano (sotto il lucchetto, sulla copia di adesso)
  await conChiave(k, async () => {
    const c = await leggiQuaderno(k); if (!c) return;
    const pc = (c.dati.pages as unknown as Pagina[]).find(z => z.id === paginaId); if (!pc) return;
    tutti(pc.blocks).forEach(b => { const n = legati.get(b.id); if (n) b.nid = n; });
    pc.notion = notionId; pc.notionAt = ombra.at;
    await scriviQuaderno(k, c.dati, Date.now());
  });
  const conti = { lettiNotion: lette, agganciati: legati.size, soloLettura: Object.values(voci).filter(v => v.ro).length, fuoriPiano: fuori.length, fuoriNotion: x.length, chiamate };
  scrivi(stato, `aggancio a ${notionId}: ${JSON.stringify(conti)}`);
  return conti;
}

// ---------------------------------------------------------------- un giro
type LettoN = { n: BloccoN; par: string; prv: string | null };
async function scansiona(o: Ombra): Promise<{ letti: Map<string, LettoN>; nuoviX: string[] }> {
  const letti = new Map<string, LettoN>(); const nuoviX: string[] = []; const xs = new Set(o.x);
  const giro = async (id: string, parKey: string, padreFuori: boolean) => {
    const nb = await figli(id);
    let prv: string | null = null;
    for (const n of nb) {
      if (xs.has(n.id)) continue;
      const v = o.voci[n.id];
      if (!v && (padreFuori || !kindDi(n))) { nuoviX.push(n.id); continue; } // nuovo e non sincronizzabile: fuori, per sempre
      letti.set(n.id, { n, par: parKey, prv }); prv = n.id;
    }
    // i rami si leggono in parallelo (il freno sta in api)
    await Promise.all(nb.filter(n => letti.has(n.id) && n.has_children && !o.voci[n.id]?.ro && !NON_SCENDERE.has(n.type)).map(n => giro(n.id, n.id, false)));
  };
  await giro(o.notion, "", false);
  return { letti, nuoviX };
}

type Op =
  | { t: "agg"; nid: string; pid: number; tipo: string; body: Record<string, any>; hp: string }
  | { t: "via"; nid: string }
  | { t: "nuovo"; pid: number }
  | { t: "tira"; nid: string; contenuto: Partial<BloccoP>; seImp: string | null; hn: string; nuovoPar: string; nuovoPrv: string | null }
  | { t: "togli"; nid: string; seImp: string | null }
  | { t: "sposta"; nid: string; par: string; prv: string | null }
  | { t: "metti"; n: BloccoN; par: string; prv: string | null };

const descrivi = (op: Op, p: Pagina): string => {
  const testo = (pid: number) => { const d = trova(p.blocks, b => b.id === pid); return d ? JSON.stringify(String(d.list[d.i]!.text ?? "").slice(0, 60)) : "?"; };
  switch (op.t) {
    case "agg": return `-> Notion: aggiorno ${op.nid} con ${testo(op.pid)}`;
    case "via": return `-> Notion: cancello ${op.nid}`;
    case "nuovo": return `-> Notion: creo ${testo(op.pid)}`;
    case "tira": return `<- piano: aggiorno ${op.nid} con ${JSON.stringify(String(op.contenuto.text ?? "").slice(0, 60))}`;
    case "togli": return `<- piano: tolgo ${op.nid}`;
    case "sposta": return `<- piano: sposto ${op.nid} sotto ${op.par || "la pagina"} dopo ${op.prv ?? "l'inizio"}`;
    case "metti": return `<- piano: aggiungo ${JSON.stringify(testoDi(op.n[op.n.type]?.rich_text ?? []).slice(0, 60))}`;
  }
};

type Lettura = "mai" | "se-serve" | "sempre";
async function giro(k: string, paginaId: string, lettura: Lettura = "se-serve"): Promise<void> {
  const riga = await leggiRiga(k, paginaId); if (!riga?.ombra) return;
  const o = riga.ombra, stato = riga.stato;
  if (o.ferma) return;
  const prova = modo() === "prova";
  stato.giri++; stato.ultimo = Date.now();
  try {
    // 1. Notion: si rilegge solo se la pagina e' cambiata (l'ora di Notion va al minuto: se il minuto
    //    di quell'ora non era finito quando abbiamo letto l'ultima volta, si rilegge ancora)
    const pg = lettura === "mai" ? null : await api("GET", `/pages/${o.notion}`);
    const serve = !!pg && (lettura === "sempre" || pg.last_edited_time !== o.visto || Date.parse(pg.last_edited_time) + 60_000 > o.scanInizio || Date.now() - o.scanAt > SCANSIONE_COMUNQUE);
    let letti: Map<string, LettoN> | null = null;
    const inizio = Date.now();
    let durata = -1;
    if (serve) { const s = await scansiona(o); letti = s.letti; durata = Date.now() - inizio; if (!prova && s.nuoviX.length) o.x.push(...s.nuoviX); }

    // 2. il piano, adesso
    const q = await leggiQuaderno(k); if (!q) throw new Error("quaderno vuoto");
    const p = (q.dati.pages as unknown as Pagina[]).find(x => x.id === paginaId); if (!p) throw new Error("pagina sparita dal piano");
    const posti = struttura(p.blocks);
    const perPid = new Map(posti.map(x => [x.b.id, x]));
    const pidNid = new Map<number, string>();
    Object.entries(o.voci).forEach(([nid, v]) => pidNid.set(v.pid, nid));
    // un nid perso per strada (una copia vecchia del quaderno) si ritrova dall'ombra
    const ritrovati: [number, string][] = [];
    posti.forEach(x => { if (!x.b.nid && pidNid.has(x.b.id)) { x.b.nid = pidNid.get(x.b.id)!; ritrovati.push([x.b.id, x.b.nid]); } });
    const perNid = new Map<string, typeof posti[number]>();
    posti.forEach(x => { if (x.b.nid && o.voci[x.b.nid]) perNid.set(x.b.nid, x); });
    const nidDi = (pid: number | null): string | null => (pid === null ? "" : perPid.get(pid)?.b.nid && o.voci[perPid.get(pid)!.b.nid!] ? perPid.get(pid)!.b.nid! : null);
    const parP = (x: typeof posti[number]) => { const r = nidDi(x.padre); return r === null ? "?" : r; };
    const prvP = (x: typeof posti[number]) => { for (const f of x.fratelli) { const n = nidDi(f); if (n) return n; } return null; };

    const ops: Op[] = [];
    const daRifare = new Set<string>(); // cancellati in Notion per essere ricreati (spostati, cambiati di tipo)
    for (const [nid, v] of Object.entries(o.voci)) {
      const x = perNid.get(nid); const pb = x?.b;
      const ln = letti ? letti.get(nid) : undefined; const nb = ln?.n;
      const nVia = !!letti && !ln;
      // un blocco che manca nel piano e' cancellato SOLO se il piano lo dice (tomb). Senza lapide e' una
      // copia vecchia del quaderno (un'app non aggiornata): il blocco torna dal lato di Notion
      const lapide = p.tomb?.[String(v.pid)];
      if (!pb && lapide === undefined && !nVia) {
        const n = nb ?? await api("GET", `/blocks/${nid}`).catch(() => null);
        if (n && !n.in_trash && !n.archived) { ops.push({ t: "metti", n, par: ln?.par ?? v.par, prv: ln?.prv ?? v.prv }); delete o.voci[nid]; continue; }
        delete o.voci[nid]; continue;
      }
      if (v.ro) {
        if (!pb && !nVia) ops.push({ t: "via", nid });
        else if (pb && nVia) ops.push({ t: "togli", nid, seImp: null });
        else if (!pb && nVia) delete o.voci[nid];
        continue;
      }
      let pC: "" | "mod" | "via" | "vecchio" = !pb ? "via" : impP(pb) !== v.hp ? "mod" : "";
      if (pC === "mod" && v.hpv && impP(pb!) === v.hpv) pC = "vecchio";
      const nC: "" | "mod" | "via" = nVia ? "via" : nb && impN(nb) !== v.hn ? "mod" : "";
      if (pC === "via" && nC === "via") { delete o.voci[nid]; continue; }
      if (pC === "via") {
        const tolto = lapide ?? 0;
        if (nC === "mod" && nb && Date.parse(nb.last_edited_time) + 30_000 > tolto) { ops.push({ t: "metti", n: nb, par: ln!.par, prv: ln!.prv }); delete o.voci[nid]; }
        else ops.push({ t: "via", nid });
        continue;
      }
      if (nC === "via") {
        if (pC === "mod") { daRifare.add(nid); delete o.voci[nid]; } // modificato qui dopo: torna in Notion come nuovo
        else ops.push({ t: "togli", nid, seImp: impP(pb!) });
        continue;
      }
      // contenuto
      const nuovoNotion = notionDi(pb!);
      const tira = (n: BloccoN) => { const c = pianoDi(n); if (c) ops.push({ t: "tira", nid, contenuto: c, seImp: impP(pb!), hn: impN(n), nuovoPar: letti?.get(nid)?.par ?? v.par, nuovoPrv: letti?.get(nid)?.prv ?? v.prv }); };
      if (pC === "vecchio") { const n = nb ?? await api("GET", `/blocks/${nid}`); tira(n); }
      else if (pC === "mod" && nC === "mod" && nb && Date.parse(nb.last_edited_time) + 30_000 > (pb!.mod ?? 0)) tira(nb);
      else if (pC === "mod") {
        if (!nuovoNotion || nuovoNotion.type !== v.t) daRifare.add(nid);
        else ops.push({ t: "agg", nid, pid: pb!.id, tipo: nuovoNotion.type, body: nuovoNotion.body, hp: impP(pb!) });
      } else if (nC === "mod" && nb) tira(nb);
      // posto
      if (daRifare.has(nid)) continue;
      const nMov = !!ln && (ln.par !== v.par || ln.prv !== v.prv);
      const pp = parP(x!), pv = prvP(x!);
      const pMov = pp !== "?" && (pp !== v.par || pv !== v.prv);
      if (nMov) ops.push({ t: "sposta", nid, par: ln!.par, prv: ln!.prv });
      else if (pMov) daRifare.add(nid);
    }
    // i blocchi da rifare in Notion si portano dietro tutti quelli che in Notion stanno sotto di loro
    if (daRifare.size) {
      const sotto = (nid: string) => Object.entries(o.voci).filter(([, v]) => v.par === nid).map(([n]) => n);
      const coda2 = Array.from(daRifare);
      while (coda2.length) { const n = coda2.pop()!; for (const s of sotto(n)) if (!daRifare.has(s)) { daRifare.add(s); coda2.push(s); } }
      for (let i = ops.length - 1; i >= 0; i--) { const op = ops[i]!; if ((op.t === "agg" || op.t === "tira" || op.t === "sposta" || op.t === "togli") && daRifare.has(op.nid)) ops.splice(i, 1); }
      for (const nid of Array.from(daRifare)) {
        if (!letti || letti.has(nid)) { const pr = o.voci[nid]?.par; if (!pr || !daRifare.has(pr)) ops.push({ t: "via", nid }); }
        const x = perNid.get(nid); if (x) { delete x.b.nid; perNid.delete(nid); }
        delete o.voci[nid];
      }
    }
    // nuovi nel piano: senza nid, non lasciati fuori all'aggancio, di un tipo che Notion capisce
    const fuori = new Set(o.fuori);
    for (const x of posti) if (!(x.b.nid && o.voci[x.b.nid]) && !fuori.has(x.b.id) && (SINCRONIZZABILE(x.b.kind) || (x.b.kind === "image" && /^https:/.test(String(x.b["src"] ?? ""))))) ops.push({ t: "nuovo", pid: x.b.id });
    // nuovi in Notion
    if (letti) for (const [nid, ln] of Array.from(letti)) if (!o.voci[nid] && !ops.some(op => op.t === "metti" && op.n.id === nid)) ops.push({ t: "metti", n: ln.n, par: ln.par, prv: ln.prv });

    if (prova) {
      stato.prova = ops.slice(0, 400).map(op => descrivi(op, p));
      stato.conti = { operazioni: ops.length, voci: Object.keys(o.voci).length, letti: letti?.size ?? -1, chiamate };
      if (ops.length) scrivi(stato, `prova: ${ops.length} operazioni (vedi «prova»)`);
      delete stato.errore;
      await salvaStato(k, paginaId, stato);
      return;
    }

    // 3. Notion: cancellazioni, aggiornamenti, creazioni (in ordine di pagina)
    const salva = () => salvaOmbra(k, paginaId, o);
    for (const op of ops) {
      if (op.t === "via") {
        try { await api("DELETE", `/blocks/${op.nid}`); } catch (e: any) { if (e.status !== 404 && !/archived/i.test(e.message)) throw e; }
        delete o.voci[op.nid]; scrivi(stato, descrivi(op, p)); await salva();
      } else if (op.t === "agg") {
        const r = await api("PATCH", `/blocks/${op.nid}`, { [op.tipo]: op.body });
        const v = o.voci[op.nid]!; v.hp = op.hp; v.hn = impN(r); delete v.hpv; scrivi(stato, descrivi(op, p));
      }
    }
    await salva();
    const assegnati: [number, string][] = [...ritrovati];
    for (const op of ops) {
      if (op.t !== "nuovo") continue;
      const x = perPid.get(op.pid)!;
      const par = nidDi(x.padre); if (par === null) continue; // il genitore non e' in Notion (lasciato fuori all'aggancio)
      const corpo = x.b.kind === "image" ? { type: "image", body: { type: "external", external: { url: String(x.b["src"]) } } } : notionDi(x.b);
      if (!corpo) continue;
      const after = prvP(x);
      const r = await api("PATCH", `/blocks/${par || o.notion}/children`, { children: [{ object: "block", type: corpo.type, [corpo.type]: corpo.body }], position: after ? { type: "after_block", after_block: { id: after } } : { type: "start" } });
      // il nuovo e' il blocco della risposta che non conosciamo (ne' agganciato ne' lasciato fuori)
      const xs = new Set(o.x);
      const ignoti: BloccoN[] = (r.results ?? []).filter((z: BloccoN) => z.type === corpo.type && !o.voci[z.id] && !xs.has(z.id) && !perNid.has(z.id));
      let nuovo: BloccoN | undefined = ignoti.length === 1 ? ignoti[0] : undefined;
      if (!nuovo && after && Array.isArray(r.results)) { const i = r.results.findIndex((z: BloccoN) => z.id === after); if (i >= 0 && ignoti.includes(r.results[i + 1])) nuovo = r.results[i + 1]; }
      if (!nuovo) {
        o.ferma = `creato un blocco in Notion ma non riconosciuto nella risposta (${ignoti.length} candidati, sotto ${par || o.notion}): sync ferma per non creare doppioni`;
        await salva(); throw new Error(o.ferma);
      }
      x.b.nid = nuovo.id; perNid.set(nuovo.id, x);
      o.voci[nuovo.id] = { pid: x.b.id, hp: impP(x.b), hn: impN(nuovo), par, prv: after, t: nuovo.type, ...(x.b.kind === "image" ? { ro: 1 as const } : {}) };
      assegnati.push([x.b.id, nuovo.id]);
      await salva(); // SUBITO: un giro interrotto qui non deve ricreare il blocco
      scrivi(stato, descrivi(op, p) + " = " + nuovo.id);
    }

    // 4. il piano: sotto il lucchetto, sulla copia di adesso (il telefono puo' aver scritto nel frattempo)
    const tirate = ops.filter(op => op.t === "tira" || op.t === "togli" || op.t === "sposta" || op.t === "metti");
    if (tirate.length || assegnati.length) {
      await conChiave(k, async () => {
        const c = await leggiQuaderno(k); if (!c) return;
        const pc = (c.dati.pages as unknown as Pagina[]).find(z => z.id === paginaId); if (!pc) return;
        const adesso = Date.now();
        let cambiata = false;
        for (const [pid, nid] of assegnati) { const d = trova(pc.blocks, b => b.id === pid); if (d) d.list[d.i]!.nid = nid; }
        for (const op of tirate) {
          if (op.t === "tira") {
            const d = trova(pc.blocks, b => b.nid === op.nid); if (!d) continue;
            const b = d.list[d.i]!;
            if (op.seImp && impP(b) !== op.seImp) continue; // cambiato qui nel frattempo: se ne riparla al prossimo giro
            const prima = impP(b);
            for (const key of ["text", "html", "checked", "color", "emoji"]) delete (b as any)[key];
            Object.assign(b, op.contenuto, { mod: adesso });
            const v = o.voci[op.nid]; if (v) { v.hpv = prima; v.hp = impP(b); v.hn = op.hn; }
            cambiata = true; scrivi(stato, descrivi(op, pc));
          } else if (op.t === "togli") {
            const d = trova(pc.blocks, b => b.nid === op.nid); if (!d) { delete o.voci[op.nid]; continue; }
            if (op.seImp && impP(d.list[d.i]!) !== op.seImp) continue;
            const b = d.list[d.i]!;
            const via = [b, ...tutti(b.children ?? [])];
            d.list.splice(d.i, 1);
            pc.tomb = pc.tomb ?? {}; via.forEach(z => { pc.tomb![String(z.id)] = adesso; });
            delete o.voci[op.nid]; cambiata = true; scrivi(stato, descrivi(op, pc));
          } else if (op.t === "sposta") {
            const d = trova(pc.blocks, b => b.nid === op.nid); if (!d) continue;
            const n = 1 + (CONTENITORE(d.list[d.i]!.kind) ? 0 : coda(d.list, d.i));
            const pezzo = d.list.splice(d.i, n);
            const dove = posto(pc, op.par, op.prv);
            if (!dove) { d.list.splice(d.i, 0, ...pezzo); continue; }
            const delta = dove.rientro - rientro(pezzo[0]!);
            pezzo.forEach(z => { const r = rientro(z) + delta; if (r > 0) z.indent = r; else delete z.indent; });
            dove.list.splice(dove.i, 0, ...pezzo);
            const v = o.voci[op.nid]; if (v) { v.par = op.par; v.prv = op.prv; }
            cambiata = true; scrivi(stato, descrivi(op, pc));
          } else if (op.t === "metti") {
            if (trova(pc.blocks, b => b.nid === op.n.id)) continue;
            const c2 = pianoDi(op.n); if (!c2) continue;
            const dove = posto(pc, op.par, op.prv); if (!dove) continue; // il genitore non e' nel piano: al prossimo giro
            const b: BloccoP = { id: nuovoId(), ...c2, kind: String(c2.kind), nid: op.n.id, mod: adesso } as BloccoP;
            if (dove.rientro) b.indent = dove.rientro;
            if (CONTENITORE(b.kind)) b.children = [];
            dove.list.splice(dove.i, 0, b);
            o.voci[op.n.id] = { pid: b.id, hp: impP(b), hn: impN(op.n), par: op.par, prv: op.prv, t: op.n.type };
            cambiata = true; scrivi(stato, descrivi(op, pc));
          }
        }
        if (cambiata) pc.mod = adesso;
        await scriviQuaderno(k, c.dati, adesso);
      });
    }
    // le voci che hanno cambiato posto in Notion senza cambiare altro: il posto nuovo
    if (letti) for (const [nid, ln] of Array.from(letti)) { const v = o.voci[nid]; if (v && !ops.some(op => (op.t === "sposta") && op.nid === nid)) { v.par = ln.par; v.prv = ln.prv; } }
    if (serve && pg) { o.visto = pg.last_edited_time; o.scanInizio = inizio; o.scanAt = Date.now(); }
    await salva();
    delete stato.errore;
    stato.conti = { operazioni: ops.length, voci: Object.keys(o.voci).length, letti: letti?.size ?? -1, chiamate, letturaMs: durata, giroMs: Date.now() - inizio };
    if (durata >= 0) scrivi(stato, `riletta Notion: ${letti?.size} blocchi in ${Math.round(durata / 100) / 10} s, ${ops.length} operazioni`);
    await salvaStato(k, paginaId, stato);
  } catch (e: any) {
    stato.errore = String(e?.message || e);
    scrivi(stato, "ERRORE " + stato.errore);
    await salvaStato(k, paginaId, stato).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- il ciclo e le rotte
// una pagina alla volta per se', le pagine fra loro in parallelo. Prima si spinge in Notion quello che e'
// cambiato nel piano (veloce, senza rileggere Notion), poi si rilegge Notion se la pagina e' cambiata:
// cosi' una rilettura lunga non fa aspettare le modifiche fatte nell'app.
const inCorso = new Set<string>();
function unaVolta(k: string, pagina: string, fn: () => Promise<void>): Promise<void> {
  const id = k + "/" + pagina;
  if (inCorso.has(id)) return Promise.resolve();
  inCorso.add(id);
  return fn().finally(() => inCorso.delete(id));
}
async function ciclo() {
  if (!token() || (modo() !== "on" && modo() !== "prova")) return;
  try {
    await tabelle();
    const r = await rows(sql`SELECT chiave, pagina FROM focuslock_notion WHERE ombra IS NOT NULL`);
    for (const x of r) {
      const k = String(x.chiave), pg = String(x.pagina);
      void unaVolta(k, pg, async () => { await giro(k, pg, "mai"); await giro(k, pg, "se-serve"); }).catch(e => console.error("[notion-sync]", e));
    }
  } catch (e) { console.error("[notion-sync]", e); }
}

export function registerFocusLockNotionRoutes(app: Express) {
  setInterval(() => { void ciclo(); }, OGNI);

  // lo stato: modo, conti, registro delle scritture (e, in prova, quelle che farebbe)
  app.get("/api/focuslock/notion/:k/stato", async (req: Request, res: Response) => {
    const k = String(req.params.k || "");
    if (!CHIAVE.test(k)) { res.status(400).json({ error: "chiave non valida" }); return; }
    try {
      await tabelle();
      const r = await rows(sql`SELECT pagina, ombra, stato, updatedAt FROM focuslock_notion WHERE chiave = ${k}`);
      res.json({
        modo: modo() || "fermo", token: !!token(), chiamate,
        pagine: r.map((x: any) => {
          let o: Ombra | null = null; try { o = x.ombra ? JSON.parse(String(x.ombra)) : null; } catch { o = null; }
          let s: Stato | null = null; try { s = x.stato ? JSON.parse(String(x.stato)) : null; } catch { s = null; }
          return { pagina: x.pagina, notion: o?.notion, agganciati: o ? Object.keys(o.voci).length : 0, fuoriPiano: o?.fuori.length ?? 0, fuoriNotion: o?.x.length ?? 0, visto: o?.visto, stato: s };
        }),
      });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // l'aggancio di una pagina del piano a una pagina di Notion (una volta sola; rifarlo riparte da zero)
  app.post("/api/focuslock/notion/:k/aggancia", async (req: Request, res: Response) => {
    const k = String(req.params.k || "");
    const pagina = String(req.body?.pagina || ""), notion = String(req.body?.notion || "");
    if (!CHIAVE.test(k) || !pagina || !UUID.test(notion)) { res.status(400).json({ error: "servono chiave, pagina e notion" }); return; }
    try {
      await tabelle();
      const stato = (await leggiRiga(k, pagina))?.stato ?? { giri: 0, registro: [] };
      const conti = await aggancia(k, pagina, trattini(notion), stato);
      await salvaStato(k, pagina, stato);
      res.json({ ok: true, conti });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // un giro subito (per le prove), anche fuori dal ciclo
  app.post("/api/focuslock/notion/:k/giro", async (req: Request, res: Response) => {
    const k = String(req.params.k || "");
    const pagina = String(req.body?.pagina || "");
    if (!CHIAVE.test(k) || !pagina) { res.status(400).json({ error: "servono chiave e pagina" }); return; }
    if (modo() !== "on" && modo() !== "prova") { res.status(409).json({ error: "NOTION_SYNC non e' acceso" }); return; }
    try { await tabelle(); await unaVolta(k, pagina, () => giro(k, pagina, "sempre")); res.json({ ok: true, stato: (await leggiRiga(k, pagina))?.stato }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // staccare una pagina: niente piu' sync (i nid restano nel piano)
  app.post("/api/focuslock/notion/:k/stacca", async (req: Request, res: Response) => {
    const k = String(req.params.k || ""); const pagina = String(req.body?.pagina || "");
    if (!CHIAVE.test(k) || !pagina) { res.status(400).json({ error: "servono chiave e pagina" }); return; }
    try { await tabelle(); await rows(sql`DELETE FROM focuslock_notion WHERE chiave = ${k} AND pagina = ${pagina}`); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
}
