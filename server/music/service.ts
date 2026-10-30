/**
 * Music Studio — libreria, coda di generazione, batch notturno, pubblicazione
 * su Dream Map. L'audio vive nel DB (MySQL di Railway) a pezzi da 1 MB: niente
 * bucket esterno da tenere vivo, e nessuna riga troppo grande per il driver.
 * Le tabelle si creano da sole al primo uso, come le altre.
 *
 * Costi: nessuna API. Tutto e' sintesi sul server: ~1 core per circa un sesto
 * della durata della traccia (5 min = ~50 s di render + ~16 s di mp3).
 */
import { sql } from "drizzle-orm";
import {
  MUSIC_KEYS, SFX_TYPES, type DreamMapRarity, type DreamMapUse, type MusicMood, type MusicPurpose, type MusicSpec,
} from "@shared/music";
import { getDb } from "../db";
import { renderInWorker } from "./pool";
import { mulberry32 } from "./engine";

const CHUNK = 1024 * 1024;
const OWNER_USER_ID = 1;
const RETENTION_DAYS = 30;
const MAX_ATTEMPTS = 3;

async function rows(q: any): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("database non disponibile");
  const res: any = await db.execute(q);
  const out = Array.isArray(res) ? (Array.isArray(res[0]) ? res[0] : res) : (res?.rows ?? []);
  return Array.isArray(out) ? out.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)) : [];
}
async function exec(q: any): Promise<any> {
  const db = await getDb();
  if (!db) throw new Error("database non disponibile");
  const res: any = await db.execute(q);
  return Array.isArray(res) ? res[0] : res;
}

