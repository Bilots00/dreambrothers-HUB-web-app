import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// il job senza database e senza rete: deposito in memoria e un Notion finto (sotto)
vi.mock("./focuslockRoutes", () => ({ rows: async () => [] }));
vi.mock("./focuslockPiano", () => ({ conChiave: async (_k: string, fn: () => Promise<unknown>) => fn(), leggiQuaderno: async () => null, scriviQuaderno: async () => undefined, pianoTabelle: async () => undefined }));

import { __prova } from "./focuslockNotion";
import { struttura, type BloccoP } from "./notionBlocchi";
import { timbra, unisciQuaderni, type QuadernoU } from "./pianoUnione";

// ---------------------------------------------------------------- Notion finto
type NB = { id: string; type: string; testo: string; checked?: boolean; parent: string; figli: string[]; t: number; via?: boolean };
class Finto {
  b = new Map<string, NB>();
  pagina = { id: "pagina-0000-0000-0000-000000000000", figli: [] as string[], t: Date.now() };
  n = 0;
  ultimoDa = "andrea"; // chi ha fatto l'ultima modifica: le chiamate del job sono «bot»
  nuovoId() { this.n++; return `00000000-0000-0000-0000-${String(this.n).padStart(12, "0")}`; }
  lista(par: string) { return par === this.pagina.id ? this.pagina.figli : this.b.get(par)!.figli; }
  tocca(id: string) { this.ultimoDa = "andrea"; const t = Date.now(); let x = this.b.get(id); while (x) { x.t = t; x = this.b.get(x.parent); } this.pagina.t = t; }
  crea(par: string, type: string, testo: string, dopo: string | null | "fine" = "fine", checked?: boolean): string {
    const id = this.nuovoId();
    this.b.set(id, { id, type, testo, checked, parent: par, figli: [], t: Date.now() });
    const l = this.lista(par);
    if (dopo === "fine") l.push(id); else if (dopo === null) l.unshift(id); else l.splice(l.indexOf(dopo) + 1, 0, id);
    this.tocca(id);
    return id;
  }
  cancella(id: string) { const x = this.b.get(id)!; x.via = true; const l = this.lista(x.parent); l.splice(l.indexOf(id), 1); this.tocca(x.parent === this.pagina.id ? id : x.parent); }
  json(x: NB) {
    const rt = x.type === "divider" ? undefined : [{ type: "text", plain_text: x.testo, text: { content: x.testo, link: null }, href: null, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" } }];
    const corpo: any = x.type === "divider" ? {} : { rich_text: rt, color: "default" };
    if (x.type === "to_do") corpo.checked = !!x.checked;
    return { object: "block", id: x.id, type: x.type, has_children: x.figli.length > 0, in_trash: !!x.via, archived: !!x.via, last_edited_time: new Date(Math.floor(x.t / 60000) * 60000).toISOString(), parent: x.parent === this.pagina.id ? { type: "page_id", page_id: x.parent } : { type: "block_id", block_id: x.parent }, [x.type]: corpo };
  }
  albero(par = this.pagina.id, d = 0): string[] { return this.lista(par).flatMap(id => [`${d}:${this.b.get(id)!.testo}`, ...this.albero(id, d + 1)]); }
  async fetch(url: string, init: any): Promise<Response> {
    const r = await this.risposta(url, init);
    if ((init?.method ?? "GET") !== "GET") this.ultimoDa = "bot"; // le scritture del job
    return r;
  }
  async risposta(url: string, init: any): Promise<Response> {
    const u = new URL(url); const m = init?.method ?? "GET"; const body = init?.body ? JSON.parse(init.body) : null;
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    let r: RegExpExecArray | null;
    if (u.pathname === "/v1/users/me") return ok({ id: "bot" });
    if ((r = /\/v1\/pages\/([^/]+)$/.exec(u.pathname))) return ok({ id: r[1], last_edited_by: { id: this.ultimoDa }, last_edited_time: new Date(Math.floor(this.pagina.t / 60000) * 60000).toISOString() });
    if ((r = /\/v1\/blocks\/([^/]+)\/children$/.exec(u.pathname))) {
      const par = r[1]!;
      if (m === "GET") {
        const l = this.lista(par); const da = Number(u.searchParams.get("start_cursor") || 0);
        const pezzo = l.slice(da, da + 100);
        return ok({ results: pezzo.map(id => this.json(this.b.get(id)!)), has_more: da + 100 < l.length, next_cursor: da + 100 < l.length ? String(da + 100) : null });
      }
      const c = body.children[0]; const pos = body.position;
      const dopo = pos?.type === "after_block" ? pos.after_block.id : pos?.type === "start" ? null : body.after ?? "fine";
      const id = this.crea(par, c.type, (c[c.type].rich_text ?? []).map((x: any) => x.text.content).join(""), dopo, c[c.type].checked);
      const l = this.lista(par); const i = l.indexOf(id);
      return ok({ results: l.slice(i, i + 100).map(z => this.json(this.b.get(z)!)) });
    }
    if ((r = /\/v1\/blocks\/([^/]+)$/.exec(u.pathname))) {
      const x = this.b.get(r[1]!); if (!x) return new Response("{}", { status: 404 });
      if (m === "DELETE") { this.cancella(x.id); return ok(this.json(x)); }
      if (m === "PATCH") { const c = body[x.type]; x.testo = (c.rich_text ?? []).map((z: any) => z.text.content).join(""); if ("checked" in c) x.checked = c.checked; this.tocca(x.id); }
      return ok(this.json(x));
    }
    return new Response("{}", { status: 404 });
  }
}

// ---------------------------------------------------------------- il piano finto (come il telefono)
const K = "chiave-di-prova-chiave-di-prova-0001";
let notion: Finto;
let quaderno: QuadernoU;
const righe = new Map<string, any>();
let uid = 1000;
const P = () => quaderno.pages[0] as any;
/** Una modifica fatta «nell'app»: si timbra come fa workspace.tsx e si manda al server, che unisce. */
function app(fn: (blocks: BloccoP[]) => BloccoP[], vecchia = false) {
  const qui = JSON.parse(JSON.stringify(quaderno));
  const p = qui.pages[0]; const t = Date.now();
  const r = timbra(p.blocks, fn(JSON.parse(JSON.stringify(p.blocks))), p.tomb, t);
  p.blocks = r.blocks; p.tomb = r.tomb; p.mod = t;
  if (vecchia) { delete qui.uv; }
  quaderno = unisciQuaderni(qui, quaderno);
}
function pianoAlbero(): string[] {
  const posti = struttura(P().blocks);
  const figli = new Map<number | null, BloccoP[]>();
  posti.forEach(x => { const l = figli.get(x.padre) ?? []; l.push(x.b); figli.set(x.padre, l); });
  const giu = (p: number | null, d: number): string[] => (figli.get(p) ?? []).flatMap(b => [`${d}:${b.text}`, ...giu(b.id, d + 1)]);
  return giu(null, 0);
}
const b = (kind: string, text: string, x: Partial<BloccoP> = {}): BloccoP => ({ id: ++uid, kind, text, ...x });
async function convergi() {
  for (let i = 0; i < 4; i++) {
    await __prova.giro(K, "pg", null);
    await __prova.leggiSeServe(K, "pg", true);
  }
}
const registro = () => (righe.get("pg")?.stato?.registro ?? []) as string[];

beforeEach(() => {
  process.env.NOTION_TOKEN = "finto"; process.env.NOTION_SYNC = "on";
  notion = new Finto();
  vi.stubGlobal("fetch", (url: string, init: any) => notion.fetch(url, init));
  righe.clear();
  __prova.usa({
    leggiRiga: async (_k: string, pg: string) => { const r = righe.get(pg); return r ? JSON.parse(JSON.stringify({ ombra: r.ombra ?? null, stato: r.stato ?? { giri: 0, registro: [] } })) : null; },
    salvaOmbra: async (_k: string, pg: string, o: any) => { righe.set(pg, { ...(righe.get(pg) ?? {}), ombra: JSON.parse(JSON.stringify(o)) }); },
    salvaStato: async (_k: string, pg: string, s: any) => { righe.set(pg, { ...(righe.get(pg) ?? {}), stato: JSON.parse(JSON.stringify(s)) }); },
    leggiQuaderno: async () => ({ dati: JSON.parse(JSON.stringify(quaderno)), at: 1 }),
    scriviQuaderno: async (_k: string, d: QuadernoU) => { quaderno = JSON.parse(JSON.stringify(d)); },
    conChiave: async (_k: string, fn: () => Promise<any>) => fn(),
  } as any);
  // Notion e piano con lo stesso contenuto, il piano senza nid (com'era dopo l'import)
  const pg = notion.pagina.id;
  notion.crea(pg, "paragraph", "uno"); notion.crea(pg, "paragraph", "due");
  const T = notion.crea(pg, "toggle", "cartella"); notion.crea(T, "paragraph", "dentro uno"); notion.crea(T, "paragraph", "dentro due");
  const pu = notion.crea(pg, "bulleted_list_item", "punto"); notion.crea(pu, "bulleted_list_item", "sotto punto");
  notion.crea(pg, "paragraph", "tre"); notion.crea(pg, "to_do", "da fare");
  quaderno = { uv: 2, pages: [{ id: "pg", mod: 1, blocks: [b("text", "uno"), b("text", "due"), b("toggle", "cartella", { children: [b("text", "dentro uno"), b("text", "dentro due")] }), b("bullet", "punto"), b("bullet", "sotto punto", { indent: 1 }), b("text", "tre"), b("todo", "da fare", { checked: false })] }] } as any;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("sync piano <-> Notion (Notion finto)", () => {
  it("aggancia tutto e a riposo non scrive niente", async () => {
    const c = await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    expect(c.agganciati).toBe(9); expect(c.fuoriPiano).toBe(0); expect(c.fuoriNotion).toBe(0);
    await convergi();
    expect(registro().filter(r => /->|<-/.test(r))).toEqual([]);
    expect(pianoAlbero()).toEqual(notion.albero());
  });

  it("una riga nuova in Notion prima di un'altra non la fa sembrare spostata (la cascata del 12/10)", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    const uno = notion.lista(notion.pagina.id)[0]!;
    notion.crea(notion.pagina.id, "paragraph", "nuova da Notion", uno);
    await convergi();
    expect(pianoAlbero()).toEqual(notion.albero());
    expect(registro().filter(r => /cancello|creo/.test(r))).toEqual([]);
  });

  it("nei due sensi: nuove, modificate, cancellate, insieme sulla stessa pagina", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    // nell'app: una riga nuova dopo «due», «tre» cambiata, «dentro uno» tolta
    app(l => { const i = l.findIndex(x => x.text === "due"); l.splice(i + 1, 0, b("text", "nuova dal piano")); l.find(x => x.text === "tre")!.text = "tre cambiata nel piano"; const t = l.find(x => x.kind === "toggle")!; t.children = t.children!.filter(x => x.text !== "dentro uno"); return l; });
    // in Notion, insieme: «uno» cambiata, una riga in cima alla cartella, «punto» cancellato (con il suo figlio)
    const lista = notion.lista(notion.pagina.id);
    const T = lista.find(id => notion.b.get(id)!.type === "toggle")!;
    notion.b.get(lista[0]!)!.testo = "uno cambiata in Notion"; notion.tocca(lista[0]!);
    notion.crea(T, "paragraph", "prima nella cartella", null);
    notion.cancella(lista.find(id => notion.b.get(id)!.testo === "punto")!);
    await convergi();
    if (process.env.DEBUG_SYNC) console.log("DUESENSI", registro().join(" | "), notion.albero(), pianoAlbero());
    expect(pianoAlbero()).toEqual(notion.albero());
    expect(notion.albero()).toEqual(["0:uno cambiata in Notion", "0:due", "0:nuova dal piano", "0:cartella", "1:prima nella cartella", "1:dentro due", "0:tre cambiata nel piano", "0:da fare"]);
  });

  it("uno spostamento nell'app arriva in Notion, con i figli", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    app(l => { const i = l.findIndex(x => x.kind === "toggle"); const [t] = l.splice(i, 1); l.unshift(t!); return l; });
    await convergi();
    if (process.env.DEBUG_SYNC) console.log("SPOSTA", registro().join(" | "), notion.albero(), pianoAlbero());
    expect(notion.albero()).toEqual(["0:cartella", "1:dentro uno", "1:dentro due", "0:uno", "0:due", "0:punto", "1:sotto punto", "0:tre", "0:da fare"]);
    expect(pianoAlbero()).toEqual(notion.albero());
  });

  it("una copia vecchia del quaderno (app non aggiornata) non cancella niente in Notion", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    const vecchio = JSON.parse(JSON.stringify(quaderno));
    notion.crea(notion.pagina.id, "paragraph", "nuova da Notion");
    await convergi();
    // il telefono vecchio manda la sua copia (senza la riga nuova e senza uv), modificata dopo
    quaderno = unisciQuaderni({ ...vecchio, pages: [{ ...vecchio.pages[0], mod: Date.now() + 1000 }] } as any, quaderno);
    await convergi();
    expect(notion.albero()).toContain("0:nuova da Notion");
    expect(pianoAlbero()).toEqual(notion.albero());
  });

  it("nessun doppione dopo tanti giri", { timeout: 60_000 }, async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    app(l => [...l, b("text", "in fondo dal piano")]);
    for (let i = 0; i < 5; i++) await convergi();
    const tutti = notion.albero();
    expect(new Set(tutti).size).toBe(tutti.length);
    expect(pianoAlbero()).toEqual(tutti);
  });

