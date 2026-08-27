/**
 * socialReferences.ts — il materiale per la notte del Social Media Manager.
 *
 * Stesso schema di [productArtistApprovals]: la repo privata dell'agente è
 * l'unica fonte di verità. La web app ci scrive dentro via API GitHub, l'agente
 * la trova al `git pull` che apre il run delle 01:00. Nessun database di mezzo:
 * se la web app è giù l'agente lavora lo stesso, se l'agente è fermo le
 * reference restano comunque caricate.
 *
 * Differenza rispetto al Product Artist: qui le reference sono **screenshot di
 * post che funzionano** (ispirazione), non foto di prodotto. Da quelle l'agente
 * prende struttura, ritmo e angolo — mai le parole. La cartella `prodotto/`
 * serve solo ai caroselli in stile IKONICK, che escono ogni 50-100 post.
 */

const GH_API = "https://api.github.com";

/** I due tipi di materiale, che sono anche le due cartelle nella repo. */
export const TIPI_REFERENCE = ["ispirazione", "prodotto"] as const;
export type TipoReference = (typeof TIPI_REFERENCE)[number];

/**
 * Da dove parte la notte. Nessuna delle modalità inventa da zero: si parte
 * sempre da post che sono già esistiti e hanno già funzionato — regola di Andrea,
 * 2026-08-21: "non devo reinventarmi la ruota".
 *
 *   caricate → gli screenshot che carica lui dalla sezione Bozze
 *   profilo  → i post di UN profilo Instagram che indica per handle o URL
 *   link     → i post (anche caroselli) di cui incolla l'URL diretto
 *   auto     → la CASCATA: prende il primo livello che ha materiale (vedi pianoNotte)
 */
export type ModoFonteSocial = "caricate" | "profilo" | "link" | "auto";

export type FonteSocial = {
  modo: ModoFonteSocial;
  /** usato se modo = "profilo": l'handle normalizzato, senza @ */
  handle?: string;
  note?: string;
  aggiornatoIl: string;
};

/** Da un URL Instagram o da un @handle al solo handle, normalizzato. */
export function normalizzaHandle(raw: string): string {
  let s = String(raw).trim();
  // Un URL: si tiene il primo segmento di path, che è il profilo.
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "").replace(/\/+$/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,60}$/.test(s)) {
    throw new Error(`Handle Instagram non valido: "${raw}". Incolla il link del profilo o @nome.`);
  }
  return s;
}

const PATH_FONTE = "references/_fonte-prossima-notte.json";

function repoSlug(): { owner: string; repo: string } {
  const slug =
    process.env.CREATIVE_DIRECTOR_REPO ||
    "Bilots00/dreambrothers-creative-director-AUTO";
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) {
    throw new Error(`CREATIVE_DIRECTOR_REPO malformato: "${slug}" (atteso "owner/repo")`);
  }
  return { owner, repo };
}

/**
 * Lo stesso token del Product Artist va bene se ha accesso anche a questa repo.
 * Si prova prima quello dedicato, così è possibile separarli senza toccare il codice.
 */
function token(): string {
  const t =
    process.env.CREATIVE_DIRECTOR_GITHUB_TOKEN ||
    process.env.PRODUCT_ARTIST_GITHUB_TOKEN ||
    process.env.SEO_AGENT_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "Manca CREATIVE_DIRECTOR_GITHUB_TOKEN nelle variabili Railway. " +
        "Serve un token GitHub con lettura/scrittura sulla repo dell'agente social.",
    );
  }
  return t;
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dreambrothers-hub",
      ...(init?.headers || {}),
    },
  });
}

