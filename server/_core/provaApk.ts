import type { Express, Request, Response } from "express";
import { Readable } from "node:stream";

// Gli APK di prova del Bug Loop di DreamMap ("DreamMap PROVA", si installa accanto
// all'app vera). Li prepara ogni notte l'agente sul VPS e li tiene lui: qui c'e' solo
// l'indirizzo https da cui Andrea li scarica toccando il link nel messaggio Telegram.
//
// Perche' passa da qui: Telegram non mette una foto e un file nello stesso messaggio, e
// Andrea vuole UN messaggio solo (foto prima/dopo, testo e APK). Serve quindi un link, e
// un link http verso un indirizzo IP il telefono lo blocca.
//
// Non e' un proxy aperto: l'origine e' una sola e fissa, e passa soltanto
// /<gettone di 32 caratteri>/<nome>.apk. Il gettone lo sceglie a caso il VPS per ogni APK.
const ORIGINE = (process.env.PROVA_APK_ORIGINE || "http://76.13.8.65:8796").replace(/\/+$/, "");
const GETTONE = /^[0-9a-f]{32}$/;
const FILE = /^[A-Za-z0-9._-]{1,80}\.apk$/;

function nonTrovato(res: Response) {
  res
    .status(404)
    .type("text/plain; charset=utf-8")
    .send("Questo APK di prova non c'è più: i file di prova restano disponibili per 14 giorni.");
}

export function registerProvaApkRoutes(app: Express) {
  app.get("/prova-apk/:gettone/:file", async (req: Request, res: Response) => {
    const { gettone, file } = req.params;
    if (!GETTONE.test(gettone) || !FILE.test(file)) {
      nonTrovato(res);
      return;
    }

    // Il limite di tempo vale solo per la risposta iniziale del VPS: lo scaricamento di
    // 40 MB su una rete lenta puo' durare minuti e non va interrotto.
    const stacco = new AbortController();
    const attesa = setTimeout(() => stacco.abort(), 15_000);
    try {
      const headers: Record<string, string> = {};
      if (typeof req.headers.range === "string") headers.range = req.headers.range;
      const su = await fetch(`${ORIGINE}/${gettone}/${file}`, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers,
        signal: stacco.signal,
      });
      clearTimeout(attesa);

      if (su.status !== 200 && su.status !== 206) {
        su.body?.cancel().catch(() => {});
        nonTrovato(res);
        return;
      }

      res.status(su.status);
      res.setHeader("Content-Type", "application/vnd.android.package-archive");
      res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      for (const h of ["content-length", "content-range", "accept-ranges"]) {
        const v = su.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (req.method === "HEAD" || !su.body) {
        res.end();
        return;
      }

      const corpo = Readable.fromWeb(su.body as any);
      res.on("close", () => {
        if (!res.writableEnded) stacco.abort();
      });
      corpo.on("error", () => res.destroy());
      corpo.pipe(res);
    } catch (err) {
      clearTimeout(attesa);
      console.error("[ProvaApk] il VPS non risponde:", (err as Error)?.message);
      if (!res.headersSent) {
        res
          .status(502)
          .type("text/plain; charset=utf-8")
          .send("In questo momento l'APK di prova non si riesce a scaricare. Riprova fra qualche minuto.");
      } else {
        res.destroy();
      }
    }
  });
}
