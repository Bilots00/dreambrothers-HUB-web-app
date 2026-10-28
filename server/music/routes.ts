/**
 * Le porte HTTP del Music Studio.
 *   GET /api/music/file/:id.mp3           — la web app (stesso utente di tRPC); ?dl=1 per scaricare
 *   GET /api/focuslock/music/manifest     — Dream Map: elenco pubblico delle tracce pubblicate
 *   GET /api/focuslock/music/:id.mp3      — Dream Map: il file, solo se pubblicato
 * Il prefisso /api/focuslock/ non e' un caso: il bridge nativo dell'app
 * (NATIVE.publicApi) accetta solo quello.
 */
import type { Express, Request, Response } from "express";
import { createContext } from "../_core/context";
import { dreamMapManifest, getTrack, readAudio } from "./service";

function sendAudio(req: Request, res: Response, buf: Buffer, opts: { filename?: string; immutable?: boolean }) {
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", opts.immutable ? "public, max-age=31536000, immutable" : "private, max-age=3600");
  if (opts.filename) res.setHeader("Content-Disposition", `attachment; filename="${opts.filename}"`);
  const range = req.headers.range;
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : buf.length - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
    start = Math.max(0, start); end = Math.min(buf.length - 1, end);
    if (start > end) { res.status(416).setHeader("Content-Range", `bytes */${buf.length}`); res.end(); return; }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${buf.length}`);
    res.setHeader("Content-Length", String(end - start + 1));
    res.end(buf.subarray(start, end + 1));
    return;
  }
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

const fileName = (title: string, id: number) =>
  `${title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "track"}-dreambrothers-${id}.mp3`;

function publicBase(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

export function registerMusicRoutes(app: Express) {
  app.get("/api/music/file/:id.mp3", async (req, res) => {
    try {
      // Lo stesso utente che vede tRPC: oggi la web app e' a utente unico, senza
      // login, e chiedere qui un cookie di sessione dava 401 in produzione.
      const { user } = await createContext({ req, res } as unknown as Parameters<typeof createContext>[0]);
      if (!user) { res.status(401).json({ error: "login richiesto" }); return; }
      const id = Number(req.params.id);
      const t = await getTrack(id);
      if (!t || t.userId !== user.id || t.status !== "ready") { res.status(404).json({ error: "traccia non trovata" }); return; }
      const buf = await readAudio(id);
      if (!buf) { res.status(404).json({ error: "audio mancante" }); return; }
      sendAudio(req, res, buf, { filename: req.query.dl ? fileName(t.title, id) : undefined });
    } catch (e) {
      console.warn("[Music] file:", e);
      res.status(500).json({ error: "errore" });
    }
  });

  app.get("/api/focuslock/music/manifest", async (req, res) => {
    try {
      const m = await dreamMapManifest(publicBase(req));
      const etag = `"m${m.version}-${m.items.length}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
      res.json(m);
    } catch (e) {
      console.warn("[Music] manifest:", e);
      res.status(500).json({ error: "errore" });
    }
  });

  app.get("/api/focuslock/music/:id.mp3", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const t = await getTrack(id);
      if (!t || !t.dmPublished || t.status !== "ready") { res.status(404).json({ error: "non pubblicata" }); return; }
      const buf = await readAudio(id);
      if (!buf) { res.status(404).json({ error: "audio mancante" }); return; }
      res.setHeader("Access-Control-Allow-Origin", "*");
      sendAudio(req, res, buf, { immutable: true });
    } catch (e) {
      console.warn("[Music] file pubblico:", e);
      res.status(500).json({ error: "errore" });
    }
  });
}
