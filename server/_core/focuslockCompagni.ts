import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { rows } from "./focuslockSocial";
import { whoIs, isIdentity } from "./focuslockRoutes";

/* FocusLock / DreamMap — LE SESSIONI IN COPPIA (app 0.9.285), come Focusmate.
 *
 * Andrea: "voglio replicare le stesse funzioni di Focusmate". Dal codice della loro app (le pagine
 * della prenotazione, booking-hub-session-settings e booking-hub-task-form): si prenota una sessione
 * di 25, 50 o 75 minuti che comincia a un quarto d'ora preciso; si sceglie il tipo di lavoro
 * (alla scrivania, in movimento, qualsiasi), la modalita' silenziosa (senza microfono) e se
 * preferire i preferiti; si scrivono i compiti della sessione. L'app trova il compagno: un'altra
 * persona con la stessa ora e la stessa durata. All'ora giusta si entra nella stanza: video tra
 * i due telefoni (WebRTC, da telefono a telefono: il server passa solo i messaggi per collegarsi),
 * il tempo, i compiti di tutti e due. Alla fine: com'e' andata, e com'era la chiamata.
 *
 * IL SERVER NON VEDE IL VIDEO. Per collegare due telefoni servono gli indirizzi STUN (gratis, di
 * Google) e, per le reti dei telefoni che non si lasciano raggiungere, un TURN che faccia da
 * ponte: FM_CF_TURN_ID + FM_CF_TURN_TOKEN (Cloudflare Realtime, i primi 1.000 GB al mese gratis)
 * oppure FM_TURN_URL/FM_TURN_USER/FM_TURN_PASS. Senza TURN la stanza funziona lo stesso: se il video
 * non si collega, restano la presenza, il tempo e i compiti dell'altro, aggiornati ogni pochi secondi.
 */

