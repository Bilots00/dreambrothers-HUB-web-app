import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../db";

/* FocusLock — Amici e classifica.
 *
 * Ogni telefono è un giocatore (device id generato dall'app, nessuna email, nessun account):
 * manda i propri numeri (livello, punti, giorni di fila, minuti di FullFocus e blocchi degli
 * ultimi sette giorni) e riceve il proprio codice invito. Gli amici si aggiungono col codice,
 * in entrambe le direzioni. La classifica è per punteggio della settimana (minuti di
 * concentrazione ×2 + blocchi + giorni di fila ×5) o per punti di sempre (i punti dei livelli),
 * nel mondo o fra gli amici. Nome e numeri sono l'unica cosa che esce dal telefono. */

const NAME_MAX = 24;
const BOARD_MAX = 50;
/* i giorni di Premium che il pass ospite regala a chi invita e a chi entra */
export const PASS_GIORNI = Math.max(1, Math.floor(Number(process.env.FOCUSLOCK_PASS_GIORNI || 14)));

let tableReady: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_players (
        device VARCHAR(64) PRIMARY KEY,
        name VARCHAR(40) NOT NULL,
        code VARCHAR(8) NOT NULL UNIQUE,
        level INT NOT NULL DEFAULT 1,
        xp INT NOT NULL DEFAULT 0,
        streak INT NOT NULL DEFAULT 0,
        ffMin7 INT NOT NULL DEFAULT 0,
        blocks7 INT NOT NULL DEFAULT 0,
        score7 INT NOT NULL DEFAULT 0,
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        INDEX idx_score7 (score7),
        INDEX idx_xp (xp)
      )`);
      // columns added after the first release: MySQL has no IF NOT EXISTS for columns
      for (const col of ["strictOn TINYINT NOT NULL DEFAULT 0", "bestFocusH INT NOT NULL DEFAULT 0", "bestStreak INT NOT NULL DEFAULT 0", "motto VARCHAR(191) NOT NULL DEFAULT ''",
        // l'obiettivo scelto nell'oracolo: e' la "categoria" della classifica, come i pesi
        // nelle arti marziali — un consiglio vale se viene da chi sta correndo la tua stessa gara
        "goal VARCHAR(24) NOT NULL DEFAULT ''", "decisions INT NOT NULL DEFAULT 0", "profile VARCHAR(16) NOT NULL DEFAULT ''",
        // la pagina Amici del 27/09/2026: soprannome per la lega, pass ospite a un codice solo,
        // gli aggregati che gli amici vedono (e solo quelli), i punti della lega, le sfide attive
        "nick VARCHAR(24) NOT NULL DEFAULT ''", "premiumUntil DATETIME NULL", "ffStreak INT NOT NULL DEFAULT 0",
        "neo INT NOT NULL DEFAULT 0", "old INT NOT NULL DEFAULT 0", "prevScore7 INT NOT NULL DEFAULT 0",
        "legaPunti INT NOT NULL DEFAULT 0", "legaSettimana VARCHAR(10) NOT NULL DEFAULT ''", "legaOptIn TINYINT NOT NULL DEFAULT 0",
        "tier VARCHAR(12) NOT NULL DEFAULT 'bronzo'", "sfide TEXT NULL"]) {
        try { await db.execute(sql.raw("ALTER TABLE focuslock_players ADD COLUMN " + col)); } catch { /* already there */ }
      }
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_friends (
        device VARCHAR(64) NOT NULL,
        friend VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP NULL,
        PRIMARY KEY (device, friend)
      )`);
      /* Il diario di viaggio: le pagine che l'app scrive da sola (traguardi, sessioni, passi
         della rotta, lettere dell'Io Futuro). Sta qui solo se la persona lo rende pubblico, e
         lo sfogliano solo i suoi amici. Niente foto: restano sul telefono. */
      /* Il pass ospite a un codice solo: chi aggiunge un amico col codice regala 14 giorni a
         tutti e due, una volta per coppia. */
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_pass_grants (
        device VARCHAR(64) NOT NULL,
        friend VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP NULL,
        PRIMARY KEY (device, friend)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_diari (
        device VARCHAR(64) PRIMARY KEY,
        pubblico TINYINT NOT NULL DEFAULT 0,
        pagine MEDIUMTEXT,
        updatedAt TIMESTAMP NULL
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}
export async function rows(q: any): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const res: any = await db.execute(q);
  const out = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  return Array.isArray(out) ? out.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)) : [];
}
function code(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
const n = (v: any, max = 1e7) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
function score7Of(p: { ffMin7: number; blocks7: number; streak: number }): number {
  return p.ffMin7 * 2 + p.blocks7 + p.streak * 5;
}
function pub(r: any, me: string) {
  return { device: r.device, name: r.name, level: Number(r.level || 1), score7: Number(r.score7 || 0), xp: Number(r.xp || 0), streak: Number(r.streak || 0),
    bestFocusH: Number(r.bestFocusH || 0), bestStreak: Number(r.bestStreak || 0), motto: String(r.motto || ""),
    goal: String(r.goal || ""), decisions: Number(r.decisions || 0), profile: String(r.profile || ""), me: r.device === me };
}

/* How many phones have the app, and how many have strict mode on right now (heard from in
   the last twenty minutes). The number the Severa tab shows, like a meditation app's "people
   meditating now". */
async function liveCounts() {
  const total = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players`);
  const strictNow = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE strictOn = 1 AND updatedAt > (NOW() - INTERVAL 20 MINUTE)`);
  const strictAny = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE strictOn = 1`);
  return { installs: Number(total[0]?.k || 0), strictNow: Number(strictNow[0]?.k || 0), strictOn: Number(strictAny[0]?.k || 0) };
}

export function registerFocusLockSocialRoutes(app: Express) {
  app.get("/api/focuslock/social/live", async (_req: Request, res: Response) => {
    try { await ensureTables(); res.json(await liveCounts()); }
    catch (e: any) { res.status(500).json({ error: e?.message || "non disponibile" }); }
  });

  /* The player's numbers, in; their code and standing, out. */
  app.post("/api/focuslock/social/sync", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    // A name is what puts a player on the board; without one the phone still counts as an
    // install and, when its strict mode is on, as one of the people "in it right now".
    const name = String(b.name || "").trim().slice(0, NAME_MAX);
    if (!device) { res.status(400).json({ error: "device obbligatorio" }); return; }
    const p = { level: n(b.level, 10) || 1, xp: n(b.xp), streak: n(b.streak, 5000), ffMin7: n(b.ffMin7, 10080), blocks7: n(b.blocks7, 100000),
      strictOn: b.strictOn ? 1 : 0, bestFocusH: n(b.bestFocusH, 24), bestStreak: n(b.bestStreak, 5000),
      motto: String(b.motto || "").trim().slice(0, 160),
      goal: String(b.goal || "").trim().slice(0, 24),
      decisions: Math.max(0, Math.min(999999, Number(b.decisions) || 0)),
      profile: String(b.profile || "").trim().slice(0, 16),
      nick: String(b.nick || "").trim().slice(0, 24),
      ffStreak: n(b.ffStreak, 5000), neo: n(b.neo, 100000), old: n(b.old, 100000), prevScore7: n(b.prevScore7, 10000000),
      legaPunti: n(b.legaPunti, 100000), legaSettimana: String(b.legaSettimana || "").slice(0, 10),
      sfide: Array.isArray(b.sfide) ? JSON.stringify(b.sfide.slice(0, 20).map((s: any) => ({ id: String(s?.id || "").slice(0, 40), stato: String(s?.stato || "").slice(0, 12) }))) : null };
    const score7 = score7Of(p);
    try {
      await ensureTables();
      const cur = await rows(sql`SELECT code FROM focuslock_players WHERE device = ${device}`);
      let c = cur[0]?.code as string | undefined;
      if (!c) {
        for (let i = 0; i < 5 && !c; i++) {
          const cand = code();
          const clash = await rows(sql`SELECT device FROM focuslock_players WHERE code = ${cand}`);
          if (!clash.length) c = cand;
        }
        if (!c) throw new Error("codice non generabile");
        await rows(sql`INSERT INTO focuslock_players (device, name, code, level, xp, streak, ffMin7, blocks7, score7, strictOn, bestFocusH, bestStreak, motto, goal, decisions, profile, createdAt, updatedAt)
          VALUES (${device}, ${name}, ${c}, ${p.level}, ${p.xp}, ${p.streak}, ${p.ffMin7}, ${p.blocks7}, ${score7}, ${p.strictOn}, ${p.bestFocusH}, ${p.bestStreak}, ${p.motto}, ${p.goal}, ${p.decisions}, ${p.profile}, NOW(), NOW())`);
      } else {
        await rows(sql`UPDATE focuslock_players SET name = ${name}, level = ${p.level}, xp = ${p.xp}, streak = ${p.streak}, ffMin7 = ${p.ffMin7}, blocks7 = ${p.blocks7}, score7 = ${score7},
          strictOn = ${p.strictOn}, bestFocusH = ${p.bestFocusH}, bestStreak = ${p.bestStreak}, motto = ${p.motto}, goal = ${p.goal}, decisions = ${p.decisions}, profile = ${p.profile}, updatedAt = NOW() WHERE device = ${device}`);
      }
      /* gli aggregati sociali e i punti della lega: colonne aggiunte dopo, si aggiornano a parte */
      try {
        await rows(sql`UPDATE focuslock_players SET nick = ${p.nick}, ffStreak = ${p.ffStreak}, neo = ${p.neo}, old = ${p.old}, prevScore7 = ${p.prevScore7},
          legaPunti = ${p.legaPunti}, legaSettimana = ${p.legaSettimana}, sfide = ${p.sfide} WHERE device = ${device}`);
        if (p.legaSettimana) await rows(sql`UPDATE focuslock_lega_membri SET punti = ${p.legaPunti}, nick = ${p.nick} WHERE settimana = ${p.legaSettimana} AND device = ${device}`);
        if (p.sfide) {
          const lista = JSON.parse(p.sfide) as { id: string; stato: string }[];
          for (const s of lista) if (s.id) await rows(sql`INSERT INTO focuslock_sfide (device, sfidaId, stato, createdAt, updatedAt) VALUES (${device}, ${s.id}, ${s.stato || "attiva"}, NOW(), NOW()) ON DUPLICATE KEY UPDATE stato = VALUES(stato), updatedAt = NOW()`);
        }
      } catch (e: any) { console.warn("[social] aggregati:", e?.message || e); }
      const above7 = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND score7 > ${score7}`);
      const aboveAll = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND xp > ${p.xp}`);
      const total = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> ''`);
      const live = await liveCounts();
      let extra: any = {};
      try {
        const me = await rows(sql`SELECT premiumUntil, nick, tier, legaOptIn FROM focuslock_players WHERE device = ${device}`);
        const reaz = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_reazioni WHERE a = ${device} AND createdAt > (NOW() - INTERVAL 7 DAY)`);
        extra = { premiumUntil: me[0]?.premiumUntil ? new Date(me[0].premiumUntil).toISOString() : null, nick: String(me[0]?.nick || ""), tier: String(me[0]?.tier || "bronzo"),
          legaOptIn: !!Number(me[0]?.legaOptIn || 0), reazioni7: Number(reaz[0]?.k || 0) };
      } catch { /* colonne non ancora pronte */ }
      res.json(Object.assign({ ok: true, code: c, score7, rank7: Number(above7[0]?.k || 0) + 1, rankAll: Number(aboveAll[0]?.k || 0) + 1, players: Number(total[0]?.k || 0), live }, extra));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sync fallito" });
    }
  });

  /* The board: the world or the friends, by the week or by everything. */
  app.get("/api/focuslock/social/board", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    const scope = req.query.scope === "friends" ? "friends" : "global";
    const period = req.query.period === "all" ? "all" : "week";
    // "goal" chiede la classifica di chi corre la stessa gara. Se e' quasi deserta non serve a
    // niente confrontarsi, quindi sotto una certa soglia si ricade sulla classifica di tutti e
    // lo si dice, invece di mostrare un podio di due persone.
    const goal = String(req.query.goal || "").trim().slice(0, 24);
    const MIN_PEERS = 5;
    try {
      await ensureTables();
      let list: any[];
      let fellBack = false;
      if (scope === "friends") {
        list = period === "all"
          ? await rows(sql`SELECT p.* FROM focuslock_players p WHERE p.device = ${device} OR p.device IN (SELECT friend FROM focuslock_friends WHERE device = ${device}) ORDER BY p.xp DESC, p.updatedAt DESC LIMIT ${BOARD_MAX}`)
          : await rows(sql`SELECT p.* FROM focuslock_players p WHERE p.device = ${device} OR p.device IN (SELECT friend FROM focuslock_friends WHERE device = ${device}) ORDER BY p.score7 DESC, p.updatedAt DESC LIMIT ${BOARD_MAX}`);
      } else if (goal) {
        const n = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND goal = ${goal}`);
        if (Number(n[0]?.k || 0) >= MIN_PEERS) {
          list = period === "all"
            ? await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' AND goal = ${goal} ORDER BY xp DESC, updatedAt DESC LIMIT ${BOARD_MAX}`)
            : await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' AND goal = ${goal} ORDER BY score7 DESC, updatedAt DESC LIMIT ${BOARD_MAX}`);
        } else {
          list = period === "all"
            ? await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' ORDER BY xp DESC, updatedAt DESC LIMIT ${BOARD_MAX}`)
            : await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' ORDER BY score7 DESC, updatedAt DESC LIMIT ${BOARD_MAX}`);
          fellBack = true;
        }
      } else {
        list = period === "all"
          ? await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' ORDER BY xp DESC, updatedAt DESC LIMIT ${BOARD_MAX}`)
          : await rows(sql`SELECT * FROM focuslock_players WHERE name <> '' ORDER BY score7 DESC, updatedAt DESC LIMIT ${BOARD_MAX}`);
      }
      const out = list.map((r) => pub(r, device));
      let me: any = null;
      if (device) {
        const mine = await rows(sql`SELECT * FROM focuslock_players WHERE device = ${device}`);
        if (mine[0]) {
          const m = mine[0];
          const key = period === "all" ? "xp" : "score7";
          const val = Number(m[key] || 0);
          const above = scope === "friends"
            ? await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE ${sql.raw(key)} > ${val} AND device IN (SELECT friend FROM focuslock_friends WHERE device = ${device})`)
            : (goal && !fellBack
                ? await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND goal = ${goal} AND ${sql.raw(key)} > ${val}`)
                : await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND ${sql.raw(key)} > ${val}`));
          me = Object.assign(pub(m, device), { rank: Number(above[0]?.k || 0) + 1, code: m.code });
        }
      }
      const total = scope === "friends"
        ? await rows(sql`SELECT COUNT(*) + 1 AS k FROM focuslock_friends WHERE device = ${device}`)
        : (goal && !fellBack
            ? await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND goal = ${goal}`)
            : await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> ''`));
      res.json({ scope, period, goal: goal && !fellBack ? goal : "", fellBack, rows: out, me, total: Number(total[0]?.k || 0) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "classifica non disponibile" });
    }
  });

  /* A friend by code, both ways. */
  app.post("/api/focuslock/social/friend", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const c = String(b.code || "").trim().toUpperCase().slice(0, 8);
    if (!device || !c) { res.status(400).json({ error: "codice mancante" }); return; }
    try {
      await ensureTables();
      const f = await rows(sql`SELECT device, name FROM focuslock_players WHERE code = ${c}`);
      if (!f[0]) { res.status(404).json({ error: "nessuno con questo codice" }); return; }
      if (f[0].device === device) { res.status(400).json({ error: "è il tuo codice" }); return; }
      await rows(sql`INSERT IGNORE INTO focuslock_friends (device, friend, createdAt) VALUES (${device}, ${f[0].device}, NOW())`);
      await rows(sql`INSERT IGNORE INTO focuslock_friends (device, friend, createdAt) VALUES (${f[0].device}, ${device}, NOW())`);
      /* IL PASS OSPITE, UNA VOLTA PER COPPIA. Chi entra con il codice di un amico regala
         quattordici giorni di Premium a tutti e due. Il proprio codice e' escluso sopra; la
         tabella dei grant ferma la seconda volta. */
      let premiumUntil: string | null = null;
      let pass = false;
      try {
        const a = device < f[0].device ? device : f[0].device, bb = device < f[0].device ? f[0].device : device;
        const gia = await rows(sql`SELECT 1 AS k FROM focuslock_pass_grants WHERE device = ${a} AND friend = ${bb} LIMIT 1`);
        if (!gia.length) {
          await rows(sql`INSERT IGNORE INTO focuslock_pass_grants (device, friend, createdAt) VALUES (${a}, ${bb}, NOW())`);
          for (const d of [device, f[0].device]) {
            await rows(sql`UPDATE focuslock_players SET premiumUntil = DATE_ADD(GREATEST(COALESCE(premiumUntil, NOW()), NOW()), INTERVAL ${PASS_GIORNI} DAY) WHERE device = ${d}`);
          }
          pass = true;
        }
        const me = await rows(sql`SELECT premiumUntil FROM focuslock_players WHERE device = ${device}`);
        premiumUntil = me[0]?.premiumUntil ? new Date(me[0].premiumUntil).toISOString() : null;
      } catch (e: any) { console.warn("[social] pass:", e?.message || e); }
      res.json({ ok: true, friend: { device: f[0].device, name: f[0].name }, pass, passDays: PASS_GIORNI, premiumUntil });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "amico non aggiunto" });
    }
  });

  /* Il diario di viaggio: si pubblica (o si ritira) e si legge, solo fra amici. */
  app.post("/api/focuslock/social/diario", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    const pubblico = b.pubblico ? 1 : 0;
    let pagine = "[]";
    try {
      const arr = Array.isArray(b.pagine) ? b.pagine.slice(0, 300) : [];
      pagine = JSON.stringify(arr.map((p: any) => ({
        id: String(p?.id || "").slice(0, 40), tipo: String(p?.tipo || "").slice(0, 24), t: Number(p?.t) || 0,
        titolo: String(p?.titolo || "").slice(0, 120), testo: String(p?.testo || "").slice(0, 1200),
        nota: String(p?.nota || "").slice(0, 200), ico: String(p?.ico || "").slice(0, 8),
      })));
      if (pagine.length > 900_000) pagine = pagine.slice(0, 900_000);
    } catch { pagine = "[]"; }
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_diari (device, pubblico, pagine, updatedAt) VALUES (${device}, ${pubblico}, ${pubblico ? pagine : ""}, NOW())
        ON DUPLICATE KEY UPDATE pubblico = VALUES(pubblico), pagine = VALUES(pagine), updatedAt = NOW()`);
      res.json({ ok: true, pubblico: !!pubblico });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "diario non salvato" });
    }
  });
  app.get("/api/focuslock/social/diario", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    const of = String(req.query.of || "").slice(0, 64);
    if (!device || !of) { res.status(400).json({ error: "parametri mancanti" }); return; }
    try {
      await ensureTables();
      const amici = await rows(sql`SELECT 1 AS k FROM focuslock_friends WHERE device = ${device} AND friend = ${of} LIMIT 1`);
      if (!amici.length && device !== of) { res.status(403).json({ error: "non siete amici" }); return; }
      const d = await rows(sql`SELECT d.pubblico, d.pagine, d.updatedAt, p.name FROM focuslock_diari d JOIN focuslock_players p ON p.device = d.device WHERE d.device = ${of} LIMIT 1`);
      if (!d[0] || !Number(d[0].pubblico)) { res.json({ pubblico: false, pagine: [] }); return; }
      let pagine: any[] = [];
      try { pagine = JSON.parse(String(d[0].pagine || "[]")); } catch { pagine = []; }
      res.json({ pubblico: true, nome: String(d[0].name || ""), pagine, updatedAt: d[0].updatedAt });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "diario non disponibile" });
    }
  });

  app.post("/api/focuslock/social/unfriend", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = String(b.device || "").slice(0, 64);
    const friend = String(b.friend || "").slice(0, 64);
    if (!device || !friend) { res.status(400).json({ error: "dati mancanti" }); return; }
    try {
      await ensureTables();
      await rows(sql`DELETE FROM focuslock_friends WHERE (device = ${device} AND friend = ${friend}) OR (device = ${friend} AND friend = ${device})`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "rimozione fallita" });
    }
  });

  app.get("/api/focuslock/social/friends", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    try {
      await ensureTables();
      const list = await rows(sql`SELECT p.device, p.name, p.level, p.score7, p.xp, p.streak FROM focuslock_friends f JOIN focuslock_players p ON p.device = f.friend WHERE f.device = ${device} ORDER BY p.score7 DESC`);
      res.json({ friends: list.map((r) => pub(r, device)) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "amici non disponibili" });
    }
  });
}
