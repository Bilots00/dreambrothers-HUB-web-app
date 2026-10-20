import type { Express, Request, Response } from "express";

/* DreamMap 0.9.290 — IL TUTORIAL DENTRO ALL'APP, CON UN VIDEO VERO.
 *
 * Andrea: "cerco un tutorial e la pagina dice Questo video non e' disponibile". L'app metteva nella cornice di YouTube la
 * ricerca (`embed?listType=search&list=…`): YouTube l'ha spenta, e il lettore risponde sempre "video non disponibile".
 * Qui il server cerca su YouTube (la pagina dei risultati, la stessa che vede chiunque: nessuna chiave, nessun costo),
 * tiene i video normali (niente Shorts, niente dirette), controlla con l'oEmbed che si possano incorporare (chi lo vieta
 * risponde 401) e manda all'app i primi cinque. L'app mette il primo nella cornice e gli altri sotto, da scegliere.
 *
 * Costi e limiti: nessuna quota (non e' la Data API, che darebbe 100 ricerche al giorno). Il rischio e' che YouTube
 * cambi la pagina: allora l'elenco torna vuoto e l'app lo dice, senza rompersi. Ogni ricerca resta in memoria 12 ore.
 */

type Video = { id: string; t: string; ch: string; dur: string; sec: number; views: number };
const CACHE = new Map<string, { at: number; v: Video[] }>();
const CACHE_MS = 12 * 60 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function secondi(d: string): number {
  const p = String(d || "").split(":").map((x) => Number(x) || 0);
  return p.reduce((a, x) => a * 60 + x, 0);
}
function numero(v: string): number {
  const m = String(v || "").replace(/\./g, "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}

async function cerca(q: string): Promise<Video[]> {
  /* sp=EgIQAQ%3D%3D: solo video (niente canali, playlist, Shorts) */
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&hl=it&gl=IT&sp=EgIQAQ%253D%253D";
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "it-IT,it;q=0.9", cookie: "CONSENT=YES+cb; SOCS=CAI" } });
  if (!r.ok) throw new Error("youtube " + r.status);
  const h = await r.text();
  const m = h.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/) || h.match(/ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
  if (!m) return [];
  let dati: any; try { dati = JSON.parse(m[1]); } catch { return []; }
  const out: Video[] = [];
  const giro = (o: any) => {
    if (!o || typeof o !== "object" || out.length >= 20) return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      const dur = v.lengthText?.simpleText || "";
      if (v.videoId && dur) out.push({ id: String(v.videoId), t: String(v.title?.runs?.[0]?.text || ""), ch: String(v.ownerText?.runs?.[0]?.text || ""), dur, sec: secondi(dur), views: numero(v.viewCountText?.simpleText || "") });
      return;
    }
    for (const k in o) giro(o[k]);
  };
  giro(dati);
  return out;
}

/** Si puo' incorporare? L'oEmbed risponde 401 per i video che non si possono mettere in un'altra pagina. */
async function incorporabile(id: string): Promise<boolean> {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id), { signal: c.signal, headers: { "user-agent": UA } });
    clearTimeout(t);
    return r.ok;
  } catch { return true; }
}

export function registerFocusLockTutorialRoutes(app: Express) {
  app.get("/api/focuslock/tutorial", async (req: Request, res: Response) => {
    const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (q.length < 3) { res.status(400).json({ error: "q is required" }); return; }
    const k = q.toLowerCase();
    const c = CACHE.get(k);
    if (c && Date.now() - c.at < CACHE_MS) { res.json({ video: c.v, cache: true }); return; }
    try {
      const tutti = await cerca(q);
      /* l'ordine di YouTube (la pertinenza), con i video troppo corti o troppo lunghi in fondo: un tutorial da guardare
       * prima di mettersi al lavoro sta fra uno e venticinque minuti */
      const giusti = tutti.filter((v) => v.sec >= 60 && v.sec <= 25 * 60);
      const altri = tutti.filter((v) => !(v.sec >= 60 && v.sec <= 25 * 60));
      const candidati = giusti.concat(altri).slice(0, 9);
      const ok = await Promise.all(candidati.map((v) => incorporabile(v.id)));
      const video = candidati.filter((_, i) => ok[i]).slice(0, 5);
      CACHE.set(k, { at: Date.now(), v: video });
      if (CACHE.size > 300) { const primo = CACHE.keys().next().value; if (primo) CACHE.delete(primo); }
      res.json({ video });
    } catch (e: any) {
      res.status(502).json({ error: "ricerca non riuscita: " + (e?.message || String(e)), video: [] });
    }
  });
}
