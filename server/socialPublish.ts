/**
 * Pubblicazione organica su Instagram e Pagina Facebook con la Graph API
 * ufficiale. Sostituisce Blotato per i post approvati in Bozze.
 *
 * Qui c'e' SOLO la logica verso Meta: costruzione delle chiamate, attesa dei
 * contenitori, permalink. Il database, lo scheduler e i link pubblici alle
 * immagini stanno in socialPublishStore.ts. `fetch` e' iniettabile, cosi' i test
 * girano contro una Graph API finta e non toccano mai un profilo vero.
 *
 * Fonti (lette il 2026-11-27):
 *  - developers.facebook.com/docs/instagram-platform/content-publishing/
 *    JPEG e' l'unico formato immagine; carosello fino a 20 elementi; i
 *    contenitori scadono dopo 24 ore; status_code: EXPIRED | ERROR | FINISHED |
 *    IN_PROGRESS | PUBLISHED; caption max 2200 caratteri e 30 hashtag.
 *  - developers.facebook.com/docs/pages-api/posts/
 *    /{page-id}/feed per testo e link, /{page-id}/photos per le foto.
 *
 * Il token non finisce MAI in un messaggio d'errore o in un log: viaggia nel
 * corpo della POST o nell'header Authorization, e ogni testo che esce da qui
 * passa da `pulisci()`.
 */

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

/** Permessi senza i quali la pubblicazione non parte. */
export const PERMESSI_RICHIESTI = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_manage_posts",
  "pages_read_engagement",
] as const;

export const MAX_CAPTION = 2200;
export const MAX_HASHTAG = 30;
export const MAX_CAROSELLO = 20;

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Errore leggibile da Andrea. `definitivo` = riprovare non serve (manca un permesso, caption troppo lunga...). */
export class ErrorePubblicazione extends Error {
  constructor(messaggio: string, readonly definitivo = false, readonly codiceMeta?: number) {
    super(messaggio);
    this.name = "ErrorePubblicazione";
  }
}

export interface GraphClient {
  get<T = Record<string, unknown>>(path: string, params?: Record<string, string>): Promise<T>;
  post<T = Record<string, unknown>>(path: string, params?: Record<string, string>): Promise<T>;
}

/** Toglie il token da qualunque testo, nel caso Meta lo rimandi indietro in un errore. */
export function pulisci(testo: string, token: string): string {
  if (!token) return testo;
  return testo.split(token).join("[token]");
}

// Codici Meta che non migliorano riprovando: permessi, token, parametri.
const CODICI_DEFINITIVI = new Set([10, 100, 190, 200, 273, 803]);

function traduciErrore(err: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string }): string {
  const code = err.code ?? 0;
  const base = err.error_user_msg || err.message || "errore sconosciuto";
  if (code === 190) return `Token Meta scaduto o revocato: rigeneralo (vedi docs/social-autopublish.md). Dettaglio: ${base}`;
  if (code === 10 || code === 200) return `Permesso mancante sul token Meta. Dettaglio: ${base}`;
  if (code === 9 || code === 4 || code === 17 || code === 32 || code === 613) return `Limite di frequenza Meta raggiunto, riprovo piu' tardi. Dettaglio: ${base}`;
  return `Meta ${code || "?"}: ${base}`;
}

