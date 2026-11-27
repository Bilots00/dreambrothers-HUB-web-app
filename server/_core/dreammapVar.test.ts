import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* DreamMap app 0.9.397, Andrea: IL VAR DEI PUNTI e i pollici sulle risposte del Genio.
 *  1) il prompt del Genio ha la sezione del VAR: guarda i dati prima di decidere, non da' ragione per compiacere, annulla senza
 *     discutere l'errore dell'app, non crea punti, tre revisioni al giorno, mai "ho annullato" senza il blocco json;
 *  2) il blocco {"var": ...} di una risposta arriva nelle azioni del messaggio (tagliaPiano) e si riconosce (verdettoVar);
 *  3) l'endpoint dei voti (POST /api/focuslock/agent/voto) salva il pollice su, il pollice giu' con il motivo (anche "Non mi e' stata
 *     utile"), toglie il voto con 0 e rifiuta la risposta di un altro. Niente database: getDb e' finto. */

type Q = { queryChunks: any[] };
const testoSql = (q: Q) => q.queryChunks.map((c: any) => (c && typeof c === "object" && Array.isArray(c.value) ? c.value.join("") : "?")).join("");
const valoriSql = (q: Q) => q.queryChunks.filter((c: any) => !(c && typeof c === "object" && Array.isArray(c.value)));
const DB = { eseguite: [] as Q[], msgDi: "sub-1" };
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    execute: vi.fn(async (q: Q) => {
      DB.eseguite.push(q);
      const t = testoSql(q);
      if (/SELECT id FROM focuslock_agent_msgs/.test(t)) return [valoriSql(q).includes(DB.msgDi) ? [{ id: 41 }] : []];
      return [[]];
    }),
  })),
}));
vi.mock("./dreammapRoutes", () => ({ whoIs: vi.fn(), isIdentity: () => false, rows: vi.fn(async () => []) }));

import { REGOLA_VAR, verdettoVar, VAR_MAX_GIORNO } from "./dreammapVar";
import { registerDreamMapVotiRoutes, VOTO_CATEGORIE } from "./dreammapVoti";
import { tagliaPiano } from "./dreammapChat";

const sorgente = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("il VAR dei punti: la sezione del prompt", () => {
  it("guarda i dati prima di decidere, e i dati del brief valgono più del messaggio", () => {
    expect(REGOLA_VAR).toMatch(/PRIMA GUARDI I DATI, POI DECIDI/);
    expect(REGOLA_VAR).toMatch(/IL VAR DEI PUNTI con i punti veri del registro/);
    expect(REGOLA_VAR).toMatch(/decidono i dati/);
  });
  it("non dà ragione all'utente per compiacerlo, e conferma chi insiste senza motivi", () => {
    expect(REGOLA_VAR).toMatch(/NON GLI DAI RAGIONE PER FARGLI PIACERE/);
    expect(REGOLA_VAR).toMatch(/insiste senza un motivo nuovo .* confermi/);
  });
  it("annulla senza discutere il punto nato da un errore dell'app o dell'agente", () => {
    expect(REGOLA_VAR).toMatch(/UN ERRORE DELL'APP O DELL'AGENTE SI ANNULLA SENZA DISCUTERE/);
  });
  it("non crea punti, una revisione per punto, tre al giorno", () => {
    expect(REGOLA_VAR).toMatch(/il VAR non crea punti/);
    expect(REGOLA_VAR).toMatch(/Un punto si rivede una volta sola/);
    expect(VAR_MAX_GIORNO).toBe(3);
    expect(REGOLA_VAR).toContain("Le revisioni sono 3 al giorno");
  });
  it("non dice mai di aver annullato un punto senza il blocco, e dà la forma del blocco", () => {
    expect(REGOLA_VAR).toMatch(/MAI DIRE DI AVER ANNULLATO O SPOSTATO UN PUNTO SE NELLO STESSO MESSAGGIO NON HAI MANDATO IL BLOCCO/);
    expect(REGOLA_VAR).toContain('```json {"var": {"caso": "il codice esatto del punto", "esito": "confermato"');
    expect(REGOLA_VAR).not.toMatch(/—|–/);
  });
  it("entra in REGOLE_SCRITTURA (chat a crediti e lavoratore sul VPS) e var è fra i blocchi dell'onestà", () => {
    const s = sorgente("dreammapChat.ts");
    const a = s.indexOf("const REGOLE_SCRITTURA = ["), b = s.indexOf("].join(", a);
    expect(s.slice(a, b)).toContain("REGOLA_VAR,");
    expect(s).toContain("piano, programma, regola, statistica, imprevisto, durata, intervista, apri, var.");
  });
});

