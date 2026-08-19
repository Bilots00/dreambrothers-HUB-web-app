/**
 * Product Artist Approvals — i design che l'agente notturno ha prodotto e che
 * aspettano il sì o il no di Andrea.
 *
 * Stesso schema di [seoApprovals]: la repo privata dell'agente è l'unica fonte di
 * verità. L'agente gira sul VPS (cron 02:00 + `claude -p`), genera i design, li
 * committa insieme a un `batch.json` per data; questa web app legge quel file,
 * ci riscrive sopra la decisione, e l'agente la rilegge al `git pull` successivo
 * per far partire la catena a valle (Printify, Pinterest, ads) o per cancellare
 * i file dei design rifiutati.
 *
 * Niente DB e niente stato duplicato: se la web app è giù l'agente continua a
 * produrre; se l'agente è fermo le decisioni restano comunque registrate.
 */

import { pubblicaProdotto, dimensioniPng, MIN_LATO_LUNGO } from "./printify";
import { generaCreative, type PacchettoCreativo } from "./creativeDirector";

const GH_API = "https://api.github.com";

export type DecisioneDesign = "in_attesa" | "approvato" | "rifiutato";

export const DECISIONI_DESIGN: DecisioneDesign[] = ["in_attesa", "approvato", "rifiutato"];

/**
 * Stato della pubblicazione su Printify → Shopify.
 *
 * Vive dentro il design e non in un database: se la web app riparte, lo stato
 * è ancora lì, e l'agente sul VPS lo legge al `git pull` successivo senza dover
 * interrogare nessuno.
 */
export type Pubblicazione = {
  stato: "in_corso" | "pubblicato" | "errore";
  avviataIl: string;
  productId?: string;
  shopId?: number;
  url?: string;
  mockup?: string | null;
  prezzoDa?: number | null;
  varianti?: number;
  conclusaIl?: string;
  errore?: string;
  /** avviso non bloccante: artwork sotto la risoluzione di stampa consigliata */
  avvisoQualita?: string;
};

export type Design = {
  id: string;
  file: string;
  concept: string;
  avatar: string;
  prodotto: string;
  fornitore: string;
  testoDaComporre: string;
  tipo: "apparel" | "wallart";
  decisione: DecisioneDesign;
  decisoIl: string | null;
  note: string | null;
  /** true quando la catena a valle è già stata eseguita dall'agente */
  applicato: boolean;
  /** compilato dalla web app quando il design viene approvato */
  pubblicazione?: Pubblicazione;
  /** le creatività pubblicitarie generate dal Creative Director */
  creative?: PacchettoCreativo;
};

export type Batch = {
  data: string;
  generatoIl: string;
  totale: number;
  inAttesa: number;
  design: Design[];
  /** sha del batch.json su GitHub: serve per scrivere senza sovrascrivere altri */
  sha?: string;
};

function repoSlug(): { owner: string; repo: string } {
  const slug = process.env.PRODUCT_ARTIST_REPO || "Bilots00/dreambrothers-product-artist-AUTO";
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`PRODUCT_ARTIST_REPO malformato: "${slug}" (atteso "owner/repo")`);
  return { owner, repo };
}