export function createGraphClient(token: string, opts: { fetchImpl?: FetchLike; version?: string } = {}): GraphClient {
  const f: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const base = `https://graph.facebook.com/${opts.version ?? GRAPH_VERSION}`;

  const leggi = async <T>(res: Awaited<ReturnType<FetchLike>>): Promise<T> => {
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new ErrorePubblicazione(`Risposta non leggibile da Meta (HTTP ${res.status})`);
    }
    const e = json?.error as Parameters<typeof traduciErrore>[0] | undefined;
    if (e) {
      throw new ErrorePubblicazione(pulisci(traduciErrore(e), token), CODICI_DEFINITIVI.has(e.code ?? 0), e.code);
    }
    if (!res.ok) throw new ErrorePubblicazione(`Meta ha risposto HTTP ${res.status}`);
    return json as T;
  };

  return {
    async get<T>(path: string, params: Record<string, string> = {}) {
      const qs = new URLSearchParams(params).toString();
      const res = await f(`${base}${path}${qs ? `?${qs}` : ""}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      return leggi<T>(res);
    },
    async post<T>(path: string, params: Record<string, string> = {}) {
      const body = new URLSearchParams({ ...params, access_token: token }).toString();
      const res = await f(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      return leggi<T>(res);
    },
  };
}

// ─── Cosa pubblicare ─────────────────────────────────────────────────────────

export interface MediaPubblico {
  url: string; // raggiungibile da Meta (https)
  tipo: "image" | "video";
}

export interface PostDaPubblicare {
  platform: string;
  format: string;
  caption: string | null;
  hashtags: string | null;
  media: MediaPubblico[];
}

/** Caption finale: testo + hashtag, con i limiti di Instagram controllati PRIMA di chiamare Meta. */
export function componiCaption(caption: string | null, hashtags: string | null, platform: string): string {
  const testo = (caption ?? "").trim();
  const tag = (hashtags ?? "").trim();
  const finale = [testo, tag].filter(Boolean).join("\n\n");
  if (platform === "instagram") {
    if (finale.length > MAX_CAPTION) {
      throw new ErrorePubblicazione(`Caption troppo lunga per Instagram: ${finale.length} caratteri, il massimo e' ${MAX_CAPTION}.`, true);
    }
    const nTag = (finale.match(/#[^\s#]+/g) ?? []).length;
    if (nTag > MAX_HASHTAG) {
      throw new ErrorePubblicazione(`Troppi hashtag per Instagram: ${nTag}, il massimo e' ${MAX_HASHTAG}.`, true);
    }
  }
  return finale;
}

export type PianoInstagram =
  | { tipo: "image" | "story"; contenitore: Record<string, string> }
  | { tipo: "reel"; contenitore: Record<string, string> }
  | { tipo: "carousel"; figli: Record<string, string>[]; contenitore: Record<string, string> };

/**
 * Le chiamate /media da fare, nell'ordine. Il tipo si deduce dagli asset
 * (un video = Reel, piu' immagini = carosello) e dal formato per le storie.
 */
export function pianoInstagram(post: PostDaPubblicare): PianoInstagram {
  const caption = componiCaption(post.caption, post.hashtags, "instagram");
  const media = post.media;
  if (media.length === 0) throw new ErrorePubblicazione("Instagram non accetta post senza immagine o video: la bozza non ha asset.", true);
  const storia = /stor/i.test(post.format);

  if (storia) {
    const m = media[0];
    return {
      tipo: "story",
      contenitore: m.tipo === "video"
        ? { media_type: "STORIES", video_url: m.url }
        : { media_type: "STORIES", image_url: m.url },
    };
  }

  const video = media.filter((m) => m.tipo === "video");
  if (video.length > 0) {
    if (media.length > 1) {
      throw new ErrorePubblicazione("Un Reel ha un solo video: la bozza ha piu' asset insieme al video.", true);
    }
    return { tipo: "reel", contenitore: { media_type: "REELS", video_url: video[0].url, caption } };
  }

  if (media.length === 1) {
    return { tipo: "image", contenitore: { image_url: media[0].url, caption } };
  }

  if (media.length > MAX_CAROSELLO) {
    throw new ErrorePubblicazione(`Carosello con ${media.length} immagini: Instagram ne accetta al massimo ${MAX_CAROSELLO}.`, true);
  }
  return {
    tipo: "carousel",
    figli: media.map((m) => ({ image_url: m.url, is_carousel_item: "true" })),
    contenitore: { media_type: "CAROUSEL", caption },
  };
}

export interface OpzioniAttesa {
  sleep?: (ms: number) => Promise<void>;
  intervalloMs?: number;
  tentativi?: number;
}

const dormi = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Aspetta che il contenitore sia FINISHED. ERROR/EXPIRED = errore, e Meta spiega perche' in `status`. */
export async function attendiContenitore(graph: GraphClient, id: string, opts: OpzioniAttesa = {}): Promise<void> {
  const sleep = opts.sleep ?? dormi;
  const intervallo = opts.intervalloMs ?? 15_000;
  const tentativi = opts.tentativi ?? 20; // 20 x 15 s = 5 minuti, come suggerisce la guida Meta
  for (let i = 0; i < tentativi; i++) {
    const r = await graph.get<{ status_code?: string; status?: string }>(`/${id}`, { fields: "status_code,status" });
    if (r.status_code === "FINISHED" || r.status_code === "PUBLISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new ErrorePubblicazione(`Instagram ha rifiutato il media (${r.status_code}): ${r.status ?? "nessun dettaglio"}`);
    }
    await sleep(intervallo);
  }
  throw new ErrorePubblicazione("Instagram sta ancora elaborando il video dopo 5 minuti: riprovo al prossimo giro.");
}

/**
 * La chiamata che rende il post pubblico. Se cade per un motivo che NON e' una
 * risposta di Meta (rete, timeout) il post potrebbe essere gia' online:
 * riprovare rischierebbe un doppione sul profilo, quindi l'errore e' definitivo
 * e chiede di guardare il profilo prima di ripianificare.
 */
async function chiamataFinale<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErrorePubblicazione && e.codiceMeta !== undefined) throw e;
    if (e instanceof ErrorePubblicazione && /non leggibile|HTTP/.test(e.message)) {
      throw new ErrorePubblicazione(`Esito incerto (${e.message}): controlla il profilo prima di ripianificare, il post potrebbe essere gia' uscito.`, true);
    }
    if (e instanceof ErrorePubblicazione) throw e;
    throw new ErrorePubblicazione("Esito incerto (connessione con Meta caduta durante la pubblicazione): controlla il profilo prima di ripianificare, il post potrebbe essere gia' uscito.", true);
  }
}

