import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { rows, ensureTables as ensureSocial } from "./focuslockSocial";

/* FocusLock / The Dream Map — l'arena: gli amici con i loro numeri, le reazioni, il Focus
 * insieme, le leghe settimanali e il conteggio di chi partecipa a una sfida.
 *
 * Stessa identita' della classifica (l'id casuale del telefono, focuslock_players): niente
 * email, niente contatti. Agli amici arrivano SOLO gli aggregati: ore di concentrazione della
 * settimana, giorni di fila, punteggio vecchio te / nuovo te, delta settimanale. Mai il nome
 * di un'app, mai il tempo di schermo, mai la rotta.
 *
 * LEGHE. Settimana da lunedi' a domenica; la chiusura la fa il server la prima volta che
 * qualcuno chiede la lega dopo la mezzanotte UTC di domenica. Fino a trenta persone per lega,
 * stesso obiettivo del Genio; se l'obiettivo ha meno di cinque iscritti si finisce nella lega
 * generale; sotto i cinque, anche li', la lega e' «in formazione»: niente promossi, niente
 * retrocessi, e MAI giocatori finti. Punti = minuti di Full Focus portati a termine (li conta
 * il telefono, con il tetto di 480 al giorno) + 30 per ogni passo della rotta spuntato. */

const REAZIONI = ["grande", "continua", "nonmollare", "centrato"];
const TIERS = ["bronzo", "argento", "oro", "diamante"];
const LEGA_MAX = 30;
const LEGA_MIN = 5;
const INSIEME_SCADENZA_MIN = 10;