export const DURATE = [25, 50, 75];
export const ATTIVITA = ["scrivania", "movimento", "qualsiasi"];
const QUARTO = 15 * 60_000;

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_fm_sessioni (
        id INT AUTO_INCREMENT PRIMARY KEY,
        googleSub VARCHAR(64) NOT NULL,
        nome VARCHAR(60) NULL,
        slotAt BIGINT NOT NULL,
        durata INT NOT NULL,
        attivita VARCHAR(12) NOT NULL,
        silenzio TINYINT NOT NULL DEFAULT 0,
        preferiti TINYINT NOT NULL DEFAULT 0,
        compito TEXT NULL,
        stato VARCHAR(12) NOT NULL,
        partner INT NULL,
        stanza VARCHAR(32) NULL,
        entratoAt BIGINT NULL,
        vistoAt BIGINT NULL,
        esito VARCHAR(12) NULL,
        voto VARCHAR(12) NULL,
        nota TEXT NULL,
        createdAt TIMESTAMP NULL,
        INDEX (googleSub, slotAt),
        INDEX (slotAt, durata, stato)
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_fm_segnali (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stanza VARCHAR(32) NOT NULL,
        da VARCHAR(64) NOT NULL,
        tipo VARCHAR(12) NOT NULL,
        dati MEDIUMTEXT NULL,
        createdAt TIMESTAMP NULL,
        INDEX (stanza, id)
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_fm_preferiti (
        googleSub VARCHAR(64) NOT NULL,
        altro VARCHAR(64) NOT NULL,
        nome VARCHAR(60) NULL,
        createdAt TIMESTAMP NULL,
        PRIMARY KEY (googleSub, altro)
      )`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* ---------------------------------------------------------------------------------------
   LE REGOLE, senza database (si provano da sole: focuslockCompagni.test.ts)
   --------------------------------------------------------------------------------------- */
export type Pren = { id: number; googleSub: string; slotAt: number; durata: number; attivita: string; silenzio: number | boolean; preferiti: number | boolean; stato: string; createdAt?: number };

/** L'ora giusta: un quarto d'ora preciso, nel futuro (o nei 5 minuti appena passati), entro 8 giorni. */
export function slotValido(slotAt: number, adesso: number): boolean {
  if (!Number.isFinite(slotAt) || slotAt % QUARTO !== 0) return false;
  return slotAt >= adesso - 5 * 60_000 && slotAt <= adesso + 8 * 86400_000;
}
export function attivitaCompatibili(a: string, b: string): boolean {
  return a === "qualsiasi" || b === "qualsiasi" || a === b;
}
/** Il compagno migliore per una prenotazione fra quelle in attesa: stessa ora, stessa durata, tipo di
 *  lavoro compatibile, mai se stessi. Prima i preferiti (se li vuole), poi chi ha scelto lo stesso
 *  silenzio, poi lo stesso tipo di lavoro, poi chi aspetta da piu' tempo. */
export function scegliCompagno(mia: Pren, candidati: Pren[], preferitiMiei: string[]): Pren | null {
  const ok = candidati.filter((c) => c.id !== mia.id && c.googleSub !== mia.googleSub && c.stato === "attesa"
    && c.slotAt === mia.slotAt && c.durata === mia.durata && attivitaCompatibili(mia.attivita, c.attivita));
  if (!ok.length) return null;
  const punti = (c: Pren) => (mia.preferiti && preferitiMiei.includes(c.googleSub) ? 100 : 0)
    + (!!c.silenzio === !!mia.silenzio ? 10 : 0) + (c.attivita === mia.attivita ? 1 : 0);
  return ok.slice().sort((a, b) => punti(b) - punti(a) || (a.createdAt || a.id) - (b.createdAt || b.id))[0] || null;
}
/** Chi chiama per primo nella stanza (manda l'offerta): la prenotazione con l'id piu' basso. */
export function primo(a: number, b: number): boolean { return a < b; }
/** La serie: giorni di fila (fino a oggi o ieri) con almeno una sessione fatta. giorni: AAAA-MM-GG. */
export function serie(giorni: string[], oggi: string): number {
  const set = new Set(giorni);
  const d = new Date(oggi + "T12:00:00Z");
  if (!set.has(oggi)) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  for (;;) { const k = d.toISOString().slice(0, 10); if (!set.has(k)) break; n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

/* ---------------------------------------------------------------------------------------
   CHI SEI: il tesserino di Google, ricordato per dieci minuti (la stanza chiede ogni pochi
   secondi, e chiedere ogni volta a Google sarebbe lento e fuori dai limiti)
   --------------------------------------------------------------------------------------- */
const TESSERE = new Map<string, { sub: string; email: string | null; name: string | null; at: number }>();
async function chi(req: Request, res: Response) {
  const h = String(req.headers["authorization"] || "");
  const k = createHash("sha256").update(h).digest("hex");
  const c = TESSERE.get(k);
  if (c && Date.now() - c.at < 10 * 60_000) return c;
  const w = await whoIs(req);
  if (!isIdentity(w)) { res.status((w as any).status || 401).json({ error: (w as any).error || "unauthorized" }); return null; }
  const v = { sub: w.sub, email: w.email, name: w.name, at: Date.now() };
  TESSERE.set(k, v);
  if (TESSERE.size > 2000) { const via: string[] = []; TESSERE.forEach((y, x) => { if (Date.now() - y.at > 10 * 60_000) via.push(x); }); via.forEach((x) => TESSERE.delete(x)); }
  return v;
}
/** Il volto pubblico di una persona: un'impronta, mai l'account. */
function maniglia(sub: string): string { return createHash("sha256").update("fm:" + sub).digest("hex").slice(0, 16); }
const pulisci = (t: unknown, n: number) => String(t ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
function compiti(x: unknown): { t: string; fatto: boolean }[] {
  let l: any = x;
  if (typeof l === "string") { try { l = JSON.parse(l); } catch { l = []; } }
  return (Array.isArray(l) ? l : []).slice(0, 8).map((c: any) => ({ t: pulisci(c?.t, 140), fatto: !!c?.fatto })).filter((c) => c.t);
}
/** Il giorno (AAAA-MM-GG) all'ora italiana. */
const GIORNO_IT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
export function giornoDi(ms: number): string { return GIORNO_IT.format(new Date(ms)); }

async function iceServers(): Promise<any[]> {
  const out: any[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const id = process.env.FM_CF_TURN_ID, tok = process.env.FM_CF_TURN_TOKEN;
  if (id && tok) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate`, {
        method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 3 * 3600 }),
      });
      const j: any = await r.json();
      if (j?.iceServers) out.push(j.iceServers);
    } catch { /* senza ponte: il video prova lo stesso da telefono a telefono */ }
  } else if (process.env.FM_TURN_URL) {
    out.push({ urls: String(process.env.FM_TURN_URL).split(",").map((u) => u.trim()).filter(Boolean), username: process.env.FM_TURN_USER || "", credential: process.env.FM_TURN_PASS || "" });
  }
  return out;
}

