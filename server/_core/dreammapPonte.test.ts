import { describe, it, expect, vi, beforeEach } from "vitest";

/* DreamMap, il ponte con le altre AI (26/11). Due cose viste sull'account vero:
 *  1) leggi_piano rispondeva "Quest'anno: da scrivere / Questo mese: da scrivere ..." mentre il Genio gli aveva gia' fatto la roadmap:
 *     il server rileggeva solo la fotografia di cinque righe che il telefono costruisce con gli anelli GIA' APPLICATI (albero-maestro.js,
 *     amAlbero), e la roadmap del Genio resta nella sua chat finche' l'utente non tocca "Applica la roadmap";
 *  2) scrivi_roadmap diceva "l'utente la vede nell'app", ma l'app controllava la roadmap della sua AI solo nei tre giorni dopo aver aperto
 *     il foglio del resoconto della sera (ponte.js, pntRoadmapGuarda): la proposta non compariva mai.
 * Qui il server: il telefono manda la roadmap che l'utente vede (con i passi, o la proposta del Genio non ancora applicata) e leggi_piano
 * la racconta; dice anche se la roadmap scritta con scrivi_roadmap l'app l'ha gia' mostrata. Niente database: rows e getDb sono finti. */

type Q = { queryChunks: any[] };
const testoSql = (q: Q) => q.queryChunks.map((c: any) => (c && typeof c === "object" && Array.isArray(c.value) ? c.value.join("") : "?")).join("");
const valoriSql = (q: Q) => q.queryChunks.filter((c: any) => !(c && typeof c === "object" && Array.isArray(c.value)));

const DB = { chiave: null as any, roadmap: null as any, eseguite: [] as Q[] };
vi.mock("./dreammapSocial", () => ({
  rows: vi.fn(async (q: Q) => {
    const t = testoSql(q);
    if (/FROM focuslock_ponte_roadmap/.test(t)) return DB.roadmap ? [DB.roadmap] : [];
    if (/FROM focuslock_ponte_chiavi/.test(t)) return DB.chiave ? [DB.chiave] : [];
    return [];
  }),
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => ({ execute: vi.fn(async (q: Q) => { DB.eseguite.push(q); return []; }) })) }));
vi.mock("./dreammapRoutes", () => ({ whoIs: vi.fn(), isIdentity: () => false }));

import * as ponte from "./dreammapPonte";

const CHIAVE = "a".repeat(48);
const VECCHIO = "Il sogno: far crescere il mio negozio online\nQuest'anno: da scrivere\nQuesto mese: da scrivere\nQuesta settimana: da scrivere\nOggi, una cosa sola: da scrivere";
const DEL_GENIO = {
  fonte: "genio", at: Date.UTC(2026, 10, 25, 20, 10), sogno: "Vivere delle vendite del mio negozio online", adesso: "",
  anno: { testo: "Arrivare a 3.000 euro al mese di vendite", passi: [] },
  mese: { testo: "Fare le prime 30 vendite dalle inserzioni", passi: ["Lanciare la prima campagna con 3 inserzioni (2 ore)"] },
  settimana: { testo: "Avere la pagina prodotto pronta", passi: ["Riscrivere la pagina del prodotto più venduto (90 minuti)"] },
  oggi: { testo: "Scegliere il prodotto di punta", passi: ["Mettere in prima pagina il prodotto più venduto (45 minuti)"] },
};
const leggi = async () => {
  const r: any = await ponte.rispondiMcp(CHIAVE, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "leggi_piano", arguments: {} } });
  return String(r?.result?.content?.[0]?.text || "");
};

beforeEach(() => { DB.chiave = null; DB.roadmap = null; DB.eseguite = []; });

