import type { Express, Request, Response } from "express";

/* DreamMap 0.9.298-299: LE FOTO DI UNSPLASH PER IL PIANO (la replica di Notion). La scheda "Unsplash" della copertina
 * e del blocco immagine chiede qui, GET /api/focuslock/unsplash?q=...&pagina=N (N da 1), e riceve
 *   { foto: [{ id, thumb, full, autore, link, pagina, scarica }], piu: boolean, fonte, q (la ricerca in inglese) }.
 * Lo scroll infinito chiede pagina 2, 3, ... finche' piu e' true.
 *
 * LA RICERCA IN INGLESE. Unsplash cerca molto meglio in inglese ("libreria" da sola porta 45 foto, "bookshelf
 * library" 1460). La ricerca si traduce prima: un dizionario per le parole comuni (zero chiamate), poi Gemini
 * flash-lite (DREAMMAP_GEMINI_KEY o AGENT_GEMINI_KEY) per le altre, con la risposta tenuta in memoria. Senza chiave,
 * o se Gemini non risponde, si cerca con le parole come sono.
 *
 * LE FONTI, in ordine:
 *  1. l'API ufficiale, se c'e' UNSPLASH_ACCESS_KEY (la "Access Key" di un'app su unsplash.com/developers): e' quella
 *     che usa Notion. 50 richieste l'ora in modalita' demo (fino a 36.000 al mese), 5000 l'ora dopo l'approvazione.
 *     30 foto per pagina, pagine fino a total_pages.
 *  2. /napi/search/photos, l'API interna del sito: oggi sta dietro al controllo anti-bot Anubis (307 verso
 *     /.within.website, "Authorization required"), si prova lo stesso nel caso venga tolto. Se risponde 307/403 si
 *     salta per 30 minuti.
 *  3. la pagina pubblica di ricerca, unsplash.com/s/photos/<ricerca>?license=free: a un client che si presenta come
 *     tale (User-Agent "DreamMap-Piano/1.0", NON un finto browser: con le intestazioni da browser e' proprio lei a
 *     chiedere la sfida) risponde 200 con i risultati veri della ricerca dentro window.__DEHYDRATED_DATA__: le
 *     stesse foto, nello stesso ordine, che da' la ricerca del sito. Ogni pagina ne porta 20 (solo gratuite,
 *     license=free) e il parametro page viene ignorato: le pagine successive dello scroll sono la stessa ricerca
 *     con altri ordinamenti e orientamenti (orizzontali, verticali, le piu' recenti, per colore), senza doppioni.
 *     Nessun limite pubblicato e nessuna chiave: ogni ricerca resta in memoria 24 ore, quindi una parola cercata
 *     da cento persone costa una richiesta sola. Se un giorno risponde 403/429 o con la sfida, si salta per 30
 *     minuti e si passa al punto 4.
 *  4. foto: [] e il piano mostra il suo catalogo (catalogo-unsplash.ts nel piano: circa 900 foto vere per 34 temi,
 *     scelte con la stessa ricerca tradotta), cosi' la scheda non resta mai vuota.
 * Le immagini si mostrano dai loro URL (hotlink, come chiede Unsplash) con il nome dell'autore.
 */

type Foto = { id: string; thumb: string; full: string; autore: string; link: string; pagina: string; scarica: string };
type Pagina = { foto: Foto[]; piu: boolean; fonte: string };

const UA = "DreamMap-Piano/1.0";
const UTM = "utm_source=dreammap&utm_medium=referral";
const conUtm = (u: string) => (u ? u + (u.includes("?") ? "&" : "?") + UTM : "https://unsplash.com/?" + UTM);
const CACHE = new Map<string, { at: number; ms: number; p: Pagina }>();
const ORA = 60 * 60 * 1000;
const giuFino: Record<string, number> = {}; // fonte -> fino a quando saltarla