async function preferitiDi(sub: string): Promise<string[]> {
  const r = await rows(sql`SELECT altro FROM focuslock_fm_preferiti WHERE googleSub = ${sub}`);
  return r.map((x: any) => String(x.altro));
}
function riga(x: any): Pren {
  return { id: Number(x.id), googleSub: String(x.googleSub), slotAt: Number(x.slotAt), durata: Number(x.durata), attivita: String(x.attivita), silenzio: Number(x.silenzio), preferiti: Number(x.preferiti), stato: String(x.stato), createdAt: x.createdAt ? new Date(x.createdAt).getTime() : 0 };
}
/** Prova ad abbinare una prenotazione in attesa. true se ha trovato il compagno. */
async function abbina(id: number): Promise<boolean> {
  const m = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} AND stato = 'attesa' LIMIT 1`);
  if (!m.length) return false;
  const mia = riga(m[0]);
  const cand = (await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE slotAt = ${mia.slotAt} AND durata = ${mia.durata} AND stato = 'attesa' AND id <> ${mia.id} AND googleSub <> ${mia.googleSub} ORDER BY id ASC LIMIT 50`)).map(riga);
  const c = scegliCompagno(mia, cand, await preferitiDi(mia.googleSub));
  if (!c) return false;
  const stanza = createHash("sha256").update(`${Math.min(mia.id, c.id)}:${Math.max(mia.id, c.id)}:${Date.now()}`).digest("hex").slice(0, 24);
  /* due richieste nello stesso momento non devono prendersi lo stesso compagno: si aggiorna solo se e' ancora in attesa */
  await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'abbinata', partner = ${mia.id}, stanza = ${stanza} WHERE id = ${c.id} AND stato = 'attesa'`);
  const preso = await rows(sql`SELECT id FROM focuslock_fm_sessioni WHERE id = ${c.id} AND partner = ${mia.id} AND stanza = ${stanza} LIMIT 1`);
  if (!preso.length) return false;
  await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'abbinata', partner = ${c.id}, stanza = ${stanza} WHERE id = ${mia.id}`);
  return true;
}
/** La prenotazione vista da chi l'ha fatta: con il compagno, senza il suo account. */
async function vista(x: any, sub: string, adesso: number) {
  let compagno: any = null;
  if (x.partner) {
    const p = await rows(sql`SELECT id, googleSub, nome, attivita, silenzio, compito, entratoAt, vistoAt FROM focuslock_fm_sessioni WHERE id = ${x.partner} LIMIT 1`);
    if (p.length) {
      const pref = await rows(sql`SELECT 1 AS si FROM focuslock_fm_preferiti WHERE googleSub = ${sub} AND altro = ${p[0].googleSub} LIMIT 1`);
      compagno = { id: Number(p[0].id), persona: maniglia(String(p[0].googleSub)), nome: p[0].nome || "Il tuo compagno", attivita: p[0].attivita, silenzio: !!Number(p[0].silenzio),
        compiti: compiti(p[0].compito), dentro: !!p[0].entratoAt, presente: !!p[0].vistoAt && adesso - Number(p[0].vistoAt) < 25_000, preferito: !!pref.length };
    }
  }
  return { id: Number(x.id), slotAt: Number(x.slotAt), durata: Number(x.durata), attivita: x.attivita, silenzio: !!Number(x.silenzio), preferiti: !!Number(x.preferiti),
    compiti: compiti(x.compito), stato: x.stato, stanza: x.stanza || null, esito: x.esito || null, voto: x.voto || null, compagno };
}

