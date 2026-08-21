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
 * Da dove parte la notte. Nessuna delle tre modalità inventa da zero: si parte
 * sempre da post che sono già esistiti e hanno già funzionato — regola di Andrea,
 * 2026-08-21: "non devo reinventarmi la ruota".
 *
 *   caricate → gli screenshot che carica lui
 *   profilo  → i post di UN profilo Instagram che indica per handle o URL
 *   auto     → i post migliori dei canali che segue già nella Watchlist
 */
export type ModoFonteSocial = "caricate" | "profilo" | "auto";

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

  const ammessi = new Set(scelti.map((c) => c.id));
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