async function ghJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gh(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) throw new Error(`Risorsa non trovata su GitHub: ${path}`);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `GitHub ha rifiutato il token (${res.status}). Controlla CREATIVE_DIRECTOR_GITHUB_TOKEN.`,
      );
    }
    throw new Error(`GitHub ${res.status} su ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Oggi in fuso Roma: le reference si organizzano per giornata di lavoro. */
function oggiRoma(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Attenzione al fuso orario: il run parte all'01:00, quindi le reference che
 * Andrea carica di sera valgono per la notte che si apre a mezzanotte. Si
 * scrivono nella cartella del giorno SUCCESSIVO, che è la data con cui l'agente
 * cercherà quando si sveglia.
 */
function giornoDelProssimoRun(): string {
  const adesso = new Date();
  const oraRoma = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hour12: false })
      .format(adesso),
  );
  // Dopo l'01:00 il run di stanotte è già passato: si lavora per domani.
  const giorni = oraRoma >= 1 ? 1 : 0;
  const d = new Date(adesso.getTime() + giorni * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function giornoTarget(): string {
  return giornoDelProssimoRun();
}

/* ------------------------------------------------------------------ */
/* Fonte                                                               */
/* ------------------------------------------------------------------ */

export async function getFonteSocial(): Promise<FonteSocial> {
  const { owner, repo } = repoSlug();
  const file = await ghJson<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${PATH_FONTE}`,
  ).catch(() => null);
  if (!file) return { modo: "caricate", aggiornatoIl: new Date().toISOString() };
  return JSON.parse(
    Buffer.from(file.content, (file.encoding as BufferEncoding) || "base64").toString("utf8"),
  ) as FonteSocial;
}

export async function setFonteSocial(input: {
  modo: ModoFonteSocial;
  handle?: string;
  note?: string;
}): Promise<FonteSocial> {
  if (input.modo === "profilo" && !input.handle?.trim()) {
    throw new Error("Con modo 'profilo' serve il link o l'@handle del profilo Instagram.");
  }
  const fonte: FonteSocial = {
    modo: input.modo,
    handle: input.modo === "profilo" ? normalizzaHandle(input.handle!) : undefined,
    note: input.note?.trim() || undefined,
    aggiornatoIl: new Date().toISOString(),
  };
  await scriviFile(
    PATH_FONTE,
    Buffer.from(JSON.stringify(fonte, null, 2), "utf8"),
    `fonte reference social: ${input.modo}${fonte.handle ? ` (@${fonte.handle})` : ""}`,
  );
  return fonte;
}

/* ------------------------------------------------------------------ */
/* I post di riferimento veri, per l'agente                            */
/* ------------------------------------------------------------------ */

export type PostRiferimento = {
  handle: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  views: number;
  likes: number;
  comments: number;
  outlierScore: number | null;
  pubblicatoIl: string | null;
};

/**
 * I post da cui l'agente parte stanotte, presi dalla Watchlist.
 *
 * Non è un secondo meccanismo: la Watchlist raccoglie già i post dei canali che
 * Andrea segue, con caption, metriche e outlier score. L'agente ne prende i
 * migliori e ne studia struttura, ritmo e attacco — mai le parole.
 *
 * `handle` filtra su un profilo solo (modo "profilo"); senza, si pesca da tutti
 * i canali Instagram della Watchlist (modo "auto").
 */
export async function postDiRiferimento(
  userId: number,
  opts: { handle?: string; limit?: number; lookbackDays?: number } = {},
): Promise<PostRiferimento[]> {
  const { getWatchlistChannels, getWatchlistVideos } = await import("./db");
  const canali = await getWatchlistChannels(userId);
  const instagram = canali.filter((c) => c.platform === "instagram");
  const scelti = opts.handle
    ? instagram.filter((c) => c.handle.toLowerCase() === opts.handle!.toLowerCase())
    : instagram;

  if (opts.handle && scelti.length === 0) {
    throw new Error(
      `@${opts.handle} non è ancora nella Watchlist: aggiungilo da lì (o dal riquadro qui sopra) e attendi il primo refresh.`,
    );
  }
  if (scelti.length === 0) return [];

  /**
   * Il profilo scelto è in Watchlist ma non ha ancora nessun post raccolto?
   * Non si torna a mani vuote: si pesca da tutti i canali Instagram.
   *
   * Successo il 2026-08-27: la fonte era "profilo → ikonick", ikonick è un
   * account business per cui l'endpoint di Instagram è rotto (bug loro, dà 400
   * anche da un browser normale), quindi zero post — e la notte si è fermata a
   * zero bozze mentre in Watchlist c'erano decine di post di altri canali.
   * Meglio partire da un post buono di un altro canale che da niente.
   */
  const conPost = async (canali: typeof scelti) => {
    const ammessi = new Set(canali.map((c) => c.id));
    const video = await getWatchlistVideos(userId, {
      platform: "instagram",
      lookbackDays: opts.lookbackDays ?? 90,
      sort: "outlier",
      limit: (opts.limit ?? 12) * 3,
    });
    return video.filter((v) => ammessi.has(v.channelId)).filter((v) => (v.title ?? "").trim().length > 0);
  };

  let usati = scelti;
  if (opts.handle && (await conPost(scelti)).length === 0 && instagram.length > scelti.length) {
    usati = instagram;
  }
  const scelti2 = usati;

  const ammessi = new Set(scelti2.map((c) => c.id));
  const video = await getWatchlistVideos(userId, {
    platform: "instagram",
    lookbackDays: opts.lookbackDays ?? 90,
    sort: "outlier",
    limit: (opts.limit ?? 12) * 3,
  });

  return video
    .filter((v) => ammessi.has(v.channelId))
    // Un post senza caption non insegna niente sulla struttura del testo.
    .filter((v) => (v.title ?? "").trim().length > 0)
    .slice(0, opts.limit ?? 12)
    .map((v) => ({
      handle: v.channelHandle ?? "",
      url: v.url,
      thumbnailUrl: v.thumbnailUrl ?? null,
      caption: v.title ?? null,
      views: Number(v.views ?? 0),
      likes: Number(v.likes ?? 0),
      comments: Number(v.comments ?? 0),
      outlierScore: v.outlierScore == null ? null : Number(v.outlierScore),
      pubblicatoIl: v.publishedAt ? new Date(v.publishedAt).toISOString() : null,
    }));
}