describe("leggi_piano: la roadmap che l'utente vede davvero", () => {
  it("con la proposta del Genio non ancora applicata, la racconta con i passi e dice come applicarla", async () => {
    DB.chiave = { piano: VECCHIO, pianoJson: JSON.stringify(DEL_GENIO), pianoAt: Date.UTC(2026, 10, 26, 8, 0), rmVista: 0 };
    const t = await leggi();
    expect(t).toContain("Il sogno: Vivere delle vendite del mio negozio online");
    expect(t).toContain("Quest'anno: Arrivare a 3.000 euro al mese di vendite");
    expect(t).toContain("Questa settimana: Avere la pagina prodotto pronta");
    expect(t).toContain("- Riscrivere la pagina del prodotto più venduto (90 minuti)");
    expect(t).toMatch(/proposta dal Genio/);
    expect(t).toMatch(/Applica la roadmap/);
    expect(t).not.toMatch(/da scrivere/);
  });
  it("con gli anelli applicati nell'app, li legge con i passi ancora da fare e la cosa di adesso", async () => {
    const vista = { fonte: "app", sogno: "Vivere delle vendite del mio negozio online", adesso: "Mettere in prima pagina il prodotto più venduto",
      mese: { testo: "Fare le prime 30 vendite", passi: ["Lanciare la prima campagna (2 ore)"] } };
    DB.chiave = { piano: VECCHIO, pianoJson: JSON.stringify(vista), pianoAt: Date.UTC(2026, 10, 26, 8, 0), rmVista: 0 };
    const t = await leggi();
    expect(t).toContain("Questo mese: Fare le prime 30 vendite");
    expect(t).toContain("- Lanciare la prima campagna (2 ore)");
    expect(t).toContain("Adesso, una cosa sola: Mettere in prima pagina il prodotto più venduto");
    expect(t).not.toMatch(/proposta dal Genio/);
  });
  it("con un'app vecchia (solo le cinque righe, tutte da scrivere) dice dove sta la roadmap del Genio", async () => {
    DB.chiave = { piano: VECCHIO, pianoJson: null, pianoAt: null, rmVista: 0 };
    const t = await leggi();
    expect(t).toContain(VECCHIO);
    expect(t).toMatch(/chat del Genio/);
    expect(t).toMatch(/Applica la roadmap/);
  });
  it("dice se la roadmap scritta con scrivi_roadmap l'app l'ha gia' mostrata o no", async () => {
    const at = new Date(Date.UTC(2026, 10, 26, 9, 30));
    DB.roadmap = { createdAt: at };
    DB.chiave = { piano: VECCHIO, pianoJson: JSON.stringify(DEL_GENIO), pianoAt: Date.UTC(2026, 10, 26, 8, 0), rmVista: 0 };
    expect(await leggi()).toMatch(/scrivi_roadmap.*l'app non l'ha ancora mostrata/);
    DB.chiave.rmVista = at.getTime();
    expect(await leggi()).toMatch(/scrivi_roadmap.*l'ha già vista/);
  });
});

describe("POST /ponte/piano: il telefono manda la roadmap che si vede", () => {
  it("salva la roadmap (pulita) e da quando la vista e' aggiornata", async () => {
    const rotte: Record<string, any> = {};
    const app: any = { get: (p: string, h: any) => { rotte["GET " + p] = h; }, post: (p: string, h: any) => { rotte["POST " + p] = h; } };
    ponte.registerDreamMapPonteRoutes(app);
    DB.chiave = { chiave: CHIAVE };
    const res: any = { json: vi.fn(), status: vi.fn(() => res) };
    const sporco = { ...DEL_GENIO, mese: { testo: "  Fare   le prime 30 vendite  ", passi: ["", "Lanciare la prima campagna", 3] }, intruso: "<script>" };
    await rotte["POST /api/focuslock/ponte/piano"]({ body: { chiave: CHIAVE, piano: VECCHIO, roadmap: sporco, rmVista: 1234 } }, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    const up = DB.eseguite.find((q) => /UPDATE focuslock_ponte_chiavi SET piano/.test(testoSql(q)));
    expect(up).toBeTruthy();
    expect(testoSql(up!)).toMatch(/pianoJson = \?/);
    expect(testoSql(up!)).toMatch(/pianoAt = NOW\(\)/);
    const salvata = JSON.parse(String(valoriSql(up!).find((v: any) => typeof v === "string" && v.startsWith("{"))));
    expect(salvata.fonte).toBe("genio");
    expect(salvata.mese).toEqual({ testo: "Fare le prime 30 vendite", passi: ["Lanciare la prima campagna", "3"] });
    expect(salvata.intruso).toBeUndefined();
    expect(valoriSql(up!)).toContain(1234);
  });
});

describe("scrivi_roadmap: non promette quello che l'app non ha ancora fatto", () => {
  it("dice che compare quando l'utente apre DreamMap e come controllarlo", async () => {
    const r: any = await ponte.rispondiMcp(CHIAVE, { id: 1, method: "tools/call", params: { name: "scrivi_roadmap", arguments: { piano: { settimana: { testo: "x", passi: ["y"] } } } } });
    const t = String(r?.result?.content?.[0]?.text || "");
    expect(t).toMatch(/quando l'utente apre DreamMap/);
    expect(t).toMatch(/leggi_piano/);
  });
});