  it("una modifica fatta dal job non fa rileggere Notion, una di Andrea si'", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    const riletture = () => registro().filter(r => r.includes("riletta")).length;
    const prima = riletture();
    app(l => { l[0]!.text = "uno dal piano"; return l; });
    await __prova.giro(K, "pg", null);              // il job scrive in Notion
    await __prova.leggiSeServe(K, "pg", false);
    await __prova.leggiSeServe(K, "pg", false);
    expect(riletture()).toBe(prima);
    const due = notion.lista(notion.pagina.id)[1]!;
    notion.b.get(due)!.testo = "due da Andrea"; notion.tocca(due);
    await __prova.leggiSeServe(K, "pg", false);
    expect(riletture()).toBe(prima + 1);
    expect(pianoAlbero()[1]).toBe("0:due da Andrea");
  });

  it("la valvola: un giro che vuole ricreare troppi blocchi si ferma", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    for (let i = 0; i < 8; i++) notion.crea(notion.pagina.id, "paragraph", "riempi " + i);
    await convergi();
    // il piano capovolto: tutto sembra spostato
    app(l => [...l].reverse());
    await convergi();
    expect(righe.get("pg").ombra.ferma).toMatch(/sync ferma per sicurezza/);
  });
  it("elenchi annidati: in Notion figli, nel piano righe rientrate, nei due sensi", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    const punto = notion.lista(notion.pagina.id).find(id => notion.b.get(id)!.testo === "punto")!;
    notion.crea(punto, "bulleted_list_item", "secondo sotto punto");
    app(l => { const i = l.findIndex(x => x.text === "sotto punto"); l.splice(i + 1, 0, b("bullet", "rientrata dal piano", { indent: 2 })); return l; });
    await convergi();
    expect(pianoAlbero()).toEqual(notion.albero());
    expect(notion.albero()).toEqual(["0:uno", "0:due", "0:cartella", "1:dentro uno", "1:dentro due", "0:punto", "1:sotto punto", "2:rientrata dal piano", "1:secondo sotto punto", "0:tre", "0:da fare"]);
  });

  it("la stessa riga cambiata dai due lati: vince la piu' recente", async () => {
    await __prova.aggancia(K, "pg", notion.pagina.id, { giri: 0, registro: [] });
    const uno = notion.lista(notion.pagina.id)[0]!;
    notion.b.get(uno)!.testo = "uno da Notion"; notion.tocca(uno);
    notion.b.get(uno)!.t = Date.now() - 5 * 60_000; // in Notion cinque minuti fa
    app(l => { l[0]!.text = "uno dal piano"; return l; }); // nell'app adesso
    await convergi();
    expect(notion.albero()[0]).toBe("0:uno dal piano");
    expect(pianoAlbero()).toEqual(notion.albero());
  });
});
