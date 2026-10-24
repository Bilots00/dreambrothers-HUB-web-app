import type { Express, Request, Response } from "express";
import { whoIs, isIdentity } from "./focuslockRoutes";

/* DreamMap 0.9.301 — IL RITRATTO DELL'IO FUTURO.
 *
 * Andrea: dopo il selfie, l'app mostra il suo Io Futuro: poco piu' grande d'eta' (quanto manca al sogno secondo la stima
 * di DreamMap: 1-3 anni = quasi niente, mai esagerato), nel pieno della forma, con lo sguardo di chi ce l'ha fatta.
 * Il ritratto poi e' il volto della chiamata con l'Io Futuro e di ogni posto in cui l'app lo mostra.
 *
 * COME: il telefono manda il selfie (base64, gia' rimpicciolito a 640 px), qui si chiama un modello Gemini che modifica
 * un'immagine partendo da un riferimento, e si rimanda indietro il ritratto. NIENTE SI CONSERVA: il selfie e il ritratto
 * vivono solo dentro questa richiesta (nessun file, nessun database, nessun log del contenuto). Il ritratto lo salva il
 * telefono (localStorage + IndexedDB).
 *
 * IL CONTO (listino ufficiale ai.google.dev/gemini-api/docs/pricing, letto il 24/10/2026; nessun modello immagini ha il
 * piano gratuito, "Free Tier: Not available"):
 *   - gemini-nano-banana-2.1 (Nano Banana 2.1, quello che la guida usa per modificare con riferimento): 0,0336 $ a
 *     immagine 1K, piu' l'ingresso (0,50 $ / 1,50 $ per milione di token: frazioni di centesimo per un selfie);
 *   - gemini-3.1-flash-image (riserva): 0,067 $ a immagine 1K.
 *   gemini-2.5-flash-image (0,039 $) e' deprecato e si spegne il 2/10/2026: non si usa.
 * I tetti: DREAMMAP_RITRATTO_MAX_GIORNO ritratti al giorno per persona (di serie 3) e DREAMMAP_RITRATTO_TETTO_GIORNO per
 * tutto il server (di serie 300, cioe' al massimo circa 10 $ al giorno). Contano solo i ritratti riusciti.
 * Senza chiave, o con la chiave senza fatturazione (Gemini risponde 429/403), la risposta e' { spento: true }: l'app
 * lascia la sagoma e non dice niente di falso. */

const CHIAVE = () => process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || "";
const MODELLI = () => String(process.env.DREAMMAP_RITRATTO_MODELLO || "gemini-nano-banana-2.1,gemini-3.1-flash-image")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_GIORNO = () => Math.max(1, Math.floor(Number(process.env.DREAMMAP_RITRATTO_MAX_GIORNO || 3)));
const TETTO_GIORNO = () => Math.max(1, Math.floor(Number(process.env.DREAMMAP_RITRATTO_TETTO_GIORNO || 300)));
const MAX_BYTE = 4 * 1024 * 1024;

const FATTI = new Map<string, { g: string; n: number }>();
let TOTALE = { g: "", n: 0 };
function giorno(): string { return new Date().toISOString().slice(0, 10); }
function fattiOggi(sub: string): number { const u = FATTI.get(sub); return u && u.g === giorno() ? u.n : 0; }
function totaleOggi(): number { return TOTALE.g === giorno() ? TOTALE.n : 0; }
function segna(sub: string) {
  const g = giorno();
  FATTI.set(sub, { g, n: fattiOggi(sub) + 1 });
  TOTALE = { g, n: totaleOggi() + 1 };
}

/** Quanto invecchiare: dagli anni che mancano al sogno. Sempre poco: e' la stessa persona, piu' in forma. */
export function rigaEta(anni: number): string {
  const a = Number.isFinite(anni) && anni > 0 ? anni : 1;
  if (a <= 1.5) return "About one year older than in the photo: no visible aging at all.";
  if (a <= 3) return `About ${Math.round(a)} years older than in the photo: almost no visible aging, only a slightly more mature, self-assured look.`;
  if (a <= 6) return `About ${Math.round(a)} years older than in the photo: very subtle aging only (at most a hint of maturity around the eyes), never exaggerated.`;
  return "Several years older than in the photo, but aged gracefully and only subtly: still clearly the same person, never exaggerated, no grey hair unless already present.";
}