function token(): string {
  const t =
    process.env.PRODUCT_ARTIST_GITHUB_TOKEN ||
    process.env.SEO_AGENT_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "Manca PRODUCT_ARTIST_GITHUB_TOKEN nelle variabili Railway. " +
        "Serve un token GitHub con lettura/scrittura sulla repo dell'agente Product Artist.",
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
      throw new Error(`GitHub ha rifiutato il token (${res.status}). Controlla PRODUCT_ARTIST_GITHUB_TOKEN.`);
    }
    if (res.status === 409) {
      throw new Error("Conflitto su GitHub: il batch è cambiato nel frattempo. Ricarica la pagina e riprova.");
    }
    throw new Error(`GitHub ${res.status} su ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Lettura                                                             */
/* ------------------------------------------------------------------ */

type ContentItem = { name: string; path: string; type: string; sha: string };

/**
 * Le date disponibili, dalla più recente. Una cartella per notte.
 *
 * Gli errori NON si ingoiano: una pagina vuota che non spiega perché è vuota
 * manda a caccia del problema sbagliato (successo il 2026-08-12, il token non
 * vedeva la repo e la pagina diceva solo "nessun design").
 */
export async function listaBatch(): Promise<string[]> {
  const { owner, repo } = repoSlug();
  let items: ContentItem[];
  try {
    items = await ghJson<ContentItem[]>(`/repos/${owner}/${repo}/contents/output`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/non trovata/i.test(msg)) {
      throw new Error(
        `La repo ${owner}/${repo} non è raggiungibile col token configurato. ` +
          `Verifica che PRODUCT_ARTIST_GITHUB_TOKEN esista su Railway e abbia accesso a QUESTA repo ` +
          `(un token fine-grained limitato ad altre repo restituisce lo stesso 404).`,
      );
    }
    throw e;
  }
  // Solo le cartelle che sono ESATTAMENTE una data: le prove e gli scarti vivono
  // altrove. Con un prefisso invece di un match esatto, una cartella tipo
  // "2026-08-12-test-landscape" finiva in cima all'elenco e la pagina si apriva
  // su un batch inesistente (successo il 2026-08-12).
  return items
    .filter(i => i.type === "dir" && /^\d{4}-\d{2}-\d{2}$/.test(i.name))
    .map(i => i.name)
    .sort()
    .reverse();
}

/** Il batch di una data. Senza argomento prende il più recente. */
export async function getBatch(data?: string): Promise<Batch | null> {
  const date = data || (await listaBatch())[0];
  if (!date) return null;

  const { owner, repo } = repoSlug();
  const file = await ghJson<{ content: string; encoding: string; sha: string }>(
    `/repos/${owner}/${repo}/contents/output/${encodeURIComponent(date)}/batch.json`,
  ).catch(() => null);
  if (!file) return null;

  const json = Buffer.from(file.content, (file.encoding as BufferEncoding) || "base64").toString("utf8");
  const batch = JSON.parse(json) as Batch;
  batch.sha = file.sha;
  batch.inAttesa = batch.design.filter(d => d.decisione === "in_attesa").length;
  return batch;
}

/**
 * L'immagine di un design, servita dalla web app.
 *
 * La repo è privata, quindi i raw.githubusercontent non sono raggiungibili dal
 * browser: il contenuto passa da qui, che è già autenticato col token.
 */
export async function getImmagine(data: string, file: string): Promise<{ base64: string; mime: string } | null> {
  if (file.includes("..") || file.includes("/")) throw new Error("nome file non valido");
  const { owner, repo } = repoSlug();

  const meta = await ghJson<{ content: string; encoding: string; sha: string; size: number }>(
    `/repos/${owner}/${repo}/contents/output/${encodeURIComponent(data)}/${encodeURIComponent(file)}`,
  ).catch(() => null);
  if (!meta) return null;

  const mime = file.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";

  // Sotto il megabyte l'API Contents restituisce già il contenuto.
  if (meta.content) return { base64: meta.content.replace(/\n/g, ""), mime };

  // Oltre 1 MB torna il metadato con `content` VUOTO, senza errore: i PNG dei
  // design pesano 1,5-2,8 MB, quindi metà anteprime restavano bianche senza che
  // niente segnalasse un problema. Sopra quella soglia si passa dall'API Blobs,
  // che arriva fino a 100 MB.
  const blob = await ghJson<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/git/blobs/${meta.sha}`,
  ).catch(() => null);
  if (!blob?.content) return null;

  return { base64: blob.content.replace(/\n/g, ""), mime };
}

/* ------------------------------------------------------------------ */
/* Scrittura                                                           */
/* ------------------------------------------------------------------ */

export async function decidiDesign(input: {
  data: string;
  id: string;
  /** "in_attesa" è il ripensamento: riporta il design indietro e ferma il timer. */
  decisione: DecisioneDesign;
  note?: string;
  sha?: string;
}): Promise<Batch> {
  const batch = await getBatch(input.data);
  if (!batch) throw new Error(`Nessun batch per la data ${input.data}`);

  // Se il client ha in mano una versione vecchia si ferma: due decisioni
  // sovrapposte non devono cancellarsi a vicenda.
  if (input.sha && batch.sha && input.sha !== batch.sha) {
    throw new Error("Il batch è cambiato nel frattempo. Ricarica la pagina e riprova.");
  }

  const design = batch.design.find(d => d.id === input.id);
  if (!design) throw new Error(`Design "${input.id}" non trovato nel batch ${input.data}`);
  if (design.applicato) {
    throw new Error(`"${input.id}" è già stato eseguito dall'agente: la decisione non è più modificabile.`);
  }

  design.decisione = input.decisione;
  design.decisoIl = new Date().toISOString();
  design.note = input.note?.trim() || null;
  batch.inAttesa = batch.design.filter(d => d.decisione === "in_attesa").length;

  await scriviBatch(batch, `decisione: ${input.id} → ${input.decisione}`);

  // Approvare È la decisione: da qui il prodotto parte da solo verso Printify
  // e quindi Shopify. Non si aspetta il risultato, così un Printify lento non
  // blocca la pagina; lo stato compare dentro il design.
  if (input.decisione === "approvato") avviaPubblicazione(input.data, input.id);

  return batch;
}

