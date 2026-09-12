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

let tableReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
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
      for (const col of ["strictOn TINYINT NOT NULL DEFAULT 0", "bestFocusH INT NOT NULL DEFAULT 0", "bestStreak INT NOT NULL DEFAULT 0"]) {
        try { await db.execute(sql.raw("ALTER TABLE focuslock_players ADD COLUMN " + col)); } catch { /* already there */ }
      }
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_friends (
        device VARCHAR(64) NOT NULL,
        friend VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP NULL,
        PRIMARY KEY (device, friend)
      )`);
    })().catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}
async function rows(q: any): Promise<any[]> {
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
    bestFocusH: Number(r.bestFocusH || 0), bestStreak: Number(r.bestStreak || 0), me: r.device === me };
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
      strictOn: b.strictOn ? 1 : 0, bestFocusH: n(b.bestFocusH, 24), bestStreak: n(b.bestStreak, 5000) };
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
        await rows(sql`INSERT INTO focuslock_players (device, name, code, level, xp, streak, ffMin7, blocks7, score7, strictOn, bestFocusH, bestStreak, createdAt, updatedAt)
          VALUES (${device}, ${name}, ${c}, ${p.level}, ${p.xp}, ${p.streak}, ${p.ffMin7}, ${p.blocks7}, ${score7}, ${p.strictOn}, ${p.bestFocusH}, ${p.bestStreak}, NOW(), NOW())`);
      } else {
        await rows(sql`UPDATE focuslock_players SET name = ${name}, level = ${p.level}, xp = ${p.xp}, streak = ${p.streak}, ffMin7 = ${p.ffMin7}, blocks7 = ${p.blocks7}, score7 = ${score7},
          strictOn = ${p.strictOn}, bestFocusH = ${p.bestFocusH}, bestStreak = ${p.bestStreak}, updatedAt = NOW() WHERE device = ${device}`);
      }
      const above7 = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND score7 > ${score7}`);
      const aboveAll = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND xp > ${p.xp}`);
      const total = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> ''`);
      const live = await liveCounts();
      res.json({ ok: true, code: c, score7, rank7: Number(above7[0]?.k || 0) + 1, rankAll: Number(aboveAll[0]?.k || 0) + 1, players: Number(total[0]?.k || 0), live });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sync fallito" });
    }
  });

  /* The board: the world or the friends, by the week or by everything. */
  app.get("/api/focuslock/social/board", async (req: Request, res: Response) => {
    const device = String(req.query.device || "").slice(0, 64);
    const scope = req.query.scope === "friends" ? "friends" : "global";
    const period = req.query.period === "all" ? "all" : "week";
    try {
      await ensureTables();
      let list: any[];
      if (scope === "friends") {
        list = period === "all"
          ? await rows(sql`SELECT p.* FROM focuslock_players p WHERE p.device = ${device} OR p.device IN (SELECT friend FROM focuslock_friends WHERE device = ${device}) ORDER BY p.xp DESC, p.updatedAt DESC LIMIT ${BOARD_MAX}`)
          : await rows(sql`SELECT p.* FROM focuslock_players p WHERE p.device = ${device} OR p.device IN (SELECT friend FROM focuslock_friends WHERE device = ${device}) ORDER BY p.score7 DESC, p.updatedAt DESC LIMIT ${BOARD_MAX}`);
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
            : await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> '' AND ${sql.raw(key)} > ${val}`);
          me = Object.assign(pub(m, device), { rank: Number(above[0]?.k || 0) + 1, code: m.code });
        }
      }
      const total = scope === "friends"
        ? await rows(sql`SELECT COUNT(*) + 1 AS k FROM focuslock_friends WHERE device = ${device}`)
        : await rows(sql`SELECT COUNT(*) AS k FROM focuslock_players WHERE name <> ''`);
      res.json({ scope, period, rows: out, me, total: Number(total[0]?.k || 0) });
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
      res.json({ ok: true, friend: { device: f[0].device, name: f[0].name } });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "amico non aggiunto" });
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