export function promptRitratto(anni: number, genere: string): string {
  const chi = genere === "f" ? "woman" : genere === "m" ? "man" : "person";
  return [
    `Edit the reference photo into a portrait of the SAME ${chi} in the future: the version of them who has achieved their biggest dream.`,
    "Identity is the top priority: keep exactly the same face shape, eyes, eye color, nose, mouth, skin tone, hair color, hairline and distinguishing features (moles, freckles, glasses if present). Friends must recognize them instantly.",
    rigaEta(anni),
    "They are in the best shape of their life: healthy glowing skin, rested bright eyes, good posture, fit and full of energy, vitality and enthusiasm. Well groomed, simple elegant clothes.",
    "Expression: a genuine relaxed smile and the calm, proud look of someone who made it: deep satisfaction, confidence, the feeling of being a winner. Looking straight at the camera, warm and kind.",
    "Composition: vertical head-and-shoulders portrait, face centered, soft natural light, softly blurred bright background with warm sunrise light and gentle blue tones.",
    "Keep the medium of the reference: if it is a photograph, output a realistic photograph; if it is an illustration, keep the same illustration style.",
    "No text, no letters, no logos, no frames.",
  ].join("\n");
}

type Esito = { ok: true; immagine: string; mime: string; modello: string } | { ok: false; status: number; motivo: string; spento: boolean };

/** Una chiamata vera a Gemini. Esportata per la prova in locale (scratchpad), che usa questa stessa funzione. */
export async function ritrattoGemini(b64: string, mime: string, anni: number, genere: string): Promise<Esito> {
  const chiave = CHIAVE();
  if (!chiave) return { ok: false, status: 503, motivo: "nessuna chiave Gemini", spento: true };
  let ultimo: Esito = { ok: false, status: 502, motivo: "nessun modello", spento: false };
  for (const modello of MODELLI()) {
    let r: globalThis.Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": chiave, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: promptRitratto(anni, genere) }] }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: "1K" } },
        }),
      });
    } catch (e: any) { ultimo = { ok: false, status: 502, motivo: "rete: " + (e?.message || e), spento: false }; continue; }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(j?.error?.message || r.status).slice(0, 200);
      /* 429 = quota (anche "limit: 0" del piano gratuito), 403 = fatturazione o permesso: la funzione resta spenta */
      const spento = r.status === 429 || r.status === 403 || /billing|quota|free.?tier|RESOURCE_EXHAUSTED/i.test(msg);
      /* modello sconosciuto, parametro non accettato o quota di quel modello: si prova il prossimo della lista */
      ultimo = { ok: false, status: r.status, motivo: `${modello}: ${msg}`, spento };
      continue;
    }
    const parti: any[] = j?.candidates?.[0]?.content?.parts || [];
    const p = parti.find((x) => x && (x.inlineData || x.inline_data));
    const d = p && (p.inlineData || p.inline_data);
    if (d && d.data) return { ok: true, immagine: String(d.data), mime: String(d.mimeType || d.mime_type || "image/png"), modello };
    ultimo = { ok: false, status: 502, motivo: `${modello}: nessuna immagine (${String(j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason || "?")})`, spento: false };
  }
  return ultimo;
}

export function registerFocusLockRitrattoRoutes(app: Express) {
  /* lo stato, per non far partire l'attesa quando la funzione e' spenta */
  app.get("/api/focuslock/agent/ritratto", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    res.json({ acceso: !!CHIAVE(), restano: Math.max(0, MAX_GIORNO() - fattiOggi(who.sub)), max: MAX_GIORNO() });
  });

  app.post("/api/focuslock/agent/ritratto", async (req: Request, res: Response) => {
    const who = await whoIs(req);
    if (!isIdentity(who)) { res.status(who.status).json({ error: who.error }); return; }
    if (!who.email) { res.status(403).json({ error: "agent not enabled for this account" }); return; }
    if (!CHIAVE()) { res.status(503).json({ error: "ritratto spento", spento: true }); return; }
    const b = req.body || {};
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.selfie || ""));
    const mime = m ? m[1] : String(b.mime || "image/jpeg");
    const b64 = m ? m[2] : String(b.selfie || "");
    if (!b64 || !/^image\/(jpeg|png|webp)$/.test(mime)) { res.status(400).json({ error: "selfie richiesto" }); return; }
    if (Buffer.byteLength(b64, "base64") > MAX_BYTE) { res.status(413).json({ error: "foto troppo grande" }); return; }
    if (fattiOggi(who.sub) >= MAX_GIORNO()) { res.status(429).json({ error: "ritratti di oggi finiti", finiti: true, restano: 0 }); return; }
    if (totaleOggi() >= TETTO_GIORNO()) { res.status(429).json({ error: "tetto del giorno", finiti: true, restano: 0 }); return; }
    const anni = Math.max(0, Math.min(15, Number(b.anni) || 1));
    const genere = b.genere === "f" || b.genere === "m" ? b.genere : "";
    const e = await ritrattoGemini(b64, mime, anni, genere);
    if (!e.ok) {
      /* solo il motivo tecnico nei log, mai l'immagine */
      console.warn("[ritratto] non riuscito:", e.motivo);
      res.status(e.spento ? 503 : 502).json({ error: "ritratto non riuscito", spento: e.spento });
      return;
    }
    segna(who.sub);
    res.json({ immagine: `data:${e.mime};base64,${e.immagine}`, modello: e.modello, restano: Math.max(0, MAX_GIORNO() - fattiOggi(who.sub)) });
  });
}