/** Decide più design in un colpo solo (i pulsanti "approva tutti" / "scarta i restanti"). */
export async function decidiMolti(input: {
  data: string;
  ids: string[];
  decisione: Exclude<DecisioneDesign, "in_attesa">;
}): Promise<Batch> {
  const batch = await getBatch(input.data);
  if (!batch) throw new Error(`Nessun batch per la data ${input.data}`);

  const quando = new Date().toISOString();
  let toccati = 0;
  for (const d of batch.design) {
    if (!input.ids.includes(d.id) || d.applicato) continue;
    d.decisione = input.decisione;
    d.decisoIl = quando;
    toccati++;
  }
  if (!toccati) return batch;

  batch.inAttesa = batch.design.filter(d => d.decisione === "in_attesa").length;
  await scriviBatch(batch, `decisione multipla: ${toccati} design → ${input.decisione}`);

  if (input.decisione === "approvato") {
    for (const id of input.ids) avviaPubblicazione(input.data, id);
  }

  return batch;
}

/* ------------------------------------------------------------------ */
/* Pubblicazione su Printify → Shopify                                 */
/* ------------------------------------------------------------------ */

/**
 * Le scritture su batch.json passano tutte da qui, una per volta.
 *
 * Approvare più design insieme fa partire più pubblicazioni in parallelo: senza
 * questa coda ognuna rileggerebbe il file prima che la precedente lo abbia
 * scritto, e l'ultima cancellerebbe il lavoro delle altre.
 */
let coda: Promise<unknown> = Promise.resolve();

function inCoda<T>(lavoro: () => Promise<T>): Promise<T> {
  const prossimo = coda.then(lavoro, lavoro);
  coda = prossimo.catch(() => {});
  return prossimo;
}

/** Applica una modifica a un design rileggendo sempre lo stato fresco. */
async function aggiornaDesign(
  data: string,
  id: string,
  patch: (d: Design) => void,
  messaggio: string,
): Promise<void> {
  await inCoda(async () => {
    const batch = await getBatch(data);
    if (!batch) return;
    const design = batch.design.find(d => d.id === id);
    if (!design) return;
    patch(design);
    await scriviBatch(batch, messaggio);
  });
}

/**
 * Porta un design approvato su Printify e da lì sullo store Shopify.
 *
 * Gira in background rispetto all'approvazione: se Printify è lento o giù, il
 * sì di Andrea resta comunque registrato e l'errore finisce dentro il design,
 * visibile nella pagina, invece di far fallire la decisione.
 */
export async function pubblicaDesign(data: string, id: string): Promise<void> {
  const batch = await getBatch(data);
  const design = batch?.design.find(d => d.id === id);
  if (!design) return;
  if (design.pubblicazione?.stato === "pubblicato" || design.pubblicazione?.stato === "in_corso") return;

  await aggiornaDesign(
    data,
    id,
    d => {
      d.pubblicazione = { stato: "in_corso", avviataIl: new Date().toISOString() };
    },
    `pubblicazione avviata: ${id}`,
  );

  try {
    const img = await getImmagine(data, design.file);
    if (!img) throw new Error(`Immagine ${design.file} non trovata nella repo dell'agente.`);

    // La stampa non si blocca per la risoluzione, ma l'avviso resta scritto:
    // un artwork piccolo stampato grande si vede, e va saputo prima dei resi.
    const dim = dimensioniPng(img.base64);
    const avvisoQualita =
      dim && Math.max(dim.w, dim.h) < MIN_LATO_LUNGO
        ? `Artwork ${dim.w}×${dim.h}px: sotto i ${MIN_LATO_LUNGO}px consigliati per la stampa. Va fatto l'upscale prima di spingerlo con le ads.`
        : undefined;

    const titolo = titoloProdotto(design);
    const pubblicato = await pubblicaProdotto({
      nomeFile: design.file,
      base64: img.base64,
      titolo,
      descrizione: descrizioneProdotto(design),
      tipo: design.tipo,
      tags: [design.avatar, design.tipo, "DreamBrothers"].filter(Boolean),
    });

    await aggiornaDesign(
      data,
      id,
      d => {
        d.pubblicazione = {
          stato: "pubblicato",
          avviataIl: d.pubblicazione?.avviataIl || new Date().toISOString(),
          conclusaIl: pubblicato.pubblicatoIl,
          productId: pubblicato.productId,
          shopId: pubblicato.shopId,
          url: pubblicato.url,
          mockup: pubblicato.mockup,
          prezzoDa: pubblicato.prezzoDa,
          varianti: pubblicato.varianti,
          avvisoQualita,
        };
        d.applicato = true;
      },
      `pubblicato su Printify: ${id}`,
    );
  } catch (e) {
    const errore = e instanceof Error ? e.message : String(e);
    await aggiornaDesign(
      data,
      id,
      d => {
        d.pubblicazione = {
          stato: "errore",
          avviataIl: d.pubblicazione?.avviataIl || new Date().toISOString(),
          conclusaIl: new Date().toISOString(),
          errore,
        };
      },
      `pubblicazione fallita: ${id}`,
    );
  }
}

