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

export type ModoFonteSocial = "caricate" | "auto";

export type FonteSocial = {
  modo: ModoFonteSocial;
  note?: string;
  aggiornatoIl: string;
};

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
  note?: string;
}): Promise<FonteSocial> {
  const fonte: FonteSocial = {
    modo: input.modo,
    note: input.note?.trim() || undefined,
    aggiornatoIl: new Date().toISOString(),
  };
  await scriviFile(
    PATH_FONTE,
    Buffer.from(JSON.stringify(fonte, null, 2), "utf8"),
    `fonte reference social: ${input.modo}`,
  );
  return fonte;
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