export interface EsitoPubblicazione {
  postId: string;
  permalink: string | null;
}

export async function pubblicaInstagram(
  graph: GraphClient,
  igUserId: string,
  post: PostDaPubblicare,
  opts: OpzioniAttesa = {},
): Promise<EsitoPubblicazione> {
  const piano = pianoInstagram(post);
  let contenitore: Record<string, string> = piano.contenitore;

  if (piano.tipo === "carousel") {
    const figli: string[] = [];
    for (const f of piano.figli) {
      const r = await graph.post<{ id: string }>(`/${igUserId}/media`, f);
      await attendiContenitore(graph, r.id, opts);
      figli.push(r.id);
    }
    contenitore = { ...contenitore, children: figli.join(",") };
  }

  const c = await graph.post<{ id: string }>(`/${igUserId}/media`, contenitore);
  await attendiContenitore(graph, c.id, opts);
  const pub = await chiamataFinale(() => graph.post<{ id: string }>(`/${igUserId}/media_publish`, { creation_id: c.id }));

  // Il post e' gia' online: un permalink che non arriva non e' un fallimento.
  let permalink: string | null = null;
  try {
    const r = await graph.get<{ permalink?: string }>(`/${pub.id}`, { fields: "permalink" });
    permalink = r.permalink ?? null;
  } catch { /* resta null */ }
  return { postId: pub.id, permalink };
}

/**
 * Pagina Facebook: niente immagini = /feed; una = /photos; piu' di una = foto
 * caricate non pubblicate e poi un solo post /feed che le allega tutte.
 */
export async function pubblicaFacebook(graph: GraphClient, pageId: string, post: PostDaPubblicare): Promise<EsitoPubblicazione> {
  const message = componiCaption(post.caption, post.hashtags, "facebook");
  const immagini = post.media.filter((m) => m.tipo === "image");
  const video = post.media.filter((m) => m.tipo === "video");
  if (video.length > 0) {
    throw new ErrorePubblicazione("I video sulla Pagina Facebook non sono ancora supportati da questa pubblicazione automatica.", true);
  }

  let postId: string;
  if (immagini.length === 0) {
    if (!message) throw new ErrorePubblicazione("Post Facebook vuoto: niente testo e niente immagini.", true);
    const r = await chiamataFinale(() => graph.post<{ id: string }>(`/${pageId}/feed`, { message }));
    postId = r.id;
  } else if (immagini.length === 1) {
    const r = await chiamataFinale(() => graph.post<{ id: string; post_id?: string }>(`/${pageId}/photos`, { url: immagini[0].url, message }));
    postId = r.post_id ?? r.id;
  } else {
    const ids: string[] = [];
    for (const m of immagini) {
      const r = await graph.post<{ id: string }>(`/${pageId}/photos`, { url: m.url, published: "false" });
      ids.push(r.id);
    }
    const params: Record<string, string> = { message };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await chiamataFinale(() => graph.post<{ id: string }>(`/${pageId}/feed`, params));
    postId = r.id;
  }

  let permalink: string | null = null;
  try {
    const r = await graph.get<{ permalink_url?: string }>(`/${postId}`, { fields: "permalink_url" });
    permalink = r.permalink_url ?? null;
  } catch { /* resta null */ }
  return { postId, permalink };
}