/** Titolo commerciale: il testo del design è già la promessa, il resto è contorno. */
function titoloProdotto(d: Design): string {
  const frase = (d.testoDaComporre || "").replace(/"/g, "").split("/")[0].trim();
  const capo = d.tipo === "apparel" ? "T-Shirt" : "Wall Art";
  return (frase ? `${frase} — ${capo} DreamBrothers` : `${d.concept} — ${capo} DreamBrothers`).slice(0, 140);
}

function descrizioneProdotto(d: Design): string {
  const frase = (d.testoDaComporre || "").replace(/"/g, "").replace(/\s*\/\s*/g, " · ");
  return [
    frase && `<p><strong>${frase}</strong></p>`,
    `<p>${d.concept}</p>`,
    `<p>Wall Art + Streetwear per chi rifiuta la media. Stampa su ordinazione, spedita dal centro di produzione più vicino a te.</p>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fa partire la pubblicazione senza far aspettare chi ha premuto "Approva". */
function avviaPubblicazione(data: string, id: string): void {
  void pubblicaDesign(data, id).catch(err => {
    console.warn("[productArtist] pubblicazione fallita", id, err);
  });
}

/* ------------------------------------------------------------------ */
/* Creatività pubblicitarie                                            */
/* ------------------------------------------------------------------ */

/**
 * Chiama il Creative Director sul design e salva il pacchetto dentro il batch.
 *
 * Si aspetta il risultato invece di lanciarlo in background come la
 * pubblicazione: qui Andrea ha premuto un pulsante e sta guardando lo schermo,
 * quindi vuole vedere le creatività, non uno stato "in corso".
 */
export async function creaCreativeDesign(data: string, id: string): Promise<PacchettoCreativo> {
  const batch = await getBatch(data);
  const design = batch?.design.find(d => d.id === id);
  if (!design) throw new Error(`Design "${id}" non trovato nel batch ${data}`);
  if (design.decisione !== "approvato") {
    throw new Error("Le creatività si fanno solo sui design approvati: prima approva, poi si promuove.");
  }

  const creative = await generaCreative({
    concept: design.concept,
    avatar: design.avatar,
    prodotto: design.prodotto,
    testoDaComporre: design.testoDaComporre,
    tipo: design.tipo,
    mockup: design.pubblicazione?.mockup ?? null,
    prezzoDa: design.pubblicazione?.prezzoDa ?? null,
  });

  await aggiornaDesign(data, id, d => { d.creative = creative; }, `creatività generate: ${id}`);
  return creative;
}

/* ------------------------------------------------------------------ */
/* Materiale per la notte successiva: reference e fonte                */
/* ------------------------------------------------------------------ */

export type ModoFonte = "caricate" | "url" | "auto";

export type Fonte = {
  modo: ModoFonte;
  /** usato se modo = "url": la vetrina da cui prendere i bestseller */
  url?: string;
  /** compilato dalla web app se modo = "auto": i domini della watchlist Product Market FIT */
  watchlist?: string[];
  note?: string;
  aggiornatoIl: string;
};

const PATH_FONTE = "references/_fonte-prossima-notte.json";

/** Oggi in fuso Roma: le reference si organizzano per giornata di lavoro. */
function oggiRoma(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export async function getFonte(): Promise<Fonte> {
  const { owner, repo } = repoSlug();
  const file = await ghJson<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${PATH_FONTE}`,
  ).catch(() => null);
  if (!file) return { modo: "auto", aggiornatoIl: new Date().toISOString() };
  return JSON.parse(
    Buffer.from(file.content, (file.encoding as BufferEncoding) || "base64").toString("utf8"),
  ) as Fonte;
}

export async function setFonte(input: {
  modo: ModoFonte; url?: string; watchlist?: string[]; note?: string;
}): Promise<Fonte> {
  if (input.modo === "url" && !input.url?.trim()) {
    throw new Error("Con modo 'url' serve l'indirizzo del negozio.");
  }
  const fonte: Fonte = {
    modo: input.modo,
    url: input.url?.trim() || undefined,
    watchlist: input.watchlist?.length ? input.watchlist : undefined,
    note: input.note?.trim() || undefined,
    aggiornatoIl: new Date().toISOString(),
  };
  await scriviFile(PATH_FONTE, Buffer.from(JSON.stringify(fonte, null, 2), "utf8"),
    `fonte reference: ${input.modo}${input.url ? ` (${input.url})` : ""}`);
  return fonte;
}

export type FileReference = { path: string; nome: string; tipo: string; giorno: string; size: number; sha: string };

/** Le reference caricate per la prossima notte, raggruppabili per tipo. */
export async function listaReference(giorno?: string): Promise<FileReference[]> {
  const g = giorno || oggiRoma();
  const { owner, repo } = repoSlug();
  const out: FileReference[] = [];
  for (const tipo of ["apparel", "wallart"]) {
    const items = await ghJson<(ContentItem & { size: number })[]>(
      `/repos/${owner}/${repo}/contents/references/${tipo}/${encodeURIComponent(g)}`,
    ).catch(() => []);
    for (const i of items) {
      if (i.type !== "file") continue;
      out.push({ path: i.path, nome: i.name, tipo, giorno: g, size: i.size, sha: i.sha });
    }
  }
  return out;
}

export async function caricaReference(input: {
  tipo: "apparel" | "wallart"; nomeFile: string; base64: string; giorno?: string;
}): Promise<FileReference> {
  // Il nome arriva dal browser: si ripulisce prima di farlo diventare un path.
  const nome = input.nomeFile.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  if (!nome || nome.startsWith(".")) throw new Error("nome file non valido");

  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("immagine troppo grande (max 12 MB)");

  const g = input.giorno || oggiRoma();
  const path = `references/${input.tipo}/${g}/${nome}`;
  await scriviFile(path, bytes, `reference caricata: ${input.tipo}/${nome}`);
  return { path, nome, tipo: input.tipo, giorno: g, size: bytes.length, sha: "" };
}

export async function eliminaReference(path: string): Promise<void> {
  if (!path.startsWith("references/") || path.includes("..")) throw new Error("percorso non valido");
  const { owner, repo } = repoSlug();
  const meta = await ghJson<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`);
  await ghJson(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({
      message: `web app: rimossa reference ${path.split("/").pop()}`,
      sha: meta.sha,
      committer: { name: "DreamBrothers HUB", email: "hub@dreambrothers.local" },
    }),
  });
}

/** Scrittura generica su GitHub: crea o aggiorna, gestendo lo sha se il file esiste. */
async function scriviFile(path: string, contenuto: Buffer, messaggio: string): Promise<void> {
  const { owner, repo } = repoSlug();
  const esistente = await ghJson<{ sha: string }>(`/repos/${owner}/${repo}/contents/${path}`).catch(() => null);
  await ghJson(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `web app: ${messaggio}`,
      content: contenuto.toString("base64"),
      ...(esistente ? { sha: esistente.sha } : {}),
      committer: { name: "DreamBrothers HUB", email: "hub@dreambrothers.local" },
    }),
  });
}

async function scriviBatch(batch: Batch, messaggio: string): Promise<void> {
  const { owner, repo } = repoSlug();
  const path = `output/${batch.data}/batch.json`;
  const { sha, ...pulito } = batch;
  const contenuto = Buffer.from(JSON.stringify(pulito, null, 2), "utf8").toString("base64");

  await ghJson(`/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `web app: ${messaggio}`,
      content: contenuto,
      sha,
      committer: { name: "DreamBrothers HUB", email: "hub@dreambrothers.local" },
    }),
  });
}