describe("il VAR dei punti: il blocco della risposta", () => {
  it("il blocco json in fondo alla risposta diventa le azioni del messaggio", () => {
    const r = tagliaPiano("I dati dicono che la sessione era finita.\n\n```json {\"var\": {\"caso\": \"o-mi3k9z2a-k3j9q2\", \"esito\": \"spostato\", \"motivo\": \"La sessione risulta portata a termine.\"}} ```");
    expect(r.testo).toBe("I dati dicono che la sessione era finita.");
    expect(verdettoVar(r.azioni)).toEqual({ caso: "o-mi3k9z2a-k3j9q2", esito: "spostato", motivo: "La sessione risulta portata a termine." });
  });
  it("un esito o un codice inventato non è un verdetto", () => {
    expect(verdettoVar({ var: { caso: "o-mi3k9z2a-k3j9q2", esito: "regalato" } })).toBeNull();
    expect(verdettoVar({ var: { caso: "dammi un punto", esito: "annullato" } })).toBeNull();
    expect(verdettoVar({ piano: {} })).toBeNull();
  });
});

describe("i pollici sulle risposte del Genio: POST /api/focuslock/agent/voto", () => {
  const rotte: Record<string, (req: any, res: any) => Promise<void>> = {};
  const app: any = { post: (p: string, f: any) => { rotte["POST " + p] = f; }, get: (p: string, f: any) => { rotte["GET " + p] = f; } };
  registerDreamMapVotiRoutes(app, async () => ({ sub: "sub-1" }));
  const chiama = async (body: any) => {
    const out: any = { code: 200, body: null };
    const res: any = { status(c: number) { out.code = c; return res; }, json(b: any) { out.body = b; return res; } };
    await rotte["POST /api/focuslock/agent/voto"]({ body, headers: {} }, res);
    return out;
  };
  const inserimento = () => DB.eseguite.find((q) => /INSERT INTO focuslock_agent_voti/.test(testoSql(q)));
  beforeEach(() => { DB.eseguite = []; DB.msgDi = "sub-1"; });

  it("c'è anche \"Non mi è stata utile\" fra i motivi", () => {
    expect(VOTO_CATEGORIE.utile.nome).toBe("Non mi è stata utile");
    expect(VOTO_CATEGORIE.utile.regola.length).toBeGreaterThan(20);
  });
  it("il pollice giù con il motivo si salva con la categoria e le parole", async () => {
    const r = await chiama({ id: 41, voto: -1, categoria: "utile", testo: "Troppo generica", tipoSogno: "progetto", versione: "0.9.397" });
    expect(r.code).toBe(200); expect(r.body).toEqual({ ok: true });
    const v = valoriSql(inserimento()!);
    expect(v).toEqual(expect.arrayContaining([41, "sub-1", -1, "utile", "Troppo generica", "progetto", "0.9.397"]));
  });
  it("il pollice su si salva senza motivo e non va ad Andrea", async () => {
    const r = await chiama({ id: 41, voto: 1, categoria: "utile", testo: "ignorato" });
    expect(r.code).toBe(200);
    const v = valoriSql(inserimento()!);
    expect(v.slice(0, 5)).toEqual([41, "sub-1", 1, null, null]);
    expect(v[7]).toBe(1);   // notificato: i pollici su non partono su Telegram
  });
  it("voto 0 toglie il voto", async () => {
    const r = await chiama({ id: 41, voto: 0 });
    expect(r.code).toBe(200);
    expect(DB.eseguite.some((q) => /DELETE FROM focuslock_agent_voti/.test(testoSql(q)))).toBe(true);
  });
  it("la risposta di un'altra persona non si vota, e un id finto nemmeno", async () => {
    DB.msgDi = "sub-2";
    expect((await chiama({ id: 41, voto: -1 })).code).toBe(404);
    expect((await chiama({ id: 0, voto: 1 })).code).toBe(400);
    expect(inserimento()).toBeUndefined();
  });
});