let ready: Promise<void> | null = null;
export function ensureMusicTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await exec(sql`CREATE TABLE IF NOT EXISTS music_tracks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        kind VARCHAR(8) NOT NULL,
        title VARCHAR(120) NOT NULL,
        purpose VARCHAR(16) NOT NULL,
        sfxType VARCHAR(16) NULL,
        mood VARCHAR(16) NULL,
        keyName VARCHAR(4) NULL,
        bpm INT NULL,
        seed BIGINT NOT NULL,
        spec TEXT NOT NULL,
        status VARCHAR(12) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        error TEXT NULL,
        metrics TEXT NULL,
        durationSec DOUBLE NULL,
        loopStartSec DOUBLE NULL,
        loopSec DOUBLE NULL,
        bytes INT NULL,
        source VARCHAR(10) NOT NULL,
        batch VARCHAR(10) NULL,
        isNew TINYINT NOT NULL DEFAULT 0,
        favourite TINYINT NOT NULL DEFAULT 0,
        dmPublished TINYINT NOT NULL DEFAULT 0,
        dmUses VARCHAR(120) NULL,
        dmRarity VARCHAR(16) NULL,
        dmPublishedAt TIMESTAMP NULL,
        createdAt TIMESTAMP NULL,
        updatedAt TIMESTAMP NULL,
        KEY idx_music_user (userId, createdAt),
        KEY idx_music_status (status),
        KEY idx_music_dm (dmPublished)
      )`);
      await exec(sql`CREATE TABLE IF NOT EXISTS music_chunks (
        trackId INT NOT NULL,
        idx INT NOT NULL,
        data MEDIUMBLOB NOT NULL,
        PRIMARY KEY (trackId, idx)
      )`);
      /* 0.9.308: dmAuto = pubblicata da sola dal batch notturno (Andrea non l'ha scelta a mano). Serve alla pulizia:
         quelle automatiche dopo 30 giorni se ne vanno come le altre notturne, quelle scelte a mano restano. */
      try { await exec(sql`ALTER TABLE music_tracks ADD COLUMN dmAuto TINYINT NOT NULL DEFAULT 0`); }
      catch (e: any) {
        const why = [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(" ");
        if (!/duplicate column|ER_DUP_FIELDNAME/i.test(why || String(e))) throw e;
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export type TrackRow = {
  id: number; userId: number; kind: "track" | "sfx"; title: string; purpose: MusicPurpose; sfxType: string | null;
  mood: string | null; keyName: string | null; bpm: number | null; seed: number; status: "queued" | "rendering" | "ready" | "failed";
  attempts: number; error: string | null; metrics: any; durationSec: number | null; loopStartSec: number | null; loopSec: number | null;
  bytes: number | null; source: "manual" | "nightly"; batch: string | null; isNew: boolean; favourite: boolean;
  dmPublished: boolean; dmUses: DreamMapUse[]; dmRarity: DreamMapRarity | null; dmPublishedAt: Date | null; createdAt: Date | null;
};

function toRow(r: any): TrackRow {
  let metrics: any = null; try { metrics = r.metrics ? JSON.parse(r.metrics) : null; } catch { /* vecchio formato */ }
  return {
    id: Number(r.id), userId: Number(r.userId), kind: r.kind, title: r.title, purpose: r.purpose, sfxType: r.sfxType ?? null,
    mood: r.mood ?? null, keyName: r.keyName ?? null, bpm: r.bpm == null ? null : Number(r.bpm), seed: Number(r.seed),
    status: r.status, attempts: Number(r.attempts ?? 0), error: r.error ?? null, metrics,
    durationSec: r.durationSec == null ? null : Number(r.durationSec), loopStartSec: r.loopStartSec == null ? null : Number(r.loopStartSec),
    loopSec: r.loopSec == null ? null : Number(r.loopSec), bytes: r.bytes == null ? null : Number(r.bytes),
    source: r.source, batch: r.batch ?? null, isNew: !!Number(r.isNew), favourite: !!Number(r.favourite),
    dmPublished: !!Number(r.dmPublished), dmUses: r.dmUses ? String(r.dmUses).split(",").filter(Boolean) as DreamMapUse[] : [],
    dmRarity: r.dmRarity ?? null, dmPublishedAt: r.dmPublishedAt ?? null, createdAt: r.createdAt ?? null,
  };
}

const LIST_COLS = sql`id, userId, kind, title, purpose, sfxType, mood, keyName, bpm, seed, status, attempts, error, metrics, durationSec, loopStartSec, loopSec, bytes, source, batch, isNew, favourite, dmPublished, dmUses, dmRarity, dmPublishedAt, createdAt`;

export async function listTracks(userId: number): Promise<TrackRow[]> {
  await ensureMusicTables();
  return (await rows(sql`SELECT ${LIST_COLS} FROM music_tracks WHERE userId = ${userId} ORDER BY id DESC LIMIT 500`)).map(toRow);
}

export async function getTrack(id: number): Promise<TrackRow | null> {
  await ensureMusicTables();
  const r = await rows(sql`SELECT ${LIST_COLS} FROM music_tracks WHERE id = ${id}`);
  return r[0] ? toRow(r[0]) : null;
}

export function newSeed(): number { return Math.floor(Math.random() * 2 ** 31); }

export async function enqueue(userId: number, spec: MusicSpec, source: "manual" | "nightly", batch: string | null, isNew = false): Promise<number> {
  await ensureMusicTables();
  const kind = spec.kind === "sfx" || spec.purpose === "sfx" ? "sfx" : "track";
  const norm: MusicSpec = { ...spec, kind, purpose: kind === "sfx" ? "sfx" : spec.purpose };
  const { trackTitle } = await import("./names");
  const title = (spec.title || trackTitle(norm)).slice(0, 120);
  const res = await exec(sql`INSERT INTO music_tracks
    (userId, kind, title, purpose, sfxType, mood, keyName, bpm, seed, spec, status, source, batch, isNew, createdAt, updatedAt)
    VALUES (${userId}, ${kind}, ${title}, ${norm.purpose}, ${norm.sfxType ?? null}, ${norm.mood ?? null}, ${norm.key ?? null}, ${norm.bpm ?? null},
      ${norm.seed}, ${JSON.stringify({ ...norm, title })}, 'queued', ${source}, ${batch}, ${isNew ? 1 : 0}, NOW(), NOW())`);
  kick();
  return Number(res?.insertId ?? 0);
}

// ── la coda: un lavoro alla volta, nel worker thread ──
let running = false;
export function kick() { if (!running) void runQueue(); }

async function runQueue() {
  running = true;
  try {
    for (;;) {
      const next = (await rows(sql`SELECT id, spec, attempts, title, source FROM music_tracks WHERE status = 'queued' ORDER BY id ASC LIMIT 1`))[0];
      if (!next) break;
      const id = Number(next.id);
      await exec(sql`UPDATE music_tracks SET status = 'rendering', updatedAt = NOW() WHERE id = ${id}`);
      const spec = JSON.parse(next.spec) as MusicSpec;
      let attempts = Number(next.attempts ?? 0), lastFails: string[] = [], err: string | null = null, done = false;
      while (attempts < MAX_ATTEMPTS && !done) {
        attempts++;
        // dal secondo tentativo il seme cambia: una variante nuova invece dello stesso difetto
        const s = attempts === 1 ? spec : { ...spec, seed: (spec.seed + attempts * 7919) % 2 ** 31 };
        try {
          const r = await renderInWorker(s);
          if (r.fails.length) { lastFails = r.fails; continue; }
          await saveAudio(id, r.mp3);
          await exec(sql`UPDATE music_tracks SET status = 'ready', attempts = ${attempts}, error = NULL, seed = ${s.seed},
            metrics = ${JSON.stringify(r.metrics)}, durationSec = ${r.durationSec}, loopStartSec = ${r.loopStartSec}, loopSec = ${r.loopSec},
            bpm = ${r.bpm}, keyName = ${r.key}, mood = ${r.mood}, bytes = ${r.mp3.length}, updatedAt = NOW() WHERE id = ${id}`);
          if (next.source === "nightly") await autoPublish(id);
          done = true;
        } catch (e: any) {
          err = String(e?.message || e).slice(0, 2000);
          console.warn(`[Music] render #${id} tentativo ${attempts} fallito:`, err);
        }
      }
      if (!done) {
        const why = lastFails.length ? `Cancello di qualita' rosso dopo ${attempts} tentativi: ${lastFails.join("; ")}` : `Errore: ${err}`;
        await exec(sql`UPDATE music_tracks SET status = 'failed', attempts = ${attempts}, error = ${why}, isNew = 0, updatedAt = NOW() WHERE id = ${id}`);
      }
    }
  } catch (e) {
    console.warn("[Music] coda ferma:", e);
  } finally {
    running = false;
  }
}

async function saveAudio(id: number, mp3: Buffer) {
  await exec(sql`DELETE FROM music_chunks WHERE trackId = ${id}`);
  for (let i = 0, k = 0; i < mp3.length; i += CHUNK, k++) {
    await exec(sql`INSERT INTO music_chunks (trackId, idx, data) VALUES (${id}, ${k}, ${mp3.subarray(i, i + CHUNK)})`);
  }
  cache.delete(id);
}

// piccola cache: un <audio> chiede lo stesso file a pezzi (Range) piu' volte
const cache = new Map<number, Buffer>();
const CACHE_MAX = 60 * 1024 * 1024;
export async function readAudio(id: number): Promise<Buffer | null> {
  const hit = cache.get(id);
  if (hit) { cache.delete(id); cache.set(id, hit); return hit; }
  await ensureMusicTables();
  const parts = await rows(sql`SELECT data FROM music_chunks WHERE trackId = ${id} ORDER BY idx ASC`);
  if (!parts.length) return null;
  const buf = Buffer.concat(parts.map((p) => Buffer.from(p.data)));
  cache.set(id, buf);
  let total = 0; for (const b of Array.from(cache.values())) total += b.length;
  for (const k of Array.from(cache.keys())) { if (total <= CACHE_MAX) break; total -= cache.get(k)!.length; cache.delete(k); }
  return buf;
}

export async function updateTrack(userId: number, id: number, patch: { title?: string; favourite?: boolean; isNew?: boolean }) {
  await ensureMusicTables();
  if (patch.title !== undefined) await exec(sql`UPDATE music_tracks SET title = ${patch.title.slice(0, 120)}, updatedAt = NOW() WHERE id = ${id} AND userId = ${userId}`);
  if (patch.favourite !== undefined) await exec(sql`UPDATE music_tracks SET favourite = ${patch.favourite ? 1 : 0}, updatedAt = NOW() WHERE id = ${id} AND userId = ${userId}`);
  if (patch.isNew !== undefined) await exec(sql`UPDATE music_tracks SET isNew = ${patch.isNew ? 1 : 0} WHERE id = ${id} AND userId = ${userId}`);
}

export async function markAllSeen(userId: number) {
  await ensureMusicTables();
  await exec(sql`UPDATE music_tracks SET isNew = 0 WHERE userId = ${userId} AND isNew = 1`);
}

export async function deleteTrack(userId: number, id: number) {
  await ensureMusicTables();
  const own = await rows(sql`SELECT id FROM music_tracks WHERE id = ${id} AND userId = ${userId}`);
  if (!own.length) return;
  await exec(sql`DELETE FROM music_chunks WHERE trackId = ${id}`);
  await exec(sql`DELETE FROM music_tracks WHERE id = ${id}`);
  cache.delete(id);
}

export async function setPublished(userId: number, id: number, on: boolean, uses: DreamMapUse[] = [], rarity: DreamMapRarity | null = null) {
  await ensureMusicTables();
  if (on) {
    await exec(sql`UPDATE music_tracks SET dmPublished = 1, dmAuto = 0, dmUses = ${uses.join(",")}, dmRarity = ${rarity},
      dmPublishedAt = COALESCE(dmPublishedAt, NOW()), updatedAt = NOW() WHERE id = ${id} AND userId = ${userId} AND status = 'ready'`);
  } else {
    await exec(sql`UPDATE music_tracks SET dmPublished = 0, dmAuto = 0, updatedAt = NOW() WHERE id = ${id} AND userId = ${userId}`);
  }
}

/**
 * 0.9.308, Andrea: "ho creato la sezione music perche' nell'app ci fossero sempre suoni nuovi". Il batch notturno
 * finiva nella libreria e li' restava: nessuna traccia era pubblicata, il manifest di Dream Map era vuoto e l'app non
 * riceveva niente. Adesso ogni pezzo notturno pronto va su Dream Map da solo (effetti -> "Effetti del gioco",
 * tracce -> "Focus / viaggio"). Chi lo toglie dalla web app ("Togli da Dream Map") lo toglie per sempre: dmPublishedAt
 * resta scritto, e questa funzione non lo ripubblica.
 */
const AUTO_USES = sql`CASE WHEN kind = 'sfx' THEN 'game_sfx' ELSE 'focus' END`;
export async function autoPublish(id: number) {
  await exec(sql`UPDATE music_tracks SET dmPublished = 1, dmAuto = 1, dmUses = ${AUTO_USES}, dmPublishedAt = NOW()
    WHERE id = ${id} AND status = 'ready' AND source = 'nightly' AND dmPublished = 0 AND dmPublishedAt IS NULL`);
}
/** Al boot: i notturni gia' pronti e mai toccati (quelli fatti prima di questa versione) vanno su Dream Map. */
export async function autoPublishBackfill(): Promise<number> {
  const r = await exec(sql`UPDATE music_tracks SET dmPublished = 1, dmAuto = 1, dmUses = ${AUTO_USES}, dmPublishedAt = COALESCE(createdAt, NOW())
    WHERE status = 'ready' AND source = 'nightly' AND dmPublished = 0 AND dmPublishedAt IS NULL`);
  return Number(r?.affectedRows ?? 0);
}

// ── manifest per Dream Map ──
export async function dreamMapManifest(base: string) {
  await ensureMusicTables();
  const list = (await rows(sql`SELECT ${LIST_COLS}, dmAuto, UNIX_TIMESTAMP(updatedAt) AS upTs, UNIX_TIMESTAMP(dmPublishedAt) AS pubTs FROM music_tracks WHERE dmPublished = 1 AND status = 'ready' ORDER BY dmPublishedAt DESC, id DESC`));
  let version = 0;
  const items = list.map((raw) => {
    const r = toRow(raw);
    const up = Number(raw.upTs ?? 0) * 1000;
    if (up > version) version = up;
    return {
      id: `dbm-${r.id}`,
      kind: r.kind,
      title: r.title,
      purpose: r.purpose,
      sfxType: r.sfxType,
      mood: r.mood,
      key: r.keyName,
      bpm: r.bpm,
      durationSec: r.durationSec,
      loop: r.loopSec ? { startSec: r.loopStartSec, lengthSec: r.loopSec } : null,
      url: `${base}/api/focuslock/music/${r.id}.mp3`,
      bytes: r.bytes,
      mime: "audio/mpeg",
      uses: r.dmUses,
      rarity: r.dmRarity,
      /* true = pubblicata da sola dal batch notturno; false = scelta a mano da Andrea (l'app la preferisce) */
      auto: !!Number(raw.dmAuto ?? 0),
      publishedAt: raw.pubTs ? new Date(Number(raw.pubTs) * 1000).toISOString() : null,
      loudnessLufs: r.metrics?.lufs != null ? Math.round(r.metrics.lufs * 10) / 10 : null,
    };
  });
  return {
    schema: 1,
    version,
    license: "Audio generato proceduralmente da DreamBrothers Music Studio. Proprieta' di Andrea Bilotta / DreamBrothers. Nessun campione di terzi.",
    items,
  };
}

// ── batch notturno ──
const NIGHT_MOODS: Record<string, MusicMood[]> = {
  focus: ["dreamy", "serene", "hopeful", "uplifting"],
  relax: ["dreamy", "serene", "melancholic", "hopeful"],
  sleep: ["deep", "dreamy", "serene"],
  meditate: ["serene", "deep", "dreamy"],
  study: ["serene", "dreamy", "hopeful"],
  work: ["uplifting", "hopeful", "dreamy"],
};

export function romeDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Specifiche del batch di una notte: 4 tracce lunghe in loop + un pacchetto di 9 effetti. */
export function nightlyPlan(date: string): MusicSpec[] {
  const day = Math.floor(Date.parse(date + "T12:00:00Z") / 86_400_000);
  const r = mulberry32((day * 2654435761) >>> 0);
  const fourth = (["meditate", "study", "work"] as const)[day % 3];
  const purposes = ["focus", "relax", "sleep", fourth] as const;
  const tracks: MusicSpec[] = purposes.map((p) => {
    const moods = NIGHT_MOODS[p];
    return {
      kind: "track", purpose: p, mood: moods[Math.floor(r() * moods.length)],
      key: MUSIC_KEYS[Math.floor(r() * MUSIC_KEYS.length)], lengthSec: 300, seed: Math.floor(r() * 2 ** 31),
    };
  });
  const sfx: MusicSpec[] = SFX_TYPES.map((t) => ({ kind: "sfx", purpose: "sfx", sfxType: t.id, seed: Math.floor(r() * 2 ** 31) }));
  return [...tracks, ...sfx];
}

export async function runNightlyBatch(opts: { force?: boolean } = {}): Promise<{ batch: string; queued: number; skipped: boolean }> {
  await ensureMusicTables();
  const batch = romeDate();
  if (!opts.force) {
    const exist = await rows(sql`SELECT COUNT(*) AS n FROM music_tracks WHERE source = 'nightly' AND batch = ${batch}`);
    if (Number(exist[0]?.n ?? 0) > 0) return { batch, queued: 0, skipped: true };
  }
  const plan = nightlyPlan(batch).map((s) => (opts.force ? { ...s, seed: newSeed() } : s));
  for (const spec of plan) await enqueue(OWNER_USER_ID, spec, "nightly", batch, true);
  await pruneOld();
  return { batch, queued: plan.length, skipped: false };
}

/** Pulizia: i notturni non tenuti (ne' preferiti ne' pubblicati a mano) oltre 30 giorni. */
export async function pruneOld() {
  const old = await rows(sql`SELECT id FROM music_tracks WHERE source = 'nightly' AND favourite = 0 AND (dmPublished = 0 OR dmAuto = 1)
    AND createdAt < DATE_SUB(NOW(), INTERVAL ${RETENTION_DAYS} DAY)`);
  for (const o of old) {
    await exec(sql`DELETE FROM music_chunks WHERE trackId = ${o.id}`);
    await exec(sql`DELETE FROM music_tracks WHERE id = ${o.id}`);
  }
  return old.length;
}

export async function nightlyStatus(userId: number) {
  await ensureMusicTables();
  const last = await rows(sql`SELECT batch, status, COUNT(*) AS n FROM music_tracks WHERE userId = ${userId} AND source = 'nightly'
    AND batch = (SELECT MAX(batch) FROM music_tracks WHERE userId = ${userId} AND source = 'nightly') GROUP BY batch, status`);
  const stats = await rows(sql`SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM music_tracks WHERE userId = ${userId}`);
  return {
    lastBatch: last[0]?.batch ?? null,
    lastBatchCounts: Object.fromEntries(last.map((r) => [r.status, Number(r.n)])),
    schedule: "ogni notte alle 03:30 (Europe/Rome)",
    totalItems: Number(stats[0]?.n ?? 0),
    totalBytes: Number(stats[0]?.bytes ?? 0),
    retentionDays: RETENTION_DAYS,
  };
}

/** Al boot: i lavori rimasti a meta' da un riavvio tornano in coda. */
export async function resumeQueueOnBoot() {
  try {
    await ensureMusicTables();
    await exec(sql`UPDATE music_tracks SET status = 'queued' WHERE status = 'rendering'`);
    const n = await autoPublishBackfill();
    if (n) console.log(`[Music] ${n} pezzi notturni pubblicati su Dream Map`);
    kick();
  } catch (e) {
    console.warn("[Music] ripresa coda al boot fallita:", e);
  }
}
