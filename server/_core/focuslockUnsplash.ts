import type { Express, Request, Response } from "express";

/* DreamMap 0.9.298 — LE FOTO DI UNSPLASH PER IL PIANO (la replica di Notion): la scheda "Unsplash" della copertina
 * e del blocco immagine chiede qui, GET /api/focuslock/unsplash?q=…, e riceve { foto: [{ id, thumb, full, autore, link }] }.
 *
 * Perche' passa dal server. unsplash.com, compresa /napi/search/photos (quella che usa il sito), sta dietro a un
 * controllo anti-bot (Anubis: 307 verso /.within.website, "Authorization required"): non risponde ne' al browser da
 * un'altra origine ne' a una fetch senza la sfida risolta. Resta l'API ufficiale, che vuole una chiave:
 *   UNSPLASH_ACCESS_KEY (la "Access Key" di un'app su unsplash.com/developers).
 * Limiti dell'API ufficiale: 50 richieste l'ora con l'app in modalita' demo, 5000 l'ora dopo l'approvazione
 * (unsplash.com/documentation#rate-limiting). Le immagini vanno mostrate dai loro URL (hotlink) con il nome
 * dell'autore, ed e' quello che fa il piano.
 *
 * Senza chiave si prova lo stesso /napi (nel caso il controllo venga tolto): se non risponde, foto: [] e il piano
 * mostra le sue foto scelte (unsplash.tsx), cosi' la scheda non resta mai vuota.
 * Ogni ricerca resta in memoria un'ora (anche quelle andate male, per non consumare il limite a vuoto).
 */

type Foto = { id: string; thumb: string; full: string; autore: string; link: string };
const CACHE = new Map<string, { at: number; foto: Foto[]; fonte: string }>();
const CACHE_MS = 60 * 60 * 1000;
const UTM = "utm_source=dreammap&utm_medium=referral";
const conUtm = (u: string) => (u ? u + (u.includes("?") ? "&" : "?") + UTM : "https://unsplash.com/?" + UTM);

function inFoto(r: any): Foto | null {
  if (!r || !r.id || !r.urls) return null;
  return {
    id: String(r.id),
    thumb: String(r.urls.small || r.urls.thumb || ""),
    full: String(r.urls.regular || r.urls.full || ""),
    autore: String(r.user?.name || ""),
    link: conUtm(String(r.user?.links?.html || r.links?.html || "")),
  };
}

async function chiedi(url: string, headers: Record<string, string>): Promise<Foto[] | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000);
  try {
    const r = await fetch(url, { headers, signal: c.signal, redirect: "manual" });
    if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) return null;
    const j: any = await r.json();
    return (Array.isArray(j?.results) ? j.results : []).map(inFoto).filter((x: Foto | null): x is Foto => !!x && !!x.full);
  } catch { return null; } finally { clearTimeout(t); }
}

export function registerFocusLockUnsplashRoutes(app: Express) {
  app.get("/api/focuslock/unsplash", async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (q.length < 2) { res.status(400).json({ error: "q is required", foto: [] }); return; }
    const k = q.toLowerCase();
    const c = CACHE.get(k);
    if (c && Date.now() - c.at < CACHE_MS) { res.json({ foto: c.foto, fonte: c.fonte, cache: true }); return; }
    const chiave = process.env.UNSPLASH_ACCESS_KEY || "";
    const qs = "query=" + encodeURIComponent(q) + "&per_page=24";
    let foto: Foto[] | null = null; let fonte = "nessuna";
    if (chiave) {
      foto = await chiedi("https://api.unsplash.com/search/photos?" + qs + "&content_filter=high", { Authorization: "Client-ID " + chiave, "Accept-Version": "v1" });
      if (foto) fonte = "api";
    }
    if (!foto) {
      foto = await chiedi("https://unsplash.com/napi/search/photos?" + qs, { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" });
      if (foto) fonte = "napi";
    }
    const out = foto || [];
    CACHE.set(k, { at: Date.now(), foto: out, fonte });
    if (CACHE.size > 500) { const primo = CACHE.keys().next().value; if (primo) CACHE.delete(primo); }
    res.json({ foto: out, fonte });
  });
}