// ─── Controllo del token ─────────────────────────────────────────────────────

export interface StatoToken {
  configurato: boolean;
  valido: boolean;
  pagina: string | null;
  pageId: string | null;
  igUserId: string | null;
  igUsername: string | null;
  permessiMancanti: string[];
  scadeIl: string | null; // null = non scade
  problemi: string[];
}

/**
 * Legge i permessi del token con /debug_token e la Pagina con il suo IG
 * collegato. Non restituisce mai il token: solo quello che serve a capire se
 * la pubblicazione puo' partire.
 */
export async function controllaToken(
  graph: GraphClient,
  token: string,
  pageIdConfigurato?: string | null,
  opts: { graphDebug?: GraphClient } = {},
): Promise<StatoToken> {
  const stato: StatoToken = {
    configurato: true, valido: false, pagina: null, pageId: pageIdConfigurato ?? null,
    igUserId: null, igUsername: null, permessiMancanti: [], scadeIl: null, problemi: [],
  };

  let debugLetto = false;
  try {
    // /debug_token vuole un token d'app (app_id|secret) se c'e'; altrimenti si prova col token stesso.
    const d = await (opts.graphDebug ?? graph).get<{ data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; type?: string; profile_id?: string } }>(
      "/debug_token", { input_token: token },
    );
    const info = d.data ?? {};
    debugLetto = true;
    stato.valido = info.is_valid === true;
    const scopes = new Set(info.scopes ?? []);
    stato.permessiMancanti = PERMESSI_RICHIESTI.filter((p) => !scopes.has(p));
    stato.scadeIl = info.expires_at && info.expires_at > 0 ? new Date(info.expires_at * 1000).toISOString() : null;
    if (info.type && info.type !== "PAGE") {
      stato.problemi.push(`Il token e' di tipo ${info.type}: serve un token di PAGINA (vedi docs/social-autopublish.md).`);
    }
    if (!stato.pageId && info.type === "PAGE" && info.profile_id) stato.pageId = info.profile_id;
    if (!stato.valido) stato.problemi.push("Meta dice che il token non e' valido (scaduto o revocato).");
  } catch (e) {
    // Senza i permessi si controllano comunque Pagina e Instagram: se rispondono, il token e' vivo.
    stato.problemi.push(`Non riesco a leggere i permessi del token (${e instanceof Error ? e.message : String(e)}). Aggiungi META_APP_ID e META_APP_SECRET su Railway per il controllo completo.`);
  }

  if (!stato.pageId) {
    stato.problemi.push("Manca META_PAGE_ID e il token non dice a quale Pagina appartiene.");
    return stato;
  }

  try {
    const p = await graph.get<{ name?: string; instagram_business_account?: { id: string; username?: string } }>(
      `/${stato.pageId}`, { fields: "name,instagram_business_account{id,username}" },
    );
    stato.pagina = p.name ?? null;
    if (!debugLetto) stato.valido = true; // permessi illeggibili, ma la Pagina risponde: il token e' vivo
    stato.igUserId = p.instagram_business_account?.id ?? null;
    stato.igUsername = p.instagram_business_account?.username ?? null;
    if (!stato.igUserId) stato.problemi.push("La Pagina non ha un account Instagram professionale collegato.");
  } catch (e) {
    stato.problemi.push(e instanceof Error ? e.message : String(e));
  }

  if (stato.permessiMancanti.length) {
    stato.problemi.push(`Permessi mancanti: ${stato.permessiMancanti.join(", ")}.`);
  }
  return stato;
}