export function registerFocusLockCompagniRoutes(app: Express) {
  /* l'agenda: le mie sessioni dei prossimi giorni, chi aspetta un compagno (per ora), chi comincia adesso */
  app.get("/api/focuslock/fm/agenda", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const adesso = Date.now();
      const mie = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE googleSub = ${who.sub} AND slotAt >= ${adesso - 3 * 3600_000} AND stato <> 'annullata' ORDER BY slotAt ASC LIMIT 40`);
      /* chi era rimasto da solo prova di nuovo, adesso che magari c'e' qualcuno */
      for (const m of mie) if (m.stato === "attesa" && Number(m.slotAt) + Number(m.durata) * 60_000 > adesso) await abbina(Number(m.id));
      const mie2 = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE googleSub = ${who.sub} AND slotAt >= ${adesso - 3 * 3600_000} AND stato <> 'annullata' ORDER BY slotAt ASC LIMIT 40`);
      const altri = await rows(sql`SELECT slotAt, durata, COUNT(*) AS n FROM focuslock_fm_sessioni WHERE stato = 'attesa' AND googleSub <> ${who.sub} AND slotAt >= ${adesso - 5 * 60_000} AND slotAt <= ${adesso + 8 * 86400_000} GROUP BY slotAt, durata`);
      const out = [];
      for (const m of mie2) out.push(await vista(m, who.sub, adesso));
      res.json({ mie: out, aspettano: altri.map((a: any) => ({ slotAt: Number(a.slotAt), durata: Number(a.durata), n: Number(a.n) })), adesso });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* prenota: { slotAt, durata, attivita, silenzio, preferiti, compiti, nome } */
  app.post("/api/focuslock/fm/prenota", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const slotAt = Number(b.slotAt), durata = Number(b.durata);
    if (!slotValido(slotAt, Date.now())) { res.status(400).json({ error: "ora non valida: le sessioni cominciano a un quarto d'ora preciso" }); return; }
    if (!DURATE.includes(durata)) { res.status(400).json({ error: "durata non valida" }); return; }
    const attivita = ATTIVITA.includes(String(b.attivita)) ? String(b.attivita) : "scrivania";
    try {
      await ensureTables();
      const doppia = await rows(sql`SELECT id FROM focuslock_fm_sessioni WHERE googleSub = ${who.sub} AND stato <> 'annullata' AND slotAt < ${slotAt + durata * 60_000} AND (slotAt + durata * 60000) > ${slotAt} LIMIT 1`);
      if (doppia.length) { res.status(409).json({ error: "a quell'ora hai gia' una sessione" }); return; }
      const nome = pulisci(b.nome || who.name || "", 60) || "Una persona";
      await rows(sql`INSERT INTO focuslock_fm_sessioni (googleSub, nome, slotAt, durata, attivita, silenzio, preferiti, compito, stato, createdAt)
        VALUES (${who.sub}, ${nome}, ${slotAt}, ${durata}, ${attivita}, ${b.silenzio ? 1 : 0}, ${b.preferiti ? 1 : 0}, ${JSON.stringify(compiti(b.compiti))}, 'attesa', NOW())`);
      const r = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE googleSub = ${who.sub} AND slotAt = ${slotAt} AND stato = 'attesa' ORDER BY id DESC LIMIT 1`);
      if (!r.length) { res.status(500).json({ error: "prenotazione non salvata" }); return; }
      await abbina(Number(r[0].id));
      const x = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${r[0].id} LIMIT 1`);
      res.json({ sessione: await vista(x[0], who.sub, Date.now()) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* annulla: il compagno torna in attesa, e l'app gli cerca qualcun altro */
  app.post("/api/focuslock/fm/annulla", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const m = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} AND googleSub = ${who.sub} LIMIT 1`);
      if (!m.length) { res.status(404).json({ error: "sessione non trovata" }); return; }
      await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'annullata' WHERE id = ${id}`);
      if (m[0].partner) {
        await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'attesa', partner = NULL, stanza = NULL WHERE id = ${m[0].partner} AND stato = 'abbinata'`);
        await abbina(Number(m[0].partner));
      }
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* entra nella stanza: chi sei, chi e' il compagno, i ponti per il video, chi chiama per primo */
  app.post("/api/focuslock/fm/entra", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const adesso = Date.now();
      const m = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} AND googleSub = ${who.sub} LIMIT 1`);
      if (!m.length) { res.status(404).json({ error: "sessione non trovata" }); return; }
      if (adesso < Number(m[0].slotAt) - 5 * 60_000) { res.status(409).json({ error: "la stanza apre cinque minuti prima" }); return; }
      if (m[0].stato === "attesa") await abbina(id);
      await rows(sql`UPDATE focuslock_fm_sessioni SET entratoAt = COALESCE(entratoAt, ${adesso}), vistoAt = ${adesso} WHERE id = ${id}`);
      const x = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} LIMIT 1`);
      const v: any = await vista(x[0], who.sub, adesso);
      res.json({ sessione: v, primo: v.compagno ? primo(v.id, v.compagno.id) : false, ice: await iceServers(), adesso });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il battito nella stanza (ogni 5 secondi): ci sono, ecco i miei compiti; e il compagno? */
  app.post("/api/focuslock/fm/battito", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const id = Number(b.id);
    try {
      await ensureTables();
      const adesso = Date.now();
      if (b.compiti !== undefined) await rows(sql`UPDATE focuslock_fm_sessioni SET vistoAt = ${adesso}, compito = ${JSON.stringify(compiti(b.compiti))} WHERE id = ${id} AND googleSub = ${who.sub}`);
      else await rows(sql`UPDATE focuslock_fm_sessioni SET vistoAt = ${adesso} WHERE id = ${id} AND googleSub = ${who.sub}`);
      const x = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} AND googleSub = ${who.sub} LIMIT 1`);
      if (!x.length) { res.status(404).json({ error: "sessione non trovata" }); return; }
      res.json({ sessione: await vista(x[0], who.sub, adesso), adesso });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il compagno non e' arrivato dopo cinque minuti: un altro che e' rimasto da solo alla stessa ora */
  app.post("/api/focuslock/fm/riabbina", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const adesso = Date.now();
      const m = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE id = ${id} AND googleSub = ${who.sub} LIMIT 1`);
      if (!m.length) { res.status(404).json({ error: "sessione non trovata" }); return; }
      if (m[0].partner) {
        const p = await rows(sql`SELECT id, entratoAt FROM focuslock_fm_sessioni WHERE id = ${m[0].partner} LIMIT 1`);
        if (p.length && p[0].entratoAt) { res.json({ ok: false, motivo: "il tuo compagno e' gia' nella stanza" }); return; }
        if (p.length) await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'attesa', partner = NULL, stanza = NULL WHERE id = ${p[0].id}`);
        await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'attesa', partner = NULL, stanza = NULL WHERE id = ${id}`);
      }
      /* chi e' gia' dentro alla stessa ora, rimasto senza compagno (o con un compagno che non e' mai entrato) */
      const cand = await rows(sql`SELECT * FROM focuslock_fm_sessioni WHERE slotAt = ${m[0].slotAt} AND durata = ${m[0].durata} AND id <> ${id} AND googleSub <> ${who.sub}
        AND entratoAt IS NOT NULL AND vistoAt > ${adesso - 25_000} AND stato IN ('attesa', 'abbinata') LIMIT 10`);
      for (const s of cand) {
        if (s.stato !== "abbinata" || !s.partner) continue;
        const p = await rows(sql`SELECT entratoAt FROM focuslock_fm_sessioni WHERE id = ${s.partner} LIMIT 1`);
        if (p.length && p[0].entratoAt) continue;          // il suo compagno c'e': non si tocca
        await rows(sql`UPDATE focuslock_fm_sessioni SET stato = 'attesa', partner = NULL, stanza = NULL WHERE id IN (${s.id}, ${s.partner})`);
      }
      const ok = await abbina(id);
      res.json({ ok });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* i messaggi per collegare il video (offerta, risposta, candidati ICE): passano dal server e basta */
  app.post("/api/focuslock/fm/segnale", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const stanza = String(b.stanza || "").slice(0, 32), tipo = String(b.tipo || "").slice(0, 12);
    if (!stanza || !["offerta", "risposta", "ice", "fine", "ancora"].includes(tipo)) { res.status(400).json({ error: "segnale non valido" }); return; }
    try {
      await ensureTables();
      const dentro = await rows(sql`SELECT id FROM focuslock_fm_sessioni WHERE stanza = ${stanza} AND googleSub = ${who.sub} LIMIT 1`);
      if (!dentro.length) { res.status(403).json({ error: "non sei in questa stanza" }); return; }
      await rows(sql`INSERT INTO focuslock_fm_segnali (stanza, da, tipo, dati, createdAt) VALUES (${stanza}, ${who.sub}, ${tipo}, ${String(b.dati || "").slice(0, 60000)}, NOW())`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
  app.get("/api/focuslock/fm/segnali", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const stanza = String(req.query.stanza || "").slice(0, 32), dopo = Number(req.query.dopo || 0) || 0;
    try {
      await ensureTables();
      const dentro = await rows(sql`SELECT id FROM focuslock_fm_sessioni WHERE stanza = ${stanza} AND googleSub = ${who.sub} LIMIT 1`);
      if (!dentro.length) { res.status(403).json({ error: "non sei in questa stanza" }); return; }
      const l = await rows(sql`SELECT id, tipo, dati FROM focuslock_fm_segnali WHERE stanza = ${stanza} AND id > ${dopo} AND da <> ${who.sub} ORDER BY id ASC LIMIT 60`);
      res.json({ segnali: l.map((s: any) => ({ id: Number(s.id), tipo: s.tipo, dati: s.dati })) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* la fine: com'e' andata (fatto, in parte, no), com'era la chiamata, una nota se qualcosa non va */
  app.post("/api/focuslock/fm/fine", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const esito = ["fatto", "parte", "no"].includes(String(b.esito)) ? String(b.esito) : null;
    const voto = ["ottima", "lievi", "gravi"].includes(String(b.voto)) ? String(b.voto) : null;
    try {
      await ensureTables();
      await rows(sql`UPDATE focuslock_fm_sessioni SET esito = COALESCE(${esito}, esito), voto = COALESCE(${voto}, voto), nota = COALESCE(${pulisci(b.nota, 600) || null}, nota) WHERE id = ${Number(b.id)} AND googleSub = ${who.sub}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* i preferiti: dalla stanza o dalla pagina delle persone (si indica la sessione del compagno) */
  app.post("/api/focuslock/fm/preferito", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    try {
      await ensureTables();
      let sub = "", nome = "";
      if (b.sessione) {
        const p = await rows(sql`SELECT p.googleSub, p.nome FROM focuslock_fm_sessioni s JOIN focuslock_fm_sessioni p ON p.id = s.partner WHERE s.id = ${Number(b.sessione)} AND s.googleSub = ${who.sub} LIMIT 1`);
        if (p.length) { sub = String(p[0].googleSub); nome = String(p[0].nome || ""); }
      } else if (b.persona) {
        const l = await rows(sql`SELECT DISTINCT p.googleSub, p.nome FROM focuslock_fm_sessioni s JOIN focuslock_fm_sessioni p ON p.id = s.partner WHERE s.googleSub = ${who.sub} LIMIT 300`);
        const x = l.find((r: any) => maniglia(String(r.googleSub)) === String(b.persona));
        if (x) { sub = String(x.googleSub); nome = String(x.nome || ""); }
      }
      if (!sub) { res.status(404).json({ error: "persona non trovata" }); return; }
      if (b.on === false) await rows(sql`DELETE FROM focuslock_fm_preferiti WHERE googleSub = ${who.sub} AND altro = ${sub}`);
      else await rows(sql`INSERT INTO focuslock_fm_preferiti (googleSub, altro, nome, createdAt) VALUES (${who.sub}, ${sub}, ${nome}, NOW()) ON DUPLICATE KEY UPDATE nome = VALUES(nome)`);
      res.json({ ok: true, preferito: b.on !== false });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* le persone con cui hai lavorato, e i numeri: sessioni fatte, questa settimana, la serie */
  app.get("/api/focuslock/fm/persone", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const adesso = Date.now();
      const l = await rows(sql`SELECT p.googleSub, MAX(p.nome) AS nome, COUNT(*) AS n, MAX(s.slotAt) AS ultima FROM focuslock_fm_sessioni s JOIN focuslock_fm_sessioni p ON p.id = s.partner
        WHERE s.googleSub = ${who.sub} AND s.slotAt < ${adesso} AND s.entratoAt IS NOT NULL GROUP BY p.googleSub ORDER BY ultima DESC LIMIT 60`);
      const pref = await preferitiDi(who.sub);
      const fatte = await rows(sql`SELECT slotAt FROM focuslock_fm_sessioni WHERE googleSub = ${who.sub} AND entratoAt IS NOT NULL AND slotAt < ${adesso} ORDER BY slotAt DESC LIMIT 400`);
      const giorni = fatte.map((f: any) => giornoDi(Number(f.slotAt)));
      const sett = fatte.filter((f: any) => adesso - Number(f.slotAt) < 7 * 86400_000).length;
      res.json({
        persone: l.map((x: any) => ({ persona: maniglia(String(x.googleSub)), nome: x.nome || "Una persona", sessioni: Number(x.n), ultima: Number(x.ultima), preferito: pref.includes(String(x.googleSub)) })),
        numeri: { sessioni: fatte.length, settimana: sett, serie: serie(giorni, giornoDi(adesso)) },
      });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* le sessioni appena cominciate (o che cominciano fra poco) con qualcuno ancora da solo: "unisciti adesso" */
  app.get("/api/focuslock/fm/adesso", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const adesso = Date.now();
      const l = await rows(sql`SELECT slotAt, durata, COUNT(*) AS n FROM focuslock_fm_sessioni WHERE stato = 'attesa' AND googleSub <> ${who.sub}
        AND slotAt >= ${adesso - 5 * 60_000} AND slotAt <= ${adesso + 10 * 60_000} GROUP BY slotAt, durata ORDER BY slotAt ASC LIMIT 6`);
      res.json({ adesso: l.map((x: any) => ({ slotAt: Number(x.slotAt), durata: Number(x.durata), n: Number(x.n) })) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });
}