function metti(k: string, p: Pagina, ms: number) {
  CACHE.set(k, { at: Date.now(), ms, p });
  while (CACHE.size > 1500) { const primo = CACHE.keys().next().value; if (primo === undefined) break; CACHE.delete(primo); }
}
function dallaCache(k: string): Pagina | null {
  const c = CACHE.get(k);
  return c && Date.now() - c.at < c.ms ? c.p : null;
}

function inFoto(r: any): Foto | null {
  if (!r || !r.id || !r.urls || r.premium || r.plus || r.sponsorship) return null;
  const full = String(r.urls.regular || r.urls.full || "");
  if (!full) return null;
  const pagina = String(r.links?.html || `https://unsplash.com/photos/${r.slug || r.id}`);
  return {
    id: String(r.id),
    thumb: String(r.urls.small || r.urls.thumb || full),
    full,
    autore: String(r.user?.name || "").trim(),
    link: conUtm(String(r.user?.links?.html || (r.user?.username ? `https://unsplash.com/@${r.user.username}` : ""))),
    pagina: conUtm(pagina),
    scarica: r.links?.download ? conUtm(String(r.links.download)) + "&force=true" : `https://unsplash.com/photos/${r.id}/download?force=true&${UTM}`,
  };
}

async function prendi(url: string, headers: Record<string, string>, ms = 8000): Promise<{ status: number; tipo: string; testo: string } | null> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: c.signal, redirect: "manual" });
    return { status: r.status, tipo: r.headers.get("content-type") || "", testo: r.status === 200 ? await r.text() : "" };
  } catch { return null; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------------------------------------------
// LA TRADUZIONE: dizionario, poi Gemini con la cache
// ---------------------------------------------------------------------------------------------------------------
const DIZ: Record<string, string> = {
  libreria: "bookshelf library", librerie: "bookshelves library", scaffale: "shelf", scaffali: "shelves", biblioteca: "library",
  libro: "book", libri: "books", lettura: "reading", leggere: "reading", romanzo: "novel",
  casa: "house", case: "houses", villa: "villa", interni: "interior", salotto: "living room", soggiorno: "living room",
  cucina: "kitchen", camera: "bedroom", bagno: "bathroom", giardino: "garden", piscina: "swimming pool", arredamento: "interior design",
  famiglia: "family", figli: "children", figlio: "son", figlia: "daughter", bambini: "kids", bambino: "child", bimbi: "kids",
  mamma: "mother", papa: "father", genitori: "parents", amici: "friends", amicizia: "friendship", amore: "love", coppia: "couple",
  matrimonio: "wedding", sposi: "wedding couple", festa: "party", compleanno: "birthday",
  lavoro: "work", ufficio: "office", scrivania: "desk", azienda: "company", impresa: "business", riunione: "meeting",
  squadra: "team", successo: "success", carriera: "career", soldi: "money", denaro: "money", finanza: "finance",
  investimenti: "investing", risparmio: "savings", ricchezza: "wealth", borsa: "stock market", negozio: "shop",
  tecnologia: "technology", programmazione: "coding", codice: "code", computer: "computer", portatile: "laptop", telefono: "phone",
  palestra: "gym", allenamento: "workout", pesi: "weights", muscoli: "muscles", corsa: "running", correre: "running",
  maratona: "marathon", calcio: "soccer", pallone: "football", sport: "sport", nuoto: "swimming", bici: "bicycle", bicicletta: "bicycle",
  meditazione: "meditation", respiro: "breathing", benessere: "wellness", salute: "health", sonno: "sleep", dormire: "sleep",
  cibo: "food", sano: "healthy", sana: "healthy", dieta: "diet", insalata: "salad", frutta: "fruit", verdura: "vegetables",
  colazione: "breakfast", pranzo: "lunch", cena: "dinner", caffe: "coffee", pizza: "pizza", pasta: "pasta", dolci: "desserts",
  montagna: "mountain", montagne: "mountains", mare: "sea", spiaggia: "beach", oceano: "ocean", onde: "waves", isola: "island",
  lago: "lake", fiume: "river", bosco: "woods", foresta: "forest", alberi: "trees", albero: "tree", prato: "meadow",
  natura: "nature", neve: "snow", inverno: "winter", estate: "summer", primavera: "spring", autunno: "autumn",
  cielo: "sky", nuvole: "clouds", sole: "sun", tramonto: "sunset", alba: "sunrise", notte: "night", stelle: "stars",
  luna: "moon", spazio: "space", galassia: "galaxy", universo: "universe", pioggia: "rain",
  viaggio: "travel", viaggi: "travel", vacanza: "vacation", vacanze: "vacation", aereo: "airplane", valigia: "suitcase",
  avventura: "adventure", mondo: "world", citta: "city", strada: "street", grattacieli: "skyscrapers", ponte: "bridge",
  italia: "italy", roma: "rome", venezia: "venice", firenze: "florence", milano: "milan", toscana: "tuscany", parigi: "paris",
  musica: "music", chitarra: "guitar", pianoforte: "piano", concerto: "concert", cantare: "singing", canzone: "song",
  arte: "art", pittura: "painting", disegno: "drawing", pennelli: "brushes", colori: "colors", creativita: "creativity",
  studio: "study", studiare: "studying", scuola: "school", universita: "university", esame: "exam", laurea: "graduation", appunti: "notes",
  auto: "car", macchina: "car", moto: "motorcycle", sportiva: "sports", treno: "train", barca: "boat",
  animali: "animals", cane: "dog", cani: "dogs", gatto: "cat", gatti: "cats", cavallo: "horse", cucciolo: "puppy",
  fiori: "flowers", fiore: "flower", rose: "roses", piante: "plants", pianta: "plant",
  astratto: "abstract", sfondo: "background", sfumatura: "gradient", minimal: "minimal", texture: "texture",
  sogno: "dream", sogni: "dreams", felicita: "happiness", felice: "happy", liberta: "freedom", calma: "calm", pace: "peace",
  motivazione: "motivation", obiettivi: "goals", obiettivo: "goal", crescita: "growth", forza: "strength", luce: "light",
  bianco: "white", nero: "black", blu: "blue", rosso: "red", verde: "green", giallo: "yellow", rosa: "pink", oro: "gold",
};
const VUOTE = new Set(["di", "del", "della", "dei", "degli", "delle", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "e", "ed", "con", "per", "in", "a", "da", "su", "al", "allo", "alla", "ai", "agli", "alle", "nel", "nello", "nella", "nei", "negli", "nelle", "sul", "sullo", "sulla", "sui", "dal", "dallo", "dalla", "dai", "mio", "mia", "miei", "mie"]);
const TRAD = new Map<string, string>();
const norma = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

async function traduci(q: string): Promise<string> {
  const n = norma(q);
  if (!n) return q;
  const gia = TRAD.get(n); if (gia) return gia;
  const parole = n.split(" ").filter(p => !VUOTE.has(p));
  if (parole.length && parole.every(p => DIZ[p])) { const t = parole.map(p => DIZ[p]).join(" "); TRAD.set(n, t); return t; }
  const chiave = process.env.DREAMMAP_GEMINI_KEY || process.env.AGENT_GEMINI_KEY || "";
  if (!chiave) return q;
  try {
    const modello = process.env.DREAMMAP_UNSPLASH_MODELLO || "gemini-2.5-flash-lite";
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent`, {
      method: "POST", signal: c.signal, headers: { "x-goog-api-key": chiave, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You turn a photo search typed in any language (usually Italian) into the best short English search query for Unsplash: 1 to 4 words, lowercase, no punctuation, no quotes. If it is already English, return it unchanged. Example: libreria -> bookshelf library; casa al mare -> beach house. Reply with the query only." }] },
        contents: [{ role: "user", parts: [{ text: q }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 20, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }).finally(() => clearTimeout(t));
    const j: any = await r.json().catch(() => ({}));
    const out = norma((j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join(" ")).split(" ").slice(0, 5).join(" ");
    if (r.ok && out) { TRAD.set(n, out); if (TRAD.size > 3000) { const p = TRAD.keys().next().value; if (p !== undefined) TRAD.delete(p); } return out; }
  } catch { /* Gemini non risponde: si cerca con le parole com'erano */ }
  return q;
}

// ---------------------------------------------------------------------------------------------------------------
// LE FONTI
// ---------------------------------------------------------------------------------------------------------------
async function daApi(q: string, pagina: number): Promise<Pagina | null> {
  const chiave = process.env.UNSPLASH_ACCESS_KEY || "";
  if (!chiave || (giuFino.api || 0) > Date.now()) return null;
  const r = await prendi(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&page=${pagina}&per_page=30&content_filter=high`, { Authorization: "Client-ID " + chiave, "Accept-Version": "v1" });
  if (!r || r.status !== 200) { if (r && (r.status === 403 || r.status === 429)) giuFino.api = Date.now() + 30 * 60 * 1000; return null; }
  try { const j = JSON.parse(r.testo); return { foto: (j.results || []).map(inFoto).filter(Boolean), piu: pagina < Number(j.total_pages || 0), fonte: "api" }; } catch { return null; }
}

async function daNapi(q: string, pagina: number): Promise<Pagina | null> {
  if ((giuFino.napi || 0) > Date.now()) return null;
  const r = await prendi(`https://unsplash.com/napi/search/photos?query=${encodeURIComponent(q)}&page=${pagina}&per_page=30&plus=none`, { "User-Agent": UA, Accept: "application/json" }, 5000);
  if (!r || r.status !== 200 || !/json/.test(r.tipo)) { giuFino.napi = Date.now() + 30 * 60 * 1000; return null; }
  try { const j = JSON.parse(r.testo); return { foto: (j.results || []).map(inFoto).filter(Boolean), piu: pagina < Number(j.total_pages || 0), fonte: "napi" }; } catch { return null; }
}

/** I dati della pagina di ricerca: la stringa JSON di window.__DEHYDRATED_DATA__, letta a mano (e' lunga mezzo MB). */
function datiDellaPagina(html: string): any | null {
  const k = html.indexOf("window.__DEHYDRATED_DATA__");
  if (k < 0) return null;
  const a = html.indexOf('"', k);
  if (a < 0) return null;
  let i = a + 1;
  for (; i < html.length; i++) { const ch = html.charCodeAt(i); if (ch === 92) { i++; continue; } if (ch === 34) break; }
  try { return JSON.parse(JSON.parse(html.slice(a, i + 1))); } catch { return null; }
}

// le "pagine" dello scroll sulla pagina pubblica: la stessa ricerca con altri ordinamenti e orientamenti, poi le
// ricerche correlate che Unsplash stesso propone (per "bookshelf library": book, bookshelf, library, shelf, study...)
const VARIANTI = ["", "&orientation=landscape", "&orientation=portrait", "&order_by=latest", "&order_by=latest&orientation=landscape", "&order_by=latest&orientation=portrait"];
const SITO = new Map<string, { at: number; foto: Foto[]; correlate: string[] }>();
async function daSito(q: string, extra: string): Promise<{ foto: Foto[]; correlate: string[] } | null> {
  const k = `${norma(q)}|${extra}`;
  const c = SITO.get(k); if (c && Date.now() - c.at < 24 * ORA) return c;
  if ((giuFino.sito || 0) > Date.now()) return null;
  const slug = encodeURIComponent(q.trim().replace(/\s+/g, "-"));
  const r = await prendi(`https://unsplash.com/s/photos/${slug}?license=free${extra}`, { "User-Agent": UA, Accept: "text/html" });
  if (!r || r.status !== 200) { if (!r || r.status === 403 || r.status === 429 || (r.status >= 300 && r.status < 400)) giuFino.sito = Date.now() + 30 * 60 * 1000; return null; }
  const d = datiDellaPagina(r.testo);
  const qs: any[] = Array.isArray(d?.queryClientCache?.queries) ? d.queryClientCache.queries : [];
  const res = qs.find(x => Array.isArray(x?.queryKey) && x.queryKey[2] === "/search/photos")?.state?.data?.pages?.[0]?.results;
  if (!Array.isArray(res)) { giuFino.sito = Date.now() + 30 * 60 * 1000; return null; }
  const rel = qs.find(x => Array.isArray(x?.queryKey) && x.queryKey[2] === "/search/meta")?.state?.data?.related_searches;
  const out = { at: Date.now(), foto: res.map(inFoto).filter((x: Foto | null): x is Foto => !!x), correlate: Array.isArray(rel) ? rel.map((x: any) => String(x?.title || "")).filter(Boolean).slice(0, 12) : [] };
  SITO.set(k, out);
  while (SITO.size > 2000) { const p = SITO.keys().next().value; if (p === undefined) break; SITO.delete(p); }
  return out;
}
function passi(en: string, orig: string, correlate: string[]): [string, string][] {
  const out: [string, string][] = [[en, ""]];
  if (norma(orig) !== norma(en)) out.push([orig, ""]); // la parola com'era: e' quella che cercherebbe Notion
  VARIANTI.slice(1).forEach(v => out.push([en, v]));
  correlate.filter(t => norma(t) !== norma(en) && norma(t) !== norma(orig)).forEach(t => out.push([t, ""]));
  return out;
}

async function cerca(orig: string, en: string, pagina: number): Promise<Pagina> {
  const chiave = `${norma(orig)}|${pagina}`;
  const c = dallaCache(chiave); if (c) return c;
  let p = await daApi(en, pagina);
  if (!p) p = await daNapi(en, pagina);
  if (!p) {
    const primo = await daSito(en, "");
    if (primo) {
      const lista = passi(en, orig, primo.correlate);
      // le foto gia' date nelle pagine prima: niente doppioni nello scroll
      const gia = new Set<string>();
      for (let n = 1; n < pagina; n++) dallaCache(`${norma(orig)}|${n}`)?.foto.forEach(f => gia.add(f.id));
      const foto: Foto[] = [];
      // la pagina N parte dal passo N; se porta solo doppioni si prova il successivo (al massimo quattro richieste)
      let i = pagina - 1;
      for (let tent = 0; i < lista.length && tent < 4 && foto.length < 8; i++, tent++) {
        const [qq, ex] = lista[i]!;
        const r = i === 0 ? primo : await daSito(qq, ex);
        if (!r) break;
        r.foto.forEach(f => { if (!gia.has(f.id) && !foto.some(x => x.id === f.id)) foto.push(f); });
      }
      p = { foto, piu: i < lista.length && (primo.foto.length > 0 || pagina > 1), fonte: "sito" };
    }
  }
  const out = p || { foto: [], piu: false, fonte: "nessuna" };
  metti(chiave, out, out.foto.length || out.fonte !== "nessuna" ? 24 * ORA : 10 * 60 * 1000);
  return out;
}

export function registerFocusLockUnsplashRoutes(app: Express) {
  app.get("/api/focuslock/unsplash", async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const q = String(req.query.q || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (q.length < 2) { res.status(400).json({ error: "q is required", foto: [], piu: false }); return; }
    const pagina = Math.max(1, Math.min(40, parseInt(String(req.query.pagina || req.query.page || "1"), 10) || 1));
    try {
      const en = await traduci(q);
      const p = await cerca(q, en, pagina);
      res.json({ ...p, q: en, pagina });
    } catch (e: any) {
      res.json({ foto: [], piu: false, fonte: "errore", q, pagina, error: String(e?.message || e) });
    }
  });
}