let arenaReady: Promise<void> | null = null;
function ensureArena(): Promise<void> {
  if (!arenaReady) {
    arenaReady = (async () => {
      await ensureSocial();
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_reazioni (
        id INT AUTO_INCREMENT PRIMARY KEY,
        da VARCHAR(64) NOT NULL,
        a VARCHAR(64) NOT NULL,
        tipo VARCHAR(12) NOT NULL,
        giorno DATE NOT NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY uniq_r (da, a, tipo, giorno),
        INDEX idx_a (a, createdAt)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_insieme (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codice VARCHAR(8) NOT NULL UNIQUE,
        da VARCHAR(64) NOT NULL,
        a VARCHAR(64) NULL,
        minuti INT NOT NULL,
        createdAt TIMESTAMP NULL,
        acceptedAt TIMESTAMP NULL,
        endAt TIMESTAMP NULL,
        esitoDa TEXT NULL,
        esitoA TEXT NULL,
        INDEX idx_da (da, createdAt), INDEX idx_a (a, createdAt)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_leghe (
        id INT AUTO_INCREMENT PRIMARY KEY,
        settimana VARCHAR(10) NOT NULL,
        goal VARCHAR(24) NOT NULL,
        tier VARCHAR(12) NOT NULL,
        chiusa TINYINT NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NULL,
        INDEX idx_s (settimana, goal, tier)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_lega_membri (
        settimana VARCHAR(10) NOT NULL,
        device VARCHAR(64) NOT NULL,
        legaId INT NOT NULL,
        nick VARCHAR(24) NOT NULL DEFAULT '',
        punti INT NOT NULL DEFAULT 0,
        tier VARCHAR(12) NOT NULL DEFAULT 'bronzo',
        esito VARCHAR(12) NOT NULL DEFAULT '',
        posizione INT NOT NULL DEFAULT 0,
        visto TINYINT NOT NULL DEFAULT 0,
        PRIMARY KEY (settimana, device),
        INDEX idx_lega (legaId)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_sfide (
        device VARCHAR(64) NOT NULL,
        sfidaId VARCHAR(40) NOT NULL,
        stato VARCHAR(12) NOT NULL DEFAULT 'attiva',
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        PRIMARY KEY (device, sfidaId),
        INDEX idx_sfida (sfidaId, stato)
      )`);
    })().catch((e) => { arenaReady = null; throw e; });
  }
  return arenaReady;
}

/* ---- la settimana, in UTC: 'YYYY-Www' ---- */
function settimanaDi(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const g = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - g);
  const inizio = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((x.getTime() - inizio.getTime()) / 86400000 + 1) / 7);
  return x.getUTCFullYear() + "-W" + String(w).padStart(2, "0");
}
function settimanaCorrente(): string { return settimanaDi(new Date()); }
/** Il prossimo lunedi' 00:00 UTC. */
function fineSettimana(): number {
  const d = new Date();
  const g = d.getUTCDay() || 7;
  const lun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - g)));
  return lun.getTime();
}
function codice(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function nomeDi(r: any): string { return String(r?.nick || r?.name || "").trim() || "Giocatore"; }
async function sonoAmici(device: string, altro: string): Promise<boolean> {
  const r = await rows(sql`SELECT 1 AS k FROM focuslock_friends WHERE device = ${device} AND friend = ${altro} LIMIT 1`);
  return r.length > 0;
}

/* ---- la chiusura delle settimane passate ---- */
let chiusuraFatta = "";
async function chiudiSettimane(): Promise<void> {
  const ora = settimanaCorrente();
  if (chiusuraFatta === ora) return;
  const aperte = await rows(sql`SELECT id, settimana, tier FROM focuslock_leghe WHERE chiusa = 0 AND settimana < ${ora}`);
  for (const l of aperte) {
    const membri = await rows(sql`SELECT device, punti FROM focuslock_lega_membri WHERE legaId = ${l.id} ORDER BY punti DESC, device ASC`);
    const n = membri.length;
    const ti = TIERS.indexOf(String(l.tier));
    for (let i = 0; i < n; i++) {
      const m = membri[i];
      let esito = "confermato";
      let nuovoTier = String(l.tier);
      if (n < LEGA_MIN) esito = "formazione";
      else if (i < 5) { esito = ti < TIERS.length - 1 ? "promosso" : "vetta"; if (ti < TIERS.length - 1) nuovoTier = TIERS[ti + 1]; }
      else if (i >= n - 5) { esito = ti > 0 ? "retrocesso" : "confermato"; if (ti > 0) nuovoTier = TIERS[ti - 1]; }
      await rows(sql`UPDATE focuslock_lega_membri SET esito = ${esito}, posizione = ${i + 1} WHERE legaId = ${l.id} AND device = ${m.device}`);
      if (nuovoTier !== String(l.tier)) await rows(sql`UPDATE focuslock_players SET tier = ${nuovoTier} WHERE device = ${m.device}`);
    }
    await rows(sql`UPDATE focuslock_leghe SET chiusa = 1 WHERE id = ${l.id}`);
  }
  chiusuraFatta = ora;
}

/* ---- l'iscrizione a una lega della settimana ---- */
const CATEGORIE = ["studenti", "imprenditori", "lavoratori", "creator", "sportivi"];
async function assegnaLega(device: string, goal: string, tier: string, nick: string, settimana: string, categoria: string): Promise<number> {
  const gia = await rows(sql`SELECT legaId FROM focuslock_lega_membri WHERE settimana = ${settimana} AND device = ${device}`);
  if (gia[0]) return Number(gia[0].legaId);
  /* la categoria scelta dall'utente (Studenti, Imprenditori...): la lega resta dentro la categoria,
     e sotto i cinque e' «in formazione». Senza categoria vale la vecchia regola: l'obiettivo del
     Genio se ha abbastanza gente, altrimenti la lega generale. */
  let g = categoria && CATEGORIE.indexOf(categoria) >= 0 ? categoria : (goal || "*");
  if (!categoria && g !== "*") {
    const pool = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE legaOptIn = 1 AND goal = ${g} AND updatedAt > (NOW() - INTERVAL 14 DAY)`);
    if (Number(pool[0]?.k || 0) < LEGA_MIN) g = "*";
  }
  const leghe = await rows(sql`SELECT l.id, (SELECT COUNT(*) FROM focuslock_lega_membri m WHERE m.legaId = l.id) AS n
    FROM focuslock_leghe l WHERE l.settimana = ${settimana} AND l.goal = ${g} AND l.tier = ${tier} AND l.chiusa = 0 ORDER BY l.id ASC`);
  let legaId = 0;
  for (const l of leghe) if (Number(l.n) < LEGA_MAX) { legaId = Number(l.id); break; }
  if (!legaId) {
    await rows(sql`INSERT INTO focuslock_leghe (settimana, goal, tier, chiusa, createdAt) VALUES (${settimana}, ${g}, ${tier}, 0, NOW())`);
    const nuova = await rows(sql`SELECT id FROM focuslock_leghe WHERE settimana = ${settimana} AND goal = ${g} AND tier = ${tier} ORDER BY id DESC LIMIT 1`);
    legaId = Number(nuova[0]?.id || 0);
  }
  const p = await rows(sql`SELECT legaPunti, legaSettimana FROM focuslock_players WHERE device = ${device}`);
  const punti = p[0] && String(p[0].legaSettimana) === settimana ? Number(p[0].legaPunti || 0) : 0;
  await rows(sql`INSERT IGNORE INTO focuslock_lega_membri (settimana, device, legaId, nick, punti, tier) VALUES (${settimana}, ${device}, ${legaId}, ${nick}, ${punti}, ${tier})`);
  return legaId;
}

export function registerFocusLockArenaRoutes(app: Express) {
  /* Gli amici, con i soli aggregati che si possono vedere. Piu' gli inviti al Focus insieme
     in attesa e le reazioni gia' mandate oggi. */
  app.get("/api/focuslock/social/amici", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureArena();
      const list = await rows(sql`SELECT p.device, p.name, p.nick, p.level, p.ffMin7, p.streak, p.ffStreak, p.neo, p.old, p.score7, p.prevScore7, p.tier, p.updatedAt
        FROM focuslock_friends f JOIN focuslock_players p ON p.device = f.friend WHERE f.device = ${device} ORDER BY p.score7 DESC, p.updatedAt DESC LIMIT 100`);
      const oggi = await rows(sql`SELECT a, tipo FROM focuslock_reazioni WHERE da = ${device} AND giorno = UTC_DATE()`);
      const mandate: Record<string, string[]> = {};
      for (const r of oggi) (mandate[String(r.a)] = mandate[String(r.a)] || []).push(String(r.tipo));
      const amici = list.map((r) => ({
        device: String(r.device), nome: nomeDi(r), level: Number(r.level || 1),
        ffMin7: Number(r.ffMin7 || 0), streak: Number(r.streak || 0), ffStreak: Number(r.ffStreak || 0),
        neo: Number(r.neo || 0), old: Number(r.old || 0), score7: Number(r.score7 || 0), prevScore7: Number(r.prevScore7 || 0),
        tier: String(r.tier || "bronzo"), visto: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
        reazioniOggi: mandate[String(r.device)] || [],
      }));
      const ricevute = await rows(sql`SELECT r.tipo, COUNT(*) AS n FROM focuslock_reazioni r WHERE r.a = ${device} AND r.createdAt > (NOW() - INTERVAL 7 DAY) GROUP BY r.tipo`);
      const ultime = await rows(sql`SELECT r.tipo, r.createdAt, p.name, p.nick FROM focuslock_reazioni r JOIN focuslock_players p ON p.device = r.da WHERE r.a = ${device} ORDER BY r.createdAt DESC LIMIT 12`);
      res.json({ amici, reazioni: { totali: ricevute.map((x) => ({ tipo: String(x.tipo), n: Number(x.n) })), ultime: ultime.map((x) => ({ tipo: String(x.tipo), da: nomeDi(x), at: x.createdAt })) } });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "amici non disponibili" });
    }
  });

  /* Una reazione predefinita: una per tipo, per amico, al giorno. */
  app.post("/api/focuslock/social/reazione", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64), a = String(b.a || "").slice(0, 64), tipo = String(b.tipo || "");
    if (!device || !a || REAZIONI.indexOf(tipo) < 0) { res.status(400).json({ error: "reazione non valida" }); return; }
    try {
      await ensureArena();
      if (!(await sonoAmici(device, a))) { res.status(403).json({ error: "non siete amici" }); return; }
      const gia = await rows(sql`SELECT 1 AS k FROM focuslock_reazioni WHERE da = ${device} AND a = ${a} AND tipo = ${tipo} AND giorno = UTC_DATE() LIMIT 1`);
      if (gia.length) { res.json({ ok: true, gia: true }); return; }
      await rows(sql`INSERT IGNORE INTO focuslock_reazioni (da, a, tipo, giorno, createdAt) VALUES (${device}, ${a}, ${tipo}, UTC_DATE(), NOW())`);
      res.json({ ok: true, gia: false });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "reazione non salvata" });
    }
  });

  /* ---- Focus insieme ---- */
  app.post("/api/focuslock/social/insieme", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const a = String(b.a || "").slice(0, 64);
    const minuti = Math.max(10, Math.min(180, Math.round(Number(b.minuti) || 25)));
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureArena();
      if (a && !(await sonoAmici(device, a))) { res.status(403).json({ error: "non siete amici" }); return; }
      /* un invito aperto alla volta: quello vecchio si chiude */
      await rows(sql`DELETE FROM focuslock_insieme WHERE da = ${device} AND acceptedAt IS NULL`);
      let c = "";
      for (let i = 0; i < 5 && !c; i++) {
        const cand = codice();
        const clash = await rows(sql`SELECT id FROM focuslock_insieme WHERE codice = ${cand}`);
        if (!clash.length) c = cand;
      }
      await rows(sql`INSERT INTO focuslock_insieme (codice, da, a, minuti, createdAt) VALUES (${c}, ${device}, ${a || null}, ${minuti}, NOW())`);
      const r = await rows(sql`SELECT id, createdAt FROM focuslock_insieme WHERE codice = ${c} LIMIT 1`);
      res.json({ ok: true, id: Number(r[0]?.id || 0), codice: c, minuti, scadeAt: new Date(Date.now() + INSIEME_SCADENZA_MIN * 60000).toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "invito non creato" });
    }
  });
  app.post("/api/focuslock/social/insieme/accetta", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const c = String(b.codice || "").trim().toUpperCase().slice(0, 8);
    const id = Number(b.id) || 0;
    if (!device || (!c && !id)) { res.status(400).json({ error: "codice mancante" }); return; }
    try {
      await ensureArena();
      const inv = id
        ? await rows(sql`SELECT * FROM focuslock_insieme WHERE id = ${id} LIMIT 1`)
        : await rows(sql`SELECT * FROM focuslock_insieme WHERE codice = ${c} LIMIT 1`);
      const i = inv[0];
      if (!i) { res.status(404).json({ error: "Nessun invito con questo codice." }); return; }
      if (String(i.da) === device) { res.status(400).json({ error: "È il tuo invito." }); return; }
      if (i.acceptedAt) { res.status(409).json({ error: "Qualcuno l'ha già accettato." }); return; }
      if (Date.now() - new Date(i.createdAt).getTime() > INSIEME_SCADENZA_MIN * 60000) { res.status(410).json({ error: "L'invito è scaduto." }); return; }
      if (i.a && String(i.a) !== device) { res.status(403).json({ error: "Questo invito è per un altro amico." }); return; }
      const endAt = new Date(Date.now() + 20000 + Number(i.minuti) * 60000);
      await rows(sql`UPDATE focuslock_insieme SET a = ${device}, acceptedAt = NOW(), endAt = ${endAt} WHERE id = ${i.id}`);
      const da = await rows(sql`SELECT name, nick FROM focuslock_players WHERE device = ${String(i.da)}`);
      res.json({ ok: true, id: Number(i.id), minuti: Number(i.minuti), endAt: endAt.toISOString(), con: nomeDi(da[0]), conDevice: String(i.da) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "invito non accettato" });
    }
  });
  app.get("/api/focuslock/social/insieme", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureArena();
      const lim = new Date(Date.now() - INSIEME_SCADENZA_MIN * 60000);
      const miei = await rows(sql`SELECT i.*, p.name AS aName, p.nick AS aNick FROM focuslock_insieme i LEFT JOIN focuslock_players p ON p.device = i.a WHERE i.da = ${device} ORDER BY i.id DESC LIMIT 5`);
      const ricevuti = await rows(sql`SELECT i.*, p.name AS daName, p.nick AS daNick FROM focuslock_insieme i JOIN focuslock_players p ON p.device = i.da
        WHERE i.a = ${device} AND (i.acceptedAt IS NOT NULL OR i.createdAt > ${lim}) ORDER BY i.id DESC LIMIT 5`);
      const forma = (i: any, ruolo: "da" | "a") => {
        const scaduto = !i.acceptedAt && Date.now() - new Date(i.createdAt).getTime() > INSIEME_SCADENZA_MIN * 60000;
        const p = (x: any) => { try { return x ? JSON.parse(String(x)) : null; } catch { return null; } };
        return { id: Number(i.id), codice: String(i.codice), minuti: Number(i.minuti), ruolo,
          stato: i.acceptedAt ? (new Date(i.endAt).getTime() < Date.now() ? "finito" : "in corso") : (scaduto ? "scaduto" : "attesa"),
          con: ruolo === "da" ? (i.a ? nomeDi({ name: i.aName, nick: i.aNick }) : "") : nomeDi({ name: i.daName, nick: i.daNick }),
          conDevice: ruolo === "da" ? (i.a ? String(i.a) : "") : String(i.da),
          createdAt: i.createdAt, endAt: i.endAt, scadeAt: new Date(new Date(i.createdAt).getTime() + INSIEME_SCADENZA_MIN * 60000).toISOString(),
          mio: p(ruolo === "da" ? i.esitoDa : i.esitoA), suo: p(ruolo === "da" ? i.esitoA : i.esitoDa) };
      };
      res.json({ miei: miei.map((i) => forma(i, "da")), ricevuti: ricevuti.map((i) => forma(i, "a")) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "inviti non disponibili" });
    }
  });
  app.post("/api/focuslock/social/insieme/esito", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const id = Number(b.id) || 0;
    if (!device || !id) { res.status(400).json({ error: "dati mancanti" }); return; }
    try {
      await ensureArena();
      const esito = JSON.stringify({ ok: !!b.ok, minuti: Math.max(0, Math.min(600, Math.round(Number(b.minuti) || 0))), at: new Date().toISOString() });
      await rows(sql`UPDATE focuslock_insieme SET esitoDa = IF(da = ${device}, ${esito}, esitoDa), esitoA = IF(a = ${device}, ${esito}, esitoA) WHERE id = ${id} AND (da = ${device} OR a = ${device})`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "esito non salvato" });
    }
  });
  app.post("/api/focuslock/social/insieme/annulla", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const id = Number(b.id) || 0;
    try {
      await ensureArena();
      await rows(sql`DELETE FROM focuslock_insieme WHERE id = ${id} AND da = ${device} AND acceptedAt IS NULL`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "non annullato" });
    }
  });

  /* ---- la lega ---- */
  app.post("/api/focuslock/social/lega/iscrivi", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const nick = String(b.nick || "").trim().slice(0, 24);
    const categoria = CATEGORIE.indexOf(String(b.categoria || "")) >= 0 ? String(b.categoria) : "";
    const optIn = b.optIn === undefined ? true : !!b.optIn;
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureArena();
      await rows(sql`UPDATE focuslock_players SET legaOptIn = ${optIn ? 1 : 0}, nick = ${nick}, categoria = ${categoria} WHERE device = ${device}`);
      res.json({ ok: true, optIn });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "iscrizione non riuscita" });
    }
  });
  app.get("/api/focuslock/social/lega", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    try {
      await ensureArena();
      await chiudiSettimane();
      const me = (await rows(sql`SELECT device, name, nick, goal, tier, legaOptIn, categoria FROM focuslock_players WHERE device = ${device}`))[0];
      if (!me) { res.json({ optIn: false, giocatore: false }); return; }
      const settimana = settimanaCorrente();
      /* il risultato della settimana scorsa, finche' non e' stato visto */
      const prec = await rows(sql`SELECT m.settimana, m.esito, m.posizione, m.punti, m.tier, m.visto, (SELECT COUNT(*) FROM focuslock_lega_membri x WHERE x.legaId = m.legaId) AS n
        FROM focuslock_lega_membri m WHERE m.device = ${device} AND m.settimana < ${settimana} AND m.esito <> '' ORDER BY m.settimana DESC LIMIT 1`);
      const risultato = prec[0] && !Number(prec[0].visto) ? { settimana: String(prec[0].settimana), esito: String(prec[0].esito), posizione: Number(prec[0].posizione), punti: Number(prec[0].punti), tierPrima: String(prec[0].tier), tierOra: String(me.tier || "bronzo"), n: Number(prec[0].n) } : null;
      if (!Number(me.legaOptIn)) { res.json({ optIn: true && false, giocatore: true, tier: String(me.tier || "bronzo"), fine: fineSettimana(), risultato }); return; }
      const legaId = await assegnaLega(device, String(me.goal || ""), String(me.tier || "bronzo"), String(me.nick || ""), settimana, String(me.categoria || ""));
      const lega = (await rows(sql`SELECT id, goal, tier FROM focuslock_leghe WHERE id = ${legaId}`))[0];
      const membri = await rows(sql`SELECT m.device, m.nick, m.punti, p.name, p.updatedAt FROM focuslock_lega_membri m JOIN focuslock_players p ON p.device = m.device WHERE m.legaId = ${legaId} ORDER BY m.punti DESC, m.device ASC`);
      const out = membri.map((m, i) => ({ device: String(m.device), nome: nomeDi(m), punti: Number(m.punti || 0), posizione: i + 1, me: String(m.device) === device }));
      const mio = out.filter((x) => x.me)[0] || null;
      res.json({ optIn: true, giocatore: true, settimana, fine: fineSettimana(), tier: String(lega?.tier || me.tier || "bronzo"), goal: String(lega?.goal || "*"),
        categoria: String(me.categoria || ""), stato: out.length < LEGA_MIN ? "formazione" : "ok", minimo: LEGA_MIN, membri: out, mio, risultato });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "lega non disponibile" });
    }
  });
  app.post("/api/focuslock/social/lega/visto", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64), settimana = String(b.settimana || "").slice(0, 10);
    try {
      await ensureArena();
      await rows(sql`UPDATE focuslock_lega_membri SET visto = 1 WHERE device = ${device} AND settimana = ${settimana}`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "non segnato" });
    }
  });

  /* Quanti stanno facendo una sfida adesso (aggiornato dalla sync di ogni telefono). */
  app.get("/api/focuslock/social/sfide", async (req: Request, res: Response) => {
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim().slice(0, 40)).filter(Boolean).slice(0, 20);
    try {
      await ensureArena();
      const out: Record<string, number> = {};
      for (const id of ids) {
        const r = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_sfide WHERE sfidaId = ${id} AND stato = 'attiva' AND updatedAt > (NOW() - INTERVAL 40 DAY)`);
        out[id] = Number(r[0]?.k || 0);
      }
      res.json({ partecipanti: out });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "conteggio non disponibile" });
    }
  });
}
