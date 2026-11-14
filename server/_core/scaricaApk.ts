import type { Express, NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

// DreamMap: /scarica/DreamMap.apk dal RILASCIO AUTOMATICO (preparato il 14/11/2026, spento finche' Andrea non dice si').
//
// Sul VPS rilascio/rilascio.py pubblica le versioni che il Regista ha approvato e che GitHub ha compilato con la chiave
// del PC di Andrea; corrente.json dice quale e' quella di oggi. Con DREAMMAP_RILASCIO_VPS=1 questa rotta serve quella.
// Resta il file nel repo, come prima, se:
// - la variabile e' spenta;
// - il VPS non risponde (il download non deve mai rompersi);
// - la versione del VPS non e' piu' nuova di quella scritta in scarica/index.html (un rilascio fatto a mano dal PC).
// Stessa origine fissa e stesso gettone del flusso degli APK di prova (provaApk.ts, prova/servi.py sul VPS).
const ORIGINE = (process.env.PROVA_APK_ORIGINE || "http://76.13.8.65:8796").replace(/\/+$/, "");
const GETTONE = process.env.DREAMMAP_RILASCIO_GETTONE || "666244fce522aaa6405bde55a8a5fe59";
const FILE = /^DreamMap-[0-9.]+\.apk$/;
const acceso = () => process.env.DREAMMAP_RILASCIO_VPS === "1";

let cacheVps: { at: number; dati: any } | null = null;
let cacheRepo: { at: number; versione: string | null } | null = null;

/* se la versione del repo non si legge non si rischia: resta il file del repo (rilascio.py se ne accorge, perche'
   controlla che il link serva davvero l'APK nuovo, e lo scrive ad Andrea) */
function piuNuova(a: string, b: string | null): boolean {
  if (!b) return false;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

/** La versione del file nel repo (l'ultimo rilascio fatto a mano), letta dalla pagina di download. */
function versioneRepo(): string | null {
  if (cacheRepo && Date.now() - cacheRepo.at < 300_000) return cacheRepo.versione;
  let versione: string | null = null;
  const cartelle = [path.resolve(import.meta.dirname, "public"), path.resolve(process.cwd(), "dist", "public"), path.resolve(process.cwd(), "client", "public"),
    path.resolve(import.meta.dirname, "../..", "dist", "public"), path.resolve(import.meta.dirname, "../..", "client", "public")];
  for (const d of cartelle) {
    try {
      const m = /versione ([0-9]+(?:\.[0-9]+)+)/.exec(fs.readFileSync(path.join(d, "scarica", "index.html"), "utf8"));
      if (m) { versione = m[1]; break; }
    } catch { /* la prossima cartella */ }
  }
  cacheRepo = { at: Date.now(), versione };
  return versione;
}

/** La versione pubblicata dal VPS, se e' da servire. null = resta il file del repo. */
async function dalVps(): Promise<{ versione: string; file: string; bytes: number } | null> {
  if (!acceso()) return null;
  if (!cacheVps || Date.now() - cacheVps.at > 60_000) {
    try {
      const r = await fetch(`${ORIGINE}/${GETTONE}/corrente.json`, { signal: AbortSignal.timeout(8000) });
      cacheVps = { at: Date.now(), dati: r.ok ? await r.json() : null };
    } catch {
      cacheVps = { at: Date.now(), dati: null };
    }
  }
  const c = cacheVps.dati;
  if (!c || typeof c.versione !== "string" || !FILE.test(String(c.file || ""))) return null;
  return piuNuova(c.versione, versioneRepo()) ? { versione: c.versione, file: String(c.file), bytes: Number(c.bytes || 0) } : null;
}

export function registerScaricaApkRoutes(app: Express) {
  /* la versione da scrivere sotto al pulsante della pagina di download (scarica/index.html la chiede da sola) */
  app.get("/scarica/versione.json", async (_req: Request, res: Response, next: NextFunction) => {
    const c = await dalVps();
    if (!c) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json({ versione: c.versione });
  });

  app.get("/scarica/DreamMap.apk", async (req: Request, res: Response, next: NextFunction) => {
    const c = await dalVps();
    if (!c) { next(); return; }
    const stacco = new AbortController();
    const attesa = setTimeout(() => stacco.abort(), 15_000);
    try {
      const headers: Record<string, string> = {};
      if (typeof req.headers.range === "string") headers.range = req.headers.range;
      const su = await fetch(`${ORIGINE}/${GETTONE}/${c.file}`, { method: req.method === "HEAD" ? "HEAD" : "GET", headers, signal: stacco.signal });
      clearTimeout(attesa);
      if (su.status !== 200 && su.status !== 206) { su.body?.cancel().catch(() => {}); next(); return; }
      res.status(su.status);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", 'attachment; filename="DreamMap.apk"');
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-DreamMap-Versione", c.versione);
      for (const h of ["content-length", "content-range", "accept-ranges"]) {
        const v = su.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (req.method === "HEAD" || !su.body) { res.end(); return; }
      Readable.fromWeb(su.body as any).on("error", () => res.destroy()).pipe(res);
    } catch {
      clearTimeout(attesa);
      if (!res.headersSent) next();
      else res.destroy();
    }
  });
}