/* ------------------------------------------------------------------ */
/* Reference                                                           */
/* ------------------------------------------------------------------ */

export type FileReferenceSocial = {
  path: string;
  nome: string;
  tipo: TipoReference;
  giorno: string;
  size: number;
  sha: string;
};

type ContentItem = { name: string; path: string; type: string; sha: string; size: number };

/** Le reference caricate per la prossima notte. */
export async function listaReferenceSocial(giorno?: string): Promise<FileReferenceSocial[]> {
  const g = giorno || giornoDelProssimoRun();
  const { owner, repo } = repoSlug();
  const out: FileReferenceSocial[] = [];
  for (const tipo of TIPI_REFERENCE) {
    const items = await ghJson<ContentItem[]>(
      `/repos/${owner}/${repo}/contents/references/${tipo}/${encodeURIComponent(g)}`,
    ).catch(() => [] as ContentItem[]);
    for (const i of items) {
      if (i.type !== "file") continue;
      out.push({ path: i.path, nome: i.name, tipo, giorno: g, size: i.size, sha: i.sha });
    }
  }
  return out;
}

export async function caricaReferenceSocial(input: {
  tipo: TipoReference;
  nomeFile: string;
  base64: string;
  giorno?: string;
}): Promise<FileReferenceSocial> {
  // Il nome arriva dal browser: si ripulisce prima di farlo diventare un path.
  const nome = input.nomeFile.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  if (!nome || nome.startsWith(".")) throw new Error("nome file non valido");

  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("immagine troppo grande (max 12 MB)");

  const g = input.giorno || giornoDelProssimoRun();
  const path = `references/${input.tipo}/${g}/${nome}`;
  await scriviFile(path, bytes, `reference social caricata: ${input.tipo}/${nome}`);
  return { path, nome, tipo: input.tipo, giorno: g, size: bytes.length, sha: "" };
}

export async function eliminaReferenceSocial(path: string): Promise<void> {
  if (!path.startsWith("references/") || path.includes("..")) {
    throw new Error("percorso non valido");
  }
  const { owner, repo } = repoSlug();
  const meta = await ghJson<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`);
  await ghJson(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({
      message: `web app: rimossa reference social ${path.split("/").pop()}`,
      sha: meta.sha,
      committer: { name: "DreamBrothers HUB", email: "hub@dreambrothers.local" },
    }),
  });
}

/** L'anteprima di una reference: la repo è privata, quindi passa da qui. */
export async function immagineReferenceSocial(
  path: string,
): Promise<{ base64: string; mime: string } | null> {
  if (!path.startsWith("references/") || path.includes("..")) {
    throw new Error("percorso non valido");
  }
  const { owner, repo } = repoSlug();
  const meta = await ghJson<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`).catch(
    () => null,
  );
  if (!meta?.sha) return null;
  const blob = await ghJson<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
  ).catch(() => null);
  if (!blob?.content) return null;
  const ext = path.split(".").pop()?.toLowerCase();
  const mime =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return { base64: blob.content.replace(/\n/g, ""), mime };
}

