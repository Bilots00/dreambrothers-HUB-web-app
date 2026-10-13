import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "../db";
import { rows, ensureTables as ensureSocial } from "./focuslockSocial";

/* FocusLock / The Dream Map: la prova sociale in tempo reale e la catena dei sogni accesi.
 *
 * DATI. Il telefono manda un battito ogni 60 secondi mentre una sessione di Full Focus e' in
 * corso o mentre si sta facendo un livello della mappa, piu' gli eventi che contano (un
 * livello superato, la prima sessione da almeno 25 minuti). Il server tiene SOLO stati e date
 * per id casuale del telefono (lo stesso di focuslock_players) e restituisce SOLO conteggi:
 * nessun nome, nessun id, nessun testo libero. La categoria e' una di sette chiavi fisse,
 * ricavate dal telefono dai tag della lettura del Genio, mai dalle parole dell'utente.
 *
 * SOGNO ACCESO. Chi e' entrato con il codice di un amico (pass ospite di focuslockSocial,
 * entro 7 giorni dalla nascita del suo giocatore) e, entro 7 giorni dalla nascita, ha finito
 * un Full Focus da almeno 25 minuti oppure il primo livello della mappa. Scaricare l'app non
 * basta. La direzione dell'invito si ricava dalla coppia del pass: e' invitato chi e' nato
 * dopo, e l'invito e' arrivato entro 7 giorni dalla sua nascita. Gli archi vanno quindi sempre
 * dal piu' vecchio al piu' nuovo: la catena non puo' fare cerchi.
 *
 * La catena di una persona = tutti i discendenti accesi, a qualunque profondita'. Il premio
 * (il pass di 14 giorni) resta solo quello diretto, gia' dato da focuslockSocial: qui le
 * generazioni dopo sono solo un numero. */

