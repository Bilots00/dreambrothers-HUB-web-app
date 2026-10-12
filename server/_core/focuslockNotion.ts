import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { rows } from "./focuslockRoutes";
import { conChiave, leggiQuaderno, pianoTabelle, scriviQuaderno } from "./focuslockPiano";
import {
  CONTENITORE, SINCRONIZZABILE, classeN, classeP, htmlDi, impN, impP, kindDi, normale, notionDi, pianoDi, struttura, testoDi,
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
const OGNI = 10_000;
const SCANSIONE_COMUNQUE = 5 * 60_000; // anche senza segnali, una rilettura completa ogni 5 minuti
const modo = () => (process.env.NOTION_SYNC || "").trim().toLowerCase();
const token = () => (process.env.NOTION_TOKEN || "").trim();
const CHIAVE = /^[A-Za-z0-9_-]{32,64}$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const trattini = (id: string) => { const x = id.replace(/-/g, "").toLowerCase(); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };

// ---------------------------------------------------------------- l'API di Notion, con il freno
// Notion dichiara ~3 chiamate al secondo «in media, con picchi ammessi»: misurato il 12/10/2026,
// 60 letture con 6 in parallelo = 15,8 al secondo senza un solo 429. Si parte una chiamata ogni
// 70 ms, al massimo 12 in volo; al primo 429 TUTTE le chiamate si fermano per il tempo che dice Notion.
let ultima = 0, inVolo = 0, fermiFino = 0;
let chiamate = 0, msInRete = 0, attesaTurno = 0;
let botId = "";
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms));
async function turno() {
  for (;;) {
    const ora = Date.now();
    if (ora < fermiFino) { await pausa(fermiFino - ora); continue; }
    if (inVolo >= 12) { await pausa(30); continue; }
    const attesa = ultima + 70 - ora;
    if (attesa > 0) { await pausa(attesa); continue; }
    ultima = ora; inVolo++; return;
  }
}
async function api(method: string, path: string, body?: unknown): Promise<any> {
  if (!token()) throw new Error("manca NOTION_TOKEN");
  for (let tentativo = 0; ; tentativo++) {
    const t0 = Date.now();
    await turno();
    const t1 = Date.now(); attesaTurno += t1 - t0;
    chiamate++;
    let r: globalThis.Response;
    try {
      r = await fetch("https://api.notion.com/v1" + path, {
        method, headers: { Authorization: "Bearer " + token(), "Notion-Version": NV, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } finally { inVolo--; msInRete += Date.now() - t1; }
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
async function figli(id: string, aOgniPagina?: (nb: BloccoN[]) => void): Promise<BloccoN[]> {
  const out: BloccoN[] = [];
  let cur: string | undefined;
  do {
    const j = await api("GET", `/blocks/${id}/children?page_size=100${cur ? "&start_cursor=" + encodeURIComponent(cur) : ""}`);
    const nb: BloccoN[] = j.results ?? [];
    out.push(...nb);
    aOgniPagina?.(nb); // chi legge l'albero scende nei rami di questa pagina mentre arriva la prossima
    cur = j.has_more ? j.next_cursor : undefined;
  } while (cur);
  return out;
}
// dentro questi non si scende mai: il piano li tiene interi (HTML) o non li ha
const NON_SCENDERE = new Set(["child_page", "child_database", "column_list", "column", "table", "synced_block", "link_to_page", "unsupported", "template"]);

// ---------------------------------------------------------------- l'ombra
type Voce = { pid: number; hp: string; hn: string; hpv?: string; par: string; prv: string | null; ro?: 1; t?: string; w?: number };
type Ombra = {
  notion: string; at: number; visto: string; scanInizio: number; scanAt: number;
  voci: Record<string, Voce>; x: string[]; fuori: number[];
  via?: Record<string, number>; // i blocchi che il job ha cancellato in Notion (10 minuti): una lettura cominciata prima li vede ancora
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

// Dove il job legge e scrive (il database e il quaderno del piano). Le prove (focuslockNotion.test.ts)
// lo sostituiscono con uno in memoria, insieme a un Notion finto.
type Deposito = {
  leggiRiga: typeof leggiRiga; salvaOmbra: typeof salvaOmbra; salvaStato: typeof salvaStato;
  leggiQuaderno: typeof leggiQuaderno; scriviQuaderno: typeof scriviQuaderno; conChiave: typeof conChiave;
};
let dep: Deposito = { leggiRiga, salvaOmbra, salvaStato, leggiQuaderno, scriviQuaderno, conChiave };

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
    return null; // il fratello prima non e' (ancora) qui: meglio aspettare il prossimo giro che mettere il blocco in cima
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
  const q = await dep.leggiQuaderno(k); if (!q) throw new Error("quaderno vuoto");
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
  await dep.salvaOmbra(k, paginaId, ombra);
  // i nid nel piano (sotto il lucchetto, sulla copia di adesso)
  await dep.conChiave(k, async () => {
    const c = await dep.leggiQuaderno(k); if (!c) return;
    const pc = (c.dati.pages as unknown as Pagina[]).find(z => z.id === paginaId); if (!pc) return;
    tutti(pc.blocks).forEach(b => { const n = legati.get(b.id); if (n) b.nid = n; });
    pc.notion = notionId; pc.notionAt = ombra.at;
    await dep.scriviQuaderno(k, c.dati, Date.now());
  });
  const conti = { lettiNotion: lette, agganciati: legati.size, soloLettura: Object.values(voci).filter(v => v.ro).length, fuoriPiano: fuori.length, fuoriNotion: x.length, chiamate };
  scrivi(stato, `aggancio a ${notionId}: ${JSON.stringify(conti)}`);
  return conti;
}

// ---------------------------------------------------------------- un giro
type LettoN = { n: BloccoN; par: string; prv: string | null };
async function scansiona(o: Ombra): Promise<{ letti: Map<string, LettoN>; nuoviX: string[]; liste: Map<string, string[]> }> {
  const letti = new Map<string, LettoN>(); const nuoviX: string[] = []; const xs = new Set(o.x);
  const liste = new Map<string, string[]>(); // per ogni genitore, i figli letti in ordine
  // i rami si leggono in parallelo, e si comincia a scendere appena arriva ogni pagina di 100 figli
  // (il freno sui 429 sta in api)
  const giro = async (id: string, parKey: string, padreFuori: boolean): Promise<void> => {
    let prv: string | null = null;
    const giu: Promise<void>[] = [];
    await figli(id, nb => {
      for (const n of nb) {
        if (xs.has(n.id)) continue;
        const v = o.voci[n.id];
        if (!v && (padreFuori || !kindDi(n))) { nuoviX.push(n.id); continue; } // nuovo e non sincronizzabile: fuori, per sempre
        letti.set(n.id, { n, par: parKey, prv }); prv = n.id;
        const l = liste.get(parKey) ?? []; l.push(n.id); liste.set(parKey, l);
        if (n.has_children && !v?.ro && !NON_SCENDERE.has(n.type)) giu.push(giro(n.id, n.id, false));
      }
    });
    await Promise.all(giu);
  };
  await giro(o.notion, "", false);
  return { letti, nuoviX, liste };
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

// Una lettura di Notion fatta SENZA lucchetto (dura decine di secondi), da applicare dopo, sotto il lucchetto.
type Letta = { letti: Map<string, LettoN>; nuoviX: string[]; liste: Map<string, string[]>; inizio: number; visto: string; durata: number };
async function giro(k: string, paginaId: string, letta: Letta | null): Promise<void> {
  const riga = await dep.leggiRiga(k, paginaId); if (!riga?.ombra) return;
  const o = riga.ombra, stato = riga.stato;
  if (o.ferma) return;
  const prova = modo() === "prova";
  stato.giri++; stato.ultimo = Date.now();
  try {
    // 1. Notion, com'era nella lettura (se c'e'). I blocchi che il job ha scritto in Notion DOPO l'inizio
    //    di quella lettura non si guardano: la lettura li ha visti com'erano prima, e li riporterebbe indietro
    const inizio = Date.now();
    const durata = letta ? letta.durata : -1;
    if (o.via) for (const [n, t] of Object.entries(o.via)) if (inizio - t > 10 * 60_000) delete o.via[n];
    let letti: Map<string, LettoN> | null = null;
    const nonCreduti = new Set<string>();
    if (letta) {
      letti = letta.letti;
      Object.entries(o.voci).forEach(([nid, v]) => { if (v.w && v.w >= letta.inizio) nonCreduti.add(nid); });
      if (!prova && letta.nuoviX.length) { const xs = new Set(o.x); o.x.push(...letta.nuoviX.filter(id => !xs.has(id) && !o.voci[id])); }
    }

    // 2. il piano, adesso
    const q = await dep.leggiQuaderno(k); if (!q) throw new Error("quaderno vuoto");
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

    // il fratello prima in Notion, contando solo i blocchi che l'ombra conosce (come fa prvP nel piano)
    const prvNoto = (nid: string, par: string): string | null => {
      const l = letta?.liste.get(par); if (!l) return null;
      for (let i = l.indexOf(nid) - 1; i >= 0; i--) if (o.voci[l[i]!]) return l[i]!;
      return null;
    };
    const ordineOmbra = (par: string): string[] => {
      const dopo = new Map<string | null, string[]>();
      Object.entries(o.voci).forEach(([n, v]) => { if (v.par === par) { const l = dopo.get(v.prv) ?? []; l.push(n); dopo.set(v.prv, l); } });
      const out: string[] = []; const visti = new Set<string>();
      const giu = (prv: string | null) => { for (const n of dopo.get(prv) ?? []) if (!visti.has(n)) { visti.add(n); out.push(n); giu(n); } };
      giu(null);
      Object.entries(o.voci).forEach(([n, v]) => { if (v.par === par && !visti.has(n)) out.push(n); }); // catena rotta: in fondo
      return out;
    };
    const mossi = (liste: Map<string, string[]>): Set<string> => {
      const out = new Set<string>();
      liste.forEach((l, par) => {
        const qui = new Set(l);
        const vecchia = ordineOmbra(par).filter(n => qui.has(n));
        const fermi = new Set(allinea(vecchia, l).map(([i]) => vecchia[i]!));
        l.forEach(n => { if (o.voci[n]!.par !== par || !fermi.has(n)) out.add(n); });
      });
      return out;
    };
    const listePiano = new Map<string, string[]>();
    posti.forEach(x => { const n = x.b.nid; if (!n || !o.voci[n]) return; const par = parP(x); if (par === "?") return; const l = listePiano.get(par) ?? []; l.push(n); listePiano.set(par, l); });
    const movP = mossi(listePiano);
    const listeNotion = new Map<string, string[]>();
    letta?.liste.forEach((l, par) => listeNotion.set(par, l.filter(n => o.voci[n] && !nonCreduti.has(n))));
    const movN = mossi(listeNotion);
    const ops: Op[] = [];
    const daRifare = new Set<string>(); // cancellati in Notion per essere ricreati (spostati, cambiati di tipo)
    let spostatiQui = 0; // spostamenti decisi nel piano (i figli che li seguono non contano)
    for (const [nid, v] of Object.entries(o.voci)) {
      const x = perNid.get(nid); const pb = x?.b;
      const creduto = !!letti && !nonCreduti.has(nid);
      const ln = creduto ? letti!.get(nid) : undefined; const nb = ln?.n;
      const nVia = creduto && !ln;
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
      const nMov = !!ln && movN.has(nid);
      const pMov = movP.has(nid);
      if (nMov) ops.push({ t: "sposta", nid, par: ln!.par, prv: prvNoto(nid, ln!.par) });
      else if (pMov) { daRifare.add(nid); spostatiQui++; }
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
    if (letti) for (const [nid, ln] of Array.from(letti)) if (!o.voci[nid] && !o.x.includes(nid) && !o.via?.[nid] && !ops.some(op => op.t === "metti" && op.n.id === nid)) ops.push({ t: "metti", n: ln.n, par: ln.par, prv: ln.prv });

    const conta = (t: Op["t"]) => ops.filter(op => op.t === t).length;
    const troppo = spostatiQui > 5 ? `${spostatiQui} spostamenti da portare in Notion` : conta("via") > 100 ? `${conta("via")} cancellazioni in Notion` : conta("sposta") > 20 ? `${conta("sposta")} spostamenti nel piano` : conta("togli") > 100 ? `${conta("togli")} righe da togliere dal piano` : "";
    if (troppo && !prova) {
      o.ferma = `un giro voleva fare ${troppo}: sync ferma per sicurezza, serve un'occhiata (registro e «prova»)`;
      stato.prova = ops.slice(0, 400).map(op => descrivi(op, p));
      stato.errore = o.ferma; scrivi(stato, "FERMA " + o.ferma);
      await dep.salvaOmbra(k, paginaId, o); await dep.salvaStato(k, paginaId, stato);
      return;
    }
    if (prova) {
      stato.prova = ops.slice(0, 400).map(op => descrivi(op, p));
      stato.conti = { operazioni: ops.length, voci: Object.keys(o.voci).length, letti: letti?.size ?? -1, chiamate };
      if (ops.length) scrivi(stato, `prova: ${ops.length} operazioni (vedi «prova»)`);
      delete stato.errore;
      await dep.salvaStato(k, paginaId, stato);
      return;
    }

    // 3. Notion: cancellazioni, aggiornamenti, creazioni (in ordine di pagina)
    const salva = () => dep.salvaOmbra(k, paginaId, o);
    for (const op of ops) {
      if (op.t === "via") {
        try { await api("DELETE", `/blocks/${op.nid}`); } catch (e: any) { if (e.status !== 404 && !/archived/i.test(e.message)) throw e; }
        (o.via = o.via ?? {})[op.nid] = Date.now();
        const tolta = o.voci[op.nid];
        if (tolta) Object.values(o.voci).forEach(v => { if (v.par === tolta.par && v.prv === op.nid) v.prv = tolta.prv; });
        delete o.voci[op.nid]; scrivi(stato, descrivi(op, p)); await salva();
      } else if (op.t === "agg") {
        const r = await api("PATCH", `/blocks/${op.nid}`, { [op.tipo]: op.body });
        const v = o.voci[op.nid]!; v.hp = op.hp; v.hn = impN(r); v.w = Date.now(); delete v.hpv; scrivi(stato, descrivi(op, p));
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
      // il nuovo e' il PRIMO dei risultati: Notion restituisce il blocco creato e poi i fratelli che lo
      // seguono, 100 alla volta (provato il 12/10/2026 con position, after e start). Si controlla che sia
      // davvero sconosciuto e del tipo giusto; se no ci si ferma.
      const primo: BloccoN | undefined = r.results?.[0];
      const xs = new Set(o.x);
      const nuovo: BloccoN | undefined = primo && primo.type === corpo.type && !o.voci[primo.id] && !xs.has(primo.id) && !perNid.has(primo.id) ? primo : undefined;
      if (!nuovo) {
        o.ferma = `creato un blocco in Notion ma la risposta non lo mostra per primo (sotto ${par || o.notion}): sync ferma per non creare doppioni`;
        await salva(); throw new Error(o.ferma);
      }
      x.b.nid = nuovo.id; perNid.set(nuovo.id, x);
      Object.values(o.voci).forEach(v => { if (v.par === par && v.prv === after) v.prv = nuovo.id; });
      o.voci[nuovo.id] = { pid: x.b.id, hp: impP(x.b), hn: impN(nuovo), par, prv: after, t: nuovo.type, w: Date.now(), ...(x.b.kind === "image" ? { ro: 1 as const } : {}) };
      assegnati.push([x.b.id, nuovo.id]);
      await salva(); // SUBITO: un giro interrotto qui non deve ricreare il blocco
      scrivi(stato, descrivi(op, p) + " = " + nuovo.id);
    }

    // 4. il piano: sotto il lucchetto, sulla copia di adesso (il telefono puo' aver scritto nel frattempo)
    const tirate = ops.filter(op => op.t === "tira" || op.t === "togli" || op.t === "sposta" || op.t === "metti");
    if (tirate.length || assegnati.length) {
      await dep.conChiave(k, async () => {
        const c = await dep.leggiQuaderno(k); if (!c) return;
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
        await dep.scriviQuaderno(k, c.dati, adesso);
      });
    }
    // le voci che hanno cambiato posto in Notion senza cambiare altro: il posto nuovo
    if (letti) for (const [nid, ln] of Array.from(letti)) { const v = o.voci[nid]; if (v && !nonCreduti.has(nid)) { v.par = ln.par; v.prv = prvNoto(nid, ln.par); } }
    if (letta) { o.visto = letta.visto; o.scanInizio = letta.inizio; o.scanAt = Date.now(); }
    await salva();
    delete stato.errore;
    stato.conti = { operazioni: ops.length, voci: Object.keys(o.voci).length, letti: letti?.size ?? -1, chiamate, letturaMs: durata, giroMs: Date.now() - inizio, latenzaMediaMs: chiamate ? Math.round(msInRete / chiamate) : 0, turnoMedioMs: chiamate ? Math.round(attesaTurno / chiamate) : 0 };
    if (durata >= 0) scrivi(stato, `riletta Notion: ${letti?.size} blocchi in ${Math.round(durata / 100) / 10} s, ${ops.length} operazioni`);
    await dep.salvaStato(k, paginaId, stato);
  } catch (e: any) {
    stato.errore = String(e?.message || e);
    scrivi(stato, "ERRORE " + stato.errore);
    await dep.salvaStato(k, paginaId, stato).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- i doppioni della To do list (una volta sola)
// La vecchia sync del telefono (foglio-sync.js) ha riempito la «To do list» di Notion con ~59.000 righe doppie
// (50.000 nel toggle «IMPORTANTE»). Andrea ha detto di cancellarle (12/10/2026). Regola = quella dell'import
// del piano (converti_html.py, senza_doppioni): nella STESSA lista, una casella / un punto / un numero con lo
// stesso tipo, testo e formattazione di uno di prima e' un doppione, e va via con i suoi figli. Le cancellate
// finiscono nel cestino di Notion (30 giorni). Gira sul server, riprende da sola dopo un riavvio (rilegge e
// cancella quello che resta), e parte davvero solo se il numero trovato e' quello atteso (± 1%).
const DOPPI = new Set(["to_do", "bulleted_list_item", "numbered_list_item"]);
type Pulizia = { notion: string; fase: "prova" | "cancello" | "fatto" | "errore"; atteso?: number; letti: number; trovati: number; cancellati: number; esempi: string[]; inizio: number; fine?: number; errore?: string };
async function trovaDoppioni(notionId: string): Promise<{ via: string[]; letti: number; esempi: string[] }> {
  const via: string[] = []; const esempi: string[] = []; let letti = 0;
  const giro = async (id: string): Promise<void> => {
    const visti = new Set<string>(); const giu: Promise<void>[] = [];
    await figli(id, nb => {
      letti += nb.length;
      for (const n of nb) {
        if (DOPPI.has(n.type)) {
          const rt = n[n.type]?.rich_text ?? [];
          const k = n.type + "|" + testoDi(rt).trim() + "|" + (htmlDi(rt) ?? "");
          if (visti.has(k)) { via.push(n.id); if (esempi.length < 15 && !esempi.includes(k)) esempi.push(k.slice(0, 90)); continue; } // non si scende: va via con i figli
          visti.add(k);
        }
        if (n.has_children && !NON_SCENDERE.has(n.type)) giu.push(giro(n.id));
      }
    });
    await Promise.all(giu);
  };
  await giro(notionId);
  return { via, letti, esempi };
}
const pulizieInCorso = new Set<string>();
async function pulisci(k: string, notionId: string, prova: boolean, atteso?: number): Promise<void> {
  const riga = "_doppioni:" + notionId;
  if (pulizieInCorso.has(riga)) return;
  pulizieInCorso.add(riga);
  const stato: Stato = (await dep.leggiRiga(k, riga))?.stato ?? { giri: 0, registro: [] };
  const p: Pulizia = { notion: notionId, fase: prova ? "prova" : "cancello", atteso, letti: 0, trovati: 0, cancellati: 0, esempi: [], inizio: Date.now() };
  const salva = async () => { (stato as any).pulizia = p; await dep.salvaStato(k, riga, stato); };
  try {
    await salva();
    const t = await trovaDoppioni(notionId);
    p.letti = t.letti; p.trovati = t.via.length; p.esempi = t.esempi;
    scrivi(stato, `doppioni: letti ${t.letti} blocchi, ${t.via.length} da cancellare`);
    if (prova) { p.fine = Date.now(); await salva(); return; }
    if (!atteso || Math.abs(t.via.length - atteso) > Math.max(5, atteso * 0.01)) {
      // dopo un riavvio ne restano meno: va bene se sono MENO di quelli attesi all'inizio
      if (!(atteso && t.via.length < atteso)) throw new Error(`trovati ${t.via.length} doppioni, attesi ${atteso}: non cancello niente`);
    }
    await salva();
    let i = 0;
    const lavora = async () => {
      while (i < t.via.length) {
        const id = t.via[i++]!;
        try { await api("DELETE", `/blocks/${id}`); } catch (e: any) { if (e.status !== 404 && !/archived|trash/i.test(e.message)) throw e; }
        p.cancellati++;
        if (p.cancellati % 250 === 0) await salva();
      }
    };
    await Promise.all([lavora(), lavora(), lavora()]);
    p.fase = "fatto"; p.fine = Date.now();
    scrivi(stato, `doppioni: cancellati ${p.cancellati}`);
    await salva();
  } catch (e: any) {
    p.fase = "errore"; p.errore = String(e?.message || e); scrivi(stato, "ERRORE doppioni: " + p.errore);
    await salva().catch(() => undefined);
  } finally { pulizieInCorso.delete(riga); }
}

// ---------------------------------------------------------------- il ciclo e le rotte
// Per ogni pagina due strade:
//   - la SPINTA (ogni 10 s): quello che e' cambiato nel piano va in Notion. Veloce, sotto il lucchetto.
//   - la LETTURA: se la pagina di Notion e' cambiata, si rilegge tutto l'albero SENZA lucchetto (decine di
//     secondi), poi il confronto si fa sotto il lucchetto. Cosi' una rilettura lunga non fa aspettare le
//     modifiche fatte nell'app. L'ombra si tocca solo sotto il lucchetto: due giri insieme sulla stessa
//     ombra perderebbero le voci dei blocchi appena creati, e al giro dopo li creerebbero di nuovo.
const lucchetti = new Map<string, Promise<unknown>>();
function conLucchetto<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prima = lucchetti.get(id) ?? Promise.resolve();
  const qui = prima.catch(() => undefined).then(fn);
  lucchetti.set(id, qui);
  void qui.catch(() => undefined).then(() => { if (lucchetti.get(id) === qui) lucchetti.delete(id); });
  return qui;
}
const spinte = new Set<string>(), letture = new Set<string>();
function unaVolta(insieme: Set<string>, id: string, fn: () => Promise<void>): Promise<void> {
  if (insieme.has(id)) return Promise.resolve();
  insieme.add(id);
  return fn().finally(() => insieme.delete(id));
}
async function leggiSeServe(k: string, pagina: string, sempre = false): Promise<void> {
  const id = k + "/" + pagina;
  const riga = await dep.leggiRiga(k, pagina); const o = riga?.ombra; if (!o || o.ferma) return;
  const pg = await api("GET", `/pages/${o.notion}`);
  // l'ultima modifica della pagina l'ha fatta il job stesso (l'integrazione): niente rilettura, che costa
  // ~300 chiamate di una quota di ~3 al secondo. Una modifica di Andrea nello stesso minuto, prima della
  // nostra, la prende la rilettura di sicurezza (SCANSIONE_COMUNQUE)
  if (!botId) botId = (await api("GET", "/users/me").catch(() => null))?.id ?? "";
  const nostra = !!botId && pg.last_edited_by?.id === botId;
  // l'ora di Notion va al minuto: se il minuto di quell'ora non era finito quando e' cominciata l'ultima
  // lettura, si rilegge ancora (una modifica nello stesso minuto non cambierebbe l'ora)
  const serve = sempre || Date.now() - o.scanAt > SCANSIONE_COMUNQUE || (!nostra && (pg.last_edited_time !== o.visto || Date.parse(pg.last_edited_time) + 60_000 > o.scanInizio));
  if (!serve) return;
  const inizio = Date.now();
  let s: Awaited<ReturnType<typeof scansiona>>;
  try { s = await scansiona(o); }
  catch (e: any) {
    await conLucchetto(id, async () => { const r = await dep.leggiRiga(k, pagina); if (r) { r.stato.errore = "lettura di Notion: " + String(e?.message || e); scrivi(r.stato, "ERRORE " + r.stato.errore); await dep.salvaStato(k, pagina, r.stato); } });
    return;
  }
  const letta: Letta = { letti: s.letti, nuoviX: s.nuoviX, liste: s.liste, inizio, visto: pg.last_edited_time, durata: Date.now() - inizio };
  await conLucchetto(id, () => giro(k, pagina, letta));
}
async function ciclo() {
  if (!token() || (modo() !== "on" && modo() !== "prova")) return;
  try {
    await tabelle();
    // una pulizia dei doppioni interrotta da un riavvio riparte da sola
    const pz = await rows(sql`SELECT chiave, pagina, stato FROM focuslock_notion WHERE pagina LIKE '_doppioni:%'`);
    for (const x of pz) {
      let pu: Pulizia | undefined; try { pu = JSON.parse(String(x.stato)).pulizia; } catch { pu = undefined; }
      if (pu?.fase === "cancello" && !pulizieInCorso.has(String(x.pagina))) void pulisci(String(x.chiave), pu.notion, false, pu.atteso);
    }
    const r = await rows(sql`SELECT chiave, pagina FROM focuslock_notion WHERE ombra IS NOT NULL`);
    for (const x of r) {
      const k = String(x.chiave), pg = String(x.pagina), id = k + "/" + pg;
      void unaVolta(spinte, id, () => conLucchetto(id, () => giro(k, pg, null))).catch(e => console.error("[notion-sync]", e));
      void unaVolta(letture, id, () => leggiSeServe(k, pg)).catch(e => console.error("[notion-sync]", e));
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
          if (String(x.pagina).startsWith("_doppioni:")) return { pagina: x.pagina, pulizia: (s as any)?.pulizia, registro: s?.registro?.slice(-10) };
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
      const stato = (await dep.leggiRiga(k, pagina))?.stato ?? { giri: 0, registro: [] };
      const conti = await conLucchetto(k + "/" + pagina, () => aggancia(k, pagina, trattini(notion), stato));
      await dep.salvaStato(k, pagina, stato);
      res.json({ ok: true, conti });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // un giro subito (per le prove), anche fuori dal ciclo
  app.post("/api/focuslock/notion/:k/giro", async (req: Request, res: Response) => {
    const k = String(req.params.k || "");
    const pagina = String(req.body?.pagina || "");
    if (!CHIAVE.test(k) || !pagina) { res.status(400).json({ error: "servono chiave e pagina" }); return; }
    if (modo() !== "on" && modo() !== "prova") { res.status(409).json({ error: "NOTION_SYNC non e' acceso" }); return; }
    try { await tabelle(); await unaVolta(letture, k + "/" + pagina, () => leggiSeServe(k, pagina, true)); res.json({ ok: true, stato: (await dep.leggiRiga(k, pagina))?.stato }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // i doppioni di una pagina: {notion, prova: true} conta e mostra esempi; {notion, atteso} cancella davvero
  app.post("/api/focuslock/notion/:k/doppioni", async (req: Request, res: Response) => {
    const k = String(req.params.k || ""); const notion = String(req.body?.notion || "");
    if (!CHIAVE.test(k) || !UUID.test(notion)) { res.status(400).json({ error: "servono chiave e notion" }); return; }
    const prova = req.body?.prova !== false; const atteso = Number(req.body?.atteso) || undefined;
    if (!prova && !atteso) { res.status(400).json({ error: "per cancellare serve il numero atteso (dalla prova)" }); return; }
    try { await tabelle(); void pulisci(k, trattini(notion), prova, atteso); res.json({ ok: true, partita: true, stato: `/api/focuslock/notion/${k}/stato` }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  // staccare una pagina: niente piu' sync (i nid restano nel piano)
  app.post("/api/focuslock/notion/:k/stacca", async (req: Request, res: Response) => {
    const k = String(req.params.k || ""); const pagina = String(req.body?.pagina || "");
    if (!CHIAVE.test(k) || !pagina) { res.status(400).json({ error: "servono chiave e pagina" }); return; }
    try { await tabelle(); await conLucchetto(k + "/" + pagina, () => rows(sql`DELETE FROM focuslock_notion WHERE chiave = ${k} AND pagina = ${pagina}`)); res.json({ ok: true }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
}

// solo per le prove: deposito in memoria e accesso alle funzioni del giro
export const __prova = { usa: (d: Deposito) => { dep = d; }, giro, aggancia, leggiSeServe, conLucchetto };