/** Scrittura generica su GitHub: crea o aggiorna, gestendo lo sha se il file esiste. */
async function scriviFile(path: string, contenuto: Buffer, messaggio: string): Promise<void> {
  const { owner, repo } = repoSlug();
  const esistente = await ghJson<{ sha: string }>(
    `/repos/${owner}/${repo}/contents/${path}`,
  ).catch(() => null);
  await ghJson(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `web app: ${messaggio}`,
      content: contenuto.toString("base64"),
      sha: esistente?.sha,
      committer: { name: "DreamBrothers HUB", email: "hub@dreambrothers.local" },
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Post indicati per link/URL                                          */
/* ------------------------------------------------------------------ */

/**
 * La tab "Da un link/URL" della sezione Bozze.
 *
 * Differenza dal modo "profilo": lì si indica un profilo e la Watchlist ne
 * raccoglie i post migliori; qui Andrea punta il dito su UN post preciso —
 * caroselli compresi, che in Watchlist non entrano perché lo scraper del feed
 * ne salva solo la copertina. L'analisi vera la fa l'agente sul VPS, che è
 * loggato a Instagram con l'account di servizio: da qui parte solo l'URL.
 */
export type LinkReference = {
  /** URL normalizzato del post, senza query di tracciamento. */
  url: string;
  /** Lo shortcode Instagram (la parte dopo /p/ o /reel/): è l'identità del post. */
  shortcode: string;
  /** post | reel — dedotto dall'URL, l'agente lo corregge se scopre un carosello. */
  tipo: "post" | "reel" | "carosello";
  note?: string;
  aggiuntoIl: string;
  /** Il giorno di run per cui vale: come per le reference caricate. */
  giorno: string;
  stato: "in-attesa" | "usato" | "fallito";
  usatoIl?: string;
  draftId?: number;
  /** Se stato = "fallito": perché, così si vede in UI invece di sparire. */
  errore?: string;
};

const PATH_LINK = "references/_link-prossima-notte.json";

/**
 * Da un URL Instagram allo shortcode del post.
 *
 * Si accettano /p/, /reel/, /reels/ e /tv/ — sono tutte forme dello stesso
 * contenuto. Tutto il resto viene rifiutato con un messaggio che dice cosa
 * incollare: un link al PROFILO qui non serve, per quello c'è l'altra tab.
 */
export function normalizzaLinkPost(raw: string): { url: string; shortcode: string; tipo: "post" | "reel" } {
  const s = String(raw).trim();
  const m = s.match(/instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i);
  if (!m) {
    if (/instagram\.com\//i.test(s)) {
      throw new Error(
        `Questo è un link a un profilo, non a un post: "${s}". Apri il post e copia il suo link (contiene /p/ o /reel/), oppure usa la tab "Da un profilo".`,
      );
    }
    throw new Error(`Link Instagram non valido: "${s}". Serve un URL tipo https://www.instagram.com/p/ABC123/`);
  }
  const tipo = m[1].toLowerCase().startsWith("reel") ? ("reel" as const) : ("post" as const);
  const shortcode = m[2];
  // Si ricostruisce pulito: via query di tracciamento (igshid, utm_*) e frammenti.
  return { url: `https://www.instagram.com/${tipo === "reel" ? "reel" : "p"}/${shortcode}/`, shortcode, tipo };
}

async function leggiJson<T>(path: string, fallback: T): Promise<T> {
  const { owner, repo } = repoSlug();
  const file = await ghJson<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${path}`,
  ).catch(() => null);
  if (!file) return fallback;
  try {
    return JSON.parse(
      Buffer.from(file.content, (file.encoding as BufferEncoding) || "base64").toString("utf8"),
    ) as T;
  } catch {
    return fallback;
  }
}

async function scriviJson(path: string, dati: unknown, messaggio: string): Promise<void> {
  await scriviFile(path, Buffer.from(JSON.stringify(dati, null, 2), "utf8"), messaggio);
}

/** I link in coda. Senza `giorno` si vedono quelli della prossima notte. */
export async function listaLinkReference(giorno?: string): Promise<LinkReference[]> {
  const tutti = await leggiJson<LinkReference[]>(PATH_LINK, []);
  const g = giorno || giornoDelProssimoRun();
  return tutti.filter((l) => l.giorno === g);
}

/** Tutti i link, comprese le notti passate: serve all'agente e al registro. */
export async function listaLinkReferenceTutti(): Promise<LinkReference[]> {
  return leggiJson<LinkReference[]>(PATH_LINK, []);
}

export async function aggiungiLinkReference(input: {
  url: string;
  note?: string;
  giorno?: string;
}): Promise<LinkReference> {
  const { url, shortcode, tipo } = normalizzaLinkPost(input.url);
  const g = input.giorno || giornoDelProssimoRun();
  const tutti = await listaLinkReferenceTutti();

  // Stesso post già in coda per la stessa notte: non si duplica, si riabilita.
  const gia = tutti.find((l) => l.shortcode === shortcode && l.giorno === g);
  if (gia) {
    gia.note = input.note?.trim() || gia.note;
    gia.stato = "in-attesa";
    delete gia.errore;
    await scriviJson(PATH_LINK, tutti, `link reference aggiornato: ${shortcode}`);
    return gia;
  }

  const voce: LinkReference = {
    url,
    shortcode,
    tipo,
    note: input.note?.trim() || undefined,
    aggiuntoIl: new Date().toISOString(),
    giorno: g,
    stato: "in-attesa",
  };
  tutti.push(voce);
  await scriviJson(PATH_LINK, tutti, `link reference aggiunto: ${shortcode}`);
  return voce;
}

export async function rimuoviLinkReference(shortcode: string): Promise<void> {
  const tutti = await listaLinkReferenceTutti();
  const restanti = tutti.filter((l) => l.shortcode !== shortcode);
  if (restanti.length === tutti.length) return;
  await scriviJson(PATH_LINK, restanti, `link reference rimosso: ${shortcode}`);
}

/** L'agente marca cosa ha usato (o cosa non è riuscito a leggere). */
export async function marcaLinkReference(
  shortcode: string,
  patch: Partial<Pick<LinkReference, "stato" | "tipo" | "draftId" | "errore">>,
): Promise<void> {
  const tutti = await listaLinkReferenceTutti();
  const voce = tutti.find((l) => l.shortcode === shortcode);
  if (!voce) return;
  Object.assign(voce, patch);
  if (patch.stato === "usato") voce.usatoIl = new Date().toISOString();
  await scriviJson(PATH_LINK, tutti, `link reference ${shortcode}: ${patch.stato ?? "aggiornato"}`);
}

/* ------------------------------------------------------------------ */
/* Registro delle reference già usate                                  */
/* ------------------------------------------------------------------ */

/**
 * Perché esiste: la cartella del PC ha centinaia di immagini, e senza memoria
 * l'agente ripescherebbe le stesse ogni notte. Il registro tiene traccia di
 * cosa è già stato usato e in che stato è finito.
 *
 * Regola di Andrea (fase di test, 2026-08-27): la reference NON si sposta dalla
 * cartella finché lui non ha APPROVATO la bozza nata da quella reference. Finché
 * la bozza è in prova la reference resta lì e resta marcata "in-prova"; se la
 * bozza viene scartata la reference torna libera e può essere ritentata. Finita
 * la fase di test basta accendere SPOSTA_REFERENCE_USATE sul mirror e le
 * approvate migrano in _usate/ sul PC.
 */
export type StatoReference = "in-prova" | "approvata" | "scartata";

export type VoceRegistro = {
  /** Chiave: per la cartella PC il nome file, per i link lo shortcode. */
  chiave: string;
  origine: "cartella" | "link" | "caricate" | "watchlist";
  usataIl: string;
  stato: StatoReference;
  draftId?: number;
  /** Quante volte è stata data in pasto all'agente: per non insistere all'infinito. */
  tentativi: number;
};

const PATH_REGISTRO = "state/reference-usate.json";

export async function registroReference(): Promise<Record<string, VoceRegistro>> {
  return leggiJson<Record<string, VoceRegistro>>(PATH_REGISTRO, {});
}

/**
 * Le chiavi da NON riproporre stanotte: tutto ciò che è approvato (ha già dato
 * il suo post) o è in prova (aspetta il giudizio di Andrea). Le scartate tornano
 * libere: la reference non aveva colpa, il post sì.
 */
export async function chiaviOccupate(): Promise<Set<string>> {
  const reg = await registroReference();
  return new Set(
    Object.values(reg)
      .filter((v) => v.stato === "in-prova" || v.stato === "approvata")
      .map((v) => v.chiave),
  );
}

export async function marcaReferenceUsata(input: {
  chiave: string;
  origine: VoceRegistro["origine"];
  draftId?: number;
}): Promise<void> {
  const reg = await registroReference();
  const prima = reg[input.chiave];
  reg[input.chiave] = {
    chiave: input.chiave,
    origine: input.origine,
    usataIl: new Date().toISOString(),
    stato: "in-prova",
    draftId: input.draftId ?? prima?.draftId,
    tentativi: (prima?.tentativi ?? 0) + 1,
  };
  await scriviJson(PATH_REGISTRO, reg, `reference in prova: ${input.chiave}`);
}

/** Scrittura in blocco: l'agente marca tutte le reference di una notte in un colpo solo. */
export async function marcaReferenceUsateMolte(
  voci: Array<{ chiave: string; origine: VoceRegistro["origine"]; draftId?: number }>,
): Promise<number> {
  if (voci.length === 0) return 0;
  const reg = await registroReference();
  for (const v of voci) {
    const prima = reg[v.chiave];
    reg[v.chiave] = {
      chiave: v.chiave,
      origine: v.origine,
      usataIl: new Date().toISOString(),
      stato: "in-prova",
      draftId: v.draftId ?? prima?.draftId,
      tentativi: (prima?.tentativi ?? 0) + 1,
    };
  }
  await scriviJson(PATH_REGISTRO, reg, `${voci.length} reference marcate in prova`);
  return voci.length;
}

/**
 * Il verdetto di Andrea sulla bozza si riversa sulla reference che l'ha generata.
 * Chiamata dal router quando una bozza cambia stato: approvata/pianificata →
 * la reference è consumata per sempre; scartata → torna libera.
 */
export async function esitoBozzaSuReference(draftId: number, esito: StatoReference): Promise<void> {
  const reg = await registroReference();
  const voci = Object.values(reg).filter((v) => v.draftId === draftId);
  if (voci.length === 0) return;
  for (const v of voci) reg[v.chiave] = { ...v, stato: esito };
  await scriviJson(PATH_REGISTRO, reg, `bozza ${draftId} ${esito}: ${voci.length} reference aggiornate`);
}

/* ------------------------------------------------------------------ */
/* La cartella di reference sul PC di Andrea                           */
/* ------------------------------------------------------------------ */

/**
 * Il mirror (scripts/mirror-reference.sh sul PC) copia i file sul VPS e poi
 * deposita qui l'elenco: la web app non vede il disco di Andrea, ma con questo
 * manifest può dire quante reference ci sono e quante ne restano da usare.
 *
 * I caroselli si riconoscono dal nome che Instagram dà ai download:
 * `<handle>_<timestampDelPost>_<idMedia>_<idUtente>.webp` — le slide dello
 * stesso post condividono handle e timestamp, ed è quello il raggruppamento.
 */
export type ManifestCartella = {
  aggiornatoIl: string;
  /** Il percorso sul PC, così in UI si vede da dove arriva la roba. */
  cartellaPc: string;
  /** Dove sono finiti i file sul VPS: è il path che legge l'agente. */
  cartellaVps: string;
  file: Array<{ nome: string; size: number; gruppo: string | null }>;
};

const PATH_MANIFEST = "state/cartella-pc.json";

export async function manifestCartella(): Promise<ManifestCartella | null> {
  return leggiJson<ManifestCartella | null>(PATH_MANIFEST, null);
}

export async function salvaManifestCartella(m: ManifestCartella): Promise<void> {
  await scriviJson(PATH_MANIFEST, m, `manifest cartella PC: ${m.file.length} file`);
}

/* ------------------------------------------------------------------ */
/* La cascata: da dove parte davvero la notte                          */
/* ------------------------------------------------------------------ */

export type LivelloFonte = "caricate" | "link" | "cartella" | "watchlist";

export type Livello = {
  livello: LivelloFonte;
  /** Quanti pezzi di materiale ANCORA usabili ci sono a questo livello. */
  disponibili: number;
  /** Una riga per la UI e per il log dell'agente. */
  dettaglio: string;
};

export type PianoNotte = {
  modo: ModoFonteSocial;
  giorno: string;
  livelli: Livello[];
  /** Il primo livello con materiale: è da lì che parte l'agente. */
  scelto: LivelloFonte | null;
};

/**
 * L'ordine di precedenza della modalità AUTOMATICO, deciso da Andrea il
 * 2026-08-27, che vale anche come ripiego per le altre modalità:
 *
 *   1. caricate  — quello che ha caricato A MANO oggi dalla sezione Bozze
 *   2. link      — i post di cui ha incollato l'URL (caroselli compresi)
 *   3. cartella  — le reference della sua cartella sul PC, mai usate prima
 *   4. watchlist — ULTIMO ripiego, solo se sopra non è rimasto niente
 *
 * La Watchlist per ultima è una scelta precisa: è l'unica fonte che non è
 * passata dalle sue mani, quindi vale solo quando le altre tre sono a secco.
 */
export const ORDINE_CASCATA: LivelloFonte[] = ["caricate", "link", "cartella", "watchlist"];

export async function pianoNotte(
  userId: number,
  opts: { giorno?: string } = {},
): Promise<PianoNotte> {
  const g = opts.giorno || giornoDelProssimoRun();
  const fonte = await getFonteSocial().catch(() => null);
  const modo = fonte?.modo ?? "auto";

  const [caricate, link, manifest, occupate] = await Promise.all([
    listaReferenceSocial(g).catch(() => [] as FileReferenceSocial[]),
    listaLinkReference(g).catch(() => [] as LinkReference[]),
    manifestCartella().catch(() => null),
    chiaviOccupate().catch(() => new Set<string>()),
  ]);

  const linkLiberi = link.filter((l) => l.stato === "in-attesa");
  const tuttiFile = manifest?.file ?? [];
  const fileLiberi = tuttiFile.filter((f) => !occupate.has(f.nome));
  // Un carosello vale UNO: le sue slide sono un post solo, non otto reference.
  const pezziLiberi = new Set(fileLiberi.map((f) => f.gruppo ?? f.nome)).size;
  const pezziTotali = new Set(tuttiFile.map((f) => f.gruppo ?? f.nome)).size;

  const postWatchlist = await postDiRiferimento(userId, {
    handle: modo === "profilo" ? fonte?.handle : undefined,
    limit: 12,
  }).catch(() => [] as PostRiferimento[]);

  const perLivello: Record<LivelloFonte, Livello> = {
    caricate: {
      livello: "caricate",
      disponibili: caricate.length,
      dettaglio: caricate.length
        ? `${caricate.length} reference caricate a mano per il ${g}`
        : "nessuna reference caricata per questa notte",
    },
    link: {
      livello: "link",
      disponibili: linkLiberi.length,
      dettaglio: linkLiberi.length
        ? `${linkLiberi.length} post da URL in coda (${linkLiberi.map((l) => l.shortcode).join(", ")})`
        : "nessun link in coda",
    },
    cartella: {
      livello: "cartella",
      disponibili: pezziLiberi,
      dettaglio: manifest
        ? `${pezziLiberi} reference mai usate su ${pezziTotali} nella cartella del PC`
        : "cartella del PC non ancora sincronizzata sul VPS",
    },
    watchlist: {
      livello: "watchlist",
      disponibili: postWatchlist.length,
      dettaglio: postWatchlist.length
        ? `${postWatchlist.length} post dalla Watchlist (ultimo ripiego)`
        : "Watchlist senza post utilizzabili",
    },
  };

  // In modalità "profilo" la Watchlist filtrata su quel profilo È la fonte
  // scelta: la cascata resta come rete di sicurezza se quel profilo dà zero.
  const ordine: LivelloFonte[] =
    modo === "profilo"
      ? ["watchlist", "caricate", "link", "cartella"]
      : modo === "caricate"
        ? ["caricate", "link", "cartella", "watchlist"]
        : modo === "link"
          ? ["link", "caricate", "cartella", "watchlist"]
          : ORDINE_CASCATA;

  const livelli = ordine.map((l) => perLivello[l]);
  const scelto = livelli.find((l) => l.disponibili > 0)?.livello ?? null;

  return { modo, giorno: g, livelli, scelto };
}