const LIVE_SECONDI = 120;          // "adesso" = un battito negli ultimi 2 minuti
const FINESTRA_GIORNI = 7;         // l'invito e l'accensione contano entro 7 giorni dalla nascita
const CACHE_MS = 15_000;           // gli aggregati si ricalcolano al massimo ogni 15 secondi
const CATEGORIE = ["business", "studio", "fitness", "creativita", "carriera", "viaggi", "fede"] as const;
const PROFONDITA_MAX = 60;
const NODI_MAX = 50_000;

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureSocial();
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_sp_presenza (
        device VARCHAR(64) PRIMARY KEY,
        stato VARCHAR(8) NOT NULL DEFAULT '',
        categoria VARCHAR(16) NOT NULL DEFAULT '',
        lastAt DATETIME NULL,
        INDEX idx_sp_last (lastAt)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_sp_giorni (
        device VARCHAR(64) NOT NULL,
        giorno CHAR(10) NOT NULL,
        focus TINYINT NOT NULL DEFAULT 0,
        cammino TINYINT NOT NULL DEFAULT 0,
        livello TINYINT NOT NULL DEFAULT 0,
        PRIMARY KEY (device, giorno),
        INDEX idx_sp_giorno (giorno)
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_sp_primi (
        device VARCHAR(64) PRIMARY KEY,
        focus25At DATETIME NULL,
        livelloAt DATETIME NULL
      )`);
      await db.execute(sql`CREATE TABLE IF NOT EXISTS focuslock_sp_inviti (
        invitato VARCHAR(64) PRIMARY KEY,
        invitante VARCHAR(64) NOT NULL,
        invitatoAt DATETIME NULL,
        accesoAt DATETIME NULL,
        INDEX idx_sp_invitante (invitante, accesoAt)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* il giorno di oggi a Roma: "oggi" e' lo stesso per tutti, quello del pubblico dell'app */
function giornoRoma(t: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}
const okDevice = (d: any) => { const s = String(d || "").slice(0, 64); return /^[A-Za-z0-9_.:-]{4,64}$/.test(s) ? s : ""; };
const num = (v: any) => Number(v || 0) || 0;
const idOpaco = (a: string, b: string) => createHash("sha256").update(a + ":" + b).digest("hex").slice(0, 12);

/* ---------------------------------------------------------------- gli aggregati */
let cache: { at: number; dati: any } | null = null;
async function aggregati() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.dati;
  const oggi = giornoRoma();
  const live = await rows(sql`SELECT stato, categoria, COUNT(*) AS k FROM focuslock_sp_presenza
    WHERE lastAt > (NOW() - INTERVAL ${LIVE_SECONDI} SECOND) AND stato IN ('focus', 'path') GROUP BY stato, categoria`);
  const perCat: Record<string, number> = {};
  for (const c of CATEGORIE) perCat[c] = 0;
  let focusOra = 0, camminoOra = 0;
  for (const r of live) {
    const k = num(r.k);
    if (r.stato === "focus") {
      focusOra += k;
      if ((CATEGORIE as readonly string[]).includes(String(r.categoria))) perCat[String(r.categoria)] += k;
    } else camminoOra += k;
  }
  const g = await rows(sql`SELECT SUM(focus > 0) AS f, SUM(livello > 0) AS l, COUNT(*) AS t FROM focuslock_sp_giorni WHERE giorno = ${oggi}`);
  const accesi = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_sp_inviti WHERE accesoAt IS NOT NULL`);
  const dati = {
    active_focus_now: focusOra,
    on_path_now: camminoOra,
    levels_passed_today: num(g[0]?.l),
    focus_today: num(g[0]?.f),
    worked_on_dream_today: num(g[0]?.t),
    active_by_category_now: perCat,
    dreams_lit: num(accesi[0]?.k),
    giorno: oggi,
  };
  cache = { at: Date.now(), dati };
  return dati;
}

/* ---------------------------------------------------------------- la catena */
/* L'invito, ricavato dal pass ospite: la coppia piu' vecchia in cui questo telefono e' il
   nuovo arrivato e il codice e' stato usato entro 7 giorni dalla sua nascita. */
async function ricavaInvito(device: string) {
  const gia = await rows(sql`SELECT invitante FROM focuslock_sp_inviti WHERE invitato = ${device} LIMIT 1`);
  if (gia.length) return;
  await rows(sql`INSERT IGNORE INTO focuslock_sp_inviti (invitato, invitante, invitatoAt)
    SELECT ${device}, o.device, g.createdAt
    FROM focuslock_pass_grants g
    JOIN focuslock_players me ON me.device = ${device}
    JOIN focuslock_players o ON o.device = IF(g.device = ${device}, g.friend, g.device)
    WHERE (g.device = ${device} OR g.friend = ${device})
      AND me.createdAt IS NOT NULL AND o.createdAt IS NOT NULL AND g.createdAt IS NOT NULL
      AND o.createdAt < me.createdAt
      AND g.createdAt <= (me.createdAt + INTERVAL ${FINESTRA_GIORNI} DAY)
    ORDER BY g.createdAt ASC LIMIT 1`);
}
/* Acceso: la prima prova (Full Focus da 25 minuti o primo livello) entro 7 giorni dalla nascita. */
async function aggiornaAcceso(device: string) {
  await rows(sql`UPDATE focuslock_sp_inviti i
    JOIN focuslock_players p ON p.device = i.invitato
    JOIN focuslock_sp_primi s ON s.device = i.invitato
    SET i.accesoAt = LEAST(COALESCE(s.focus25At, '9999-12-31 00:00:00'), COALESCE(s.livelloAt, '9999-12-31 00:00:00'))
    WHERE i.invitato = ${device} AND i.accesoAt IS NULL AND p.createdAt IS NOT NULL
      AND LEAST(COALESCE(s.focus25At, '9999-12-31 00:00:00'), COALESCE(s.livelloAt, '9999-12-31 00:00:00')) <= (p.createdAt + INTERVAL ${FINESTRA_GIORNI} DAY)
      AND LEAST(COALESCE(s.focus25At, '9999-12-31 00:00:00'), COALESCE(s.livelloAt, '9999-12-31 00:00:00')) >= (p.createdAt - INTERVAL 1 DAY)`);
  cache = null;
}

/* I discendenti accesi di una radice, generazione per generazione. */
async function generazioni(radice: string): Promise<string[][]> {
  const out: string[][] = [];
  let fronte = [radice];
  let visti = 0;
  for (let d = 0; d < PROFONDITA_MAX && fronte.length && visti < NODI_MAX; d++) {
    const figli: string[] = [];
    for (let i = 0; i < fronte.length; i += 500) {
      const pezzo = fronte.slice(i, i + 500);
      const r = await rows(sql`SELECT invitato FROM focuslock_sp_inviti WHERE accesoAt IS NOT NULL AND invitante IN (${sql.join(pezzo.map((x) => sql`${x}`), sql`, `)})`);
      for (const x of r) figli.push(String(x.invitato));
    }
    if (!figli.length) break;
    out.push(figli);
    visti += figli.length;
    fronte = figli;
  }
  return out;
}

async function laMiaCatena(me: string) {
  const diretti = await rows(sql`SELECT i.invitato, i.accesoAt, p.name, p.nick, f.friend AS amico
    FROM focuslock_sp_inviti i
    LEFT JOIN focuslock_players p ON p.device = i.invitato
    LEFT JOIN focuslock_friends f ON f.device = ${me} AND f.friend = i.invitato
    WHERE i.invitante = ${me} AND i.accesoAt IS NOT NULL
    ORDER BY i.accesoAt ASC LIMIT 500`);
  const attesa = await rows(sql`SELECT COUNT(*) AS k FROM focuslock_sp_inviti WHERE invitante = ${me} AND accesoAt IS NULL`);
  let catena = diretti.length;
  const albero: any[] = [];
  for (let k = 0; k < diretti.length; k++) {
    const d = diretti[k];
    const gen = await generazioni(String(d.invitato));
    const sotto = gen.reduce((a, g) => a + g.length, 0);
    catena += sotto;
    if (k < 3) {
      /* il nome solo se e' un amico nell'app, e solo la prima parola; le generazioni dopo restano anonime */
      const nome = d.amico ? String(d.nick || d.name || "").trim().split(/\s+/)[0].slice(0, 24) : "";
      albero.push({ id: idOpaco(me, String(d.invitato)), nome: nome || null, gen2: gen[0]?.length || 0, gen3: gen[1]?.length || 0, oltre: gen.slice(2).reduce((a, g) => a + g.length, 0) });
    }
  }
  /* gli id opachi di tutti i diretti, per gli avvisi "ha acceso il suo sogno grazie a te" */
  const accesi = diretti.map((d) => ({ id: idOpaco(me, String(d.invitato)), nome: d.amico ? String(d.nick || d.name || "").trim().split(/\s+/)[0].slice(0, 24) || null : null }));
  return { diretti: diretti.length, catena, albero, altri: Math.max(0, diretti.length - 3), accesi, inAttesa: num(attesa[0]?.k) };
}

/* ---------------------------------------------------------------- le rotte */
export function registerFocusLockSocialProofRoutes(app: Express) {
  /* Il battito: stato attuale (focus | path | niente), categoria fissa, eventi che contano. */
  app.post("/api/focuslock/socialproof/battito", async (req: Request, res: Response) => {
    const b = req.body || {};
    const device = okDevice(b.device);
    if (!device) { res.status(400).json({ error: "device mancante" }); return; }
    const stato = b.stato === "focus" || b.stato === "path" ? String(b.stato) : "";
    const cat = (CATEGORIE as readonly string[]).includes(String(b.cat || "")) ? String(b.cat) : "";
    const ora = Date.now();
    const eventi = (Array.isArray(b.eventi) ? b.eventi : []).slice(0, 20)
      .map((e: any) => ({ tipo: String(e?.tipo || ""), at: Math.round(Number(e?.at) || 0) }))
      .filter((e: any) => (e.tipo === "livello" || e.tipo === "focus25") && e.at > ora - 400 * 86400000 && e.at <= ora + 120000)
      .map((e: any) => ({ tipo: e.tipo, at: Math.min(e.at, ora) }));
    try {
      await ensureTables();
      await rows(sql`INSERT INTO focuslock_sp_presenza (device, stato, categoria, lastAt) VALUES (${device}, ${stato}, ${cat}, NOW())
        ON DUPLICATE KEY UPDATE stato = VALUES(stato), categoria = VALUES(categoria), lastAt = NOW()`);
      const oggi = giornoRoma(ora);
      if (stato === "focus") await rows(sql`INSERT INTO focuslock_sp_giorni (device, giorno, focus) VALUES (${device}, ${oggi}, 1) ON DUPLICATE KEY UPDATE focus = 1`);
      if (stato === "path") await rows(sql`INSERT INTO focuslock_sp_giorni (device, giorno, cammino) VALUES (${device}, ${oggi}, 1) ON DUPLICATE KEY UPDATE cammino = 1`);
      for (const e of eventi) {
        const sec = Math.floor(e.at / 1000);
        if (e.tipo === "livello") {
          /* il livello conta per "oggi" solo se e' di oggi o di ieri sera (il telefono era offline) */
          if (ora - e.at < 2 * 86400000) {
            const g = giornoRoma(e.at);
            await rows(sql`INSERT INTO focuslock_sp_giorni (device, giorno, livello) VALUES (${device}, ${g}, 1) ON DUPLICATE KEY UPDATE livello = 1`);
          }
          await rows(sql`INSERT INTO focuslock_sp_primi (device, livelloAt) VALUES (${device}, FROM_UNIXTIME(${sec}))
            ON DUPLICATE KEY UPDATE livelloAt = IF(livelloAt IS NULL OR FROM_UNIXTIME(${sec}) < livelloAt, FROM_UNIXTIME(${sec}), livelloAt)`);
        } else {
          if (ora - e.at < 2 * 86400000) {
            const g = giornoRoma(e.at);
            await rows(sql`INSERT INTO focuslock_sp_giorni (device, giorno, focus) VALUES (${device}, ${g}, 1) ON DUPLICATE KEY UPDATE focus = 1`);
          }
          await rows(sql`INSERT INTO focuslock_sp_primi (device, focus25At) VALUES (${device}, FROM_UNIXTIME(${sec}))
            ON DUPLICATE KEY UPDATE focus25At = IF(focus25At IS NULL OR FROM_UNIXTIME(${sec}) < focus25At, FROM_UNIXTIME(${sec}), focus25At)`);
        }
      }
      try { await ricavaInvito(device); await aggiornaAcceso(device); } catch (e: any) { console.warn("[socialproof] catena:", e?.message || e); }
      if (stato || eventi.length) cache = null;
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "battito non registrato" });
    }
  });

  /* Gli aggregati per tutti; con il device, anche la propria catena (solo conteggi, e i nomi
     dei soli inviti diretti che sono amici nell'app). */
  app.get("/api/focuslock/socialproof/stato", async (req: Request, res: Response) => {
    const device = okDevice(req.query.device);
    try {
      await ensureTables();
      const dati: any = Object.assign({ ok: true, at: new Date().toISOString(), live_seconds: LIVE_SECONDI }, await aggregati());
      if (device) {
        try { await ricavaInvito(device); await aggiornaAcceso(device); } catch { /* il resto risponde lo stesso */ }
        dati.me = await laMiaCatena(device);
      }
      res.json(dati);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "non disponibile" });
    }
  });
}
