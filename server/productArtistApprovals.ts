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

import { pubblicaProdotto, dimensioniPng, MIN_LATO_LUNGO, COLORI_CAPO_AMMESSI } from "./printify";
import { linkArtwork } from "./artworkLink";
import {
  validaPacchetto,
  momentoCorrente,
  type RichiestaCreative,
  type BriefCreative,
} from "./creativeDirector";

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
export type FileStampa = { tag: string; nome: string; url: string | null; size: number };

export type Pubblicazione = {
  /** `pronto_download` e' lo stato finale della wall art: file consegnati, niente da pubblicare */
  stato: "in_corso" | "pubblicato" | "pronto_download" | "errore";
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
  /** wall art: i file pronti da scaricare e passare al Bulk Creator */
  fileStampa?: FileStampa[];
};

/**
 * Come questo design va stampato su un capo.
 *
 * Non è deducibile dall'immagine: un artwork può stare bene sul petto o solo
 * sulla schiena, e i colori del capo che lo reggono dipendono da com'è fatto.
 * La decide il Product Artist sul VPS (che ragiona come un product designer);
 * finché non c'è, si usano i default prudenti calcolati dall'immagine.
 */
export type SchedaStampa = {
  posizione: "front" | "back";
  /** i colori del capo, nomi come li chiama Printify: "Black", "White", … */
  colori: string[];
  /** cosa mettere sul fronte quando la grafica principale va dietro */
  fronteComplementare?: string | null;
  /** le PAROLE ESATTE del fronte (regola fronte/retro: l'ancora identitaria) */
  fronteTesto?: string | null;
  /** riga secondaria opzionale del fronte */
  fronteRiga2?: string | null;
  /** stile tipografico del fronte: gothic | script | marker | hand | stencil */
  fronteStile?: string | null;
  /**
   * Copy del prodotto, scritta dal copywriter dell'agente insieme alla scheda.
   * Il `concept` del manifest è una nota di regia per il generatore ("leone
   * frontale, cross lighting") e sul negozio fa una figura pessima: quando
   * questi campi ci sono, sono loro il titolo e la descrizione.
   */
  titolo?: string | null;
  descrizione?: string | null;
  /** meta tag SEO: devono differire da titolo e descrizione, mai copiarli */
  metaTitle?: string | null;
  metaDescription?: string | null;
  note?: string | null;
  decisaIl: string;
  decisaDa: "agente" | "default";
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
  /**
   * Stato per veste: la stessa grafica puo' vivere come capo E come quadro
   * (la stella: quadro su Gelato e retro-maglietta su Printify insieme).
   */
  pubblicazioni?: { apparel?: Pubblicazione; wallart?: Pubblicazione };
  /** campo storico, migrato in `pubblicazioni` alla lettura */
  pubblicazione?: Pubblicazione;
  /** le creatività pubblicitarie: in coda per l'agente VPS, poi il pacchetto */
  creative?: RichiestaCreative;
  /** come stamparlo: posizione e colori del capo */
  stampa?: SchedaStampa;
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

/** I file presenti nella cartella di una notte: serve per trovare quelli di stampa. */
async function listaFileBatch(data: string): Promise<{ name: string; size: number }[]> {
  const { owner, repo } = repoSlug();
  const items = await ghJson<(ContentItem & { size: number })[]>(
    `/repos/${owner}/${repo}/contents/output/${encodeURIComponent(data)}`,
  ).catch(() => []);
  return items.filter(i => i.type === "file").map(i => ({ name: i.name, size: i.size }));
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
  // I batch scritti prima del 20/08 hanno un solo stato di pubblicazione:
  // si sposta sotto la veste giusta, cosi' il resto del codice vede una forma sola.
  for (const d of batch.design) {
    if (d.pubblicazione && !d.pubblicazioni) {
      d.pubblicazioni = { [d.tipo]: d.pubblicazione };
      delete d.pubblicazione;
    }
  }
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

/**
 * Applica una modifica a un design rileggendo sempre lo stato fresco.
 *
 * Il ritentativo non è per capriccio: subito dopo una scrittura, l'API Contents
 * di GitHub può ancora servire lo sha vecchio, e il PUT successivo si becca un
 * 409. Succede proprio qui, dove si scrive "in corso" e mezzo secondo dopo
 * l'esito. Si rilegge e si riprova invece di riportare un conflitto che non
 * significa niente per chi guarda la pagina.
 */
async function aggiornaDesign(
  data: string,
  id: string,
  patch: (d: Design) => void,
  messaggio: string,
): Promise<void> {
  await inCoda(async () => {
    for (let tentativo = 0; ; tentativo++) {
      const batch = await getBatch(data);
      if (!batch) return;
      const design = batch.design.find(d => d.id === id);
      if (!design) return;
      patch(design);
      try {
        await scriviBatch(batch, messaggio);
        return;
      } catch (e) {
        const conflitto = e instanceof Error && /Conflitto su GitHub|409/i.test(e.message);
        if (!conflitto || tentativo >= 3) throw e;
        await new Promise(r => setTimeout(r, 400 * (tentativo + 1)));
      }
    }
  });
}

/**
 * Porta un design approvato su Printify e da lì sullo store Shopify.
 *
 * Gira in background rispetto all'approvazione: se Printify è lento o giù, il
 * sì di Andrea resta comunque registrato e l'errore finisce dentro il design,
 * visibile nella pagina, invece di far fallire la decisione.
 */
export async function pubblicaDesign(
  data: string,
  id: string,
  /**
   * Con che veste pubblicare. Serve perché il tipo dedotto dal manifest non è
   * sempre quello giusto: una gouache verticale nasce marcata "apparel" ma sta
   * meglio come quadro, e lo stesso file può vivere in entrambi i mondi.
   */
  tipoScelto?: "apparel" | "wallart",
  /** rifa' il prodotto anche se ne esiste gia' uno: crea un prodotto NUOVO su
   *  Printify, quello vecchio va cancellato a mano. */
  forza = false,
  /** dove mettere la grafica: senza, decide la scheda dell'agente */
  posizioneScelta?: "front" | "back",
): Promise<void> {
  const batch = await getBatch(data);
  const design = batch?.design.find(d => d.id === id);
  if (!design) return;

  const tipo = tipoScelto || design.tipo;
  const attuale = design.pubblicazioni?.[tipo];
  if (attuale?.stato === "in_corso") return;
  if ((attuale?.stato === "pubblicato" || attuale?.stato === "pronto_download") && !forza) return;

  const segna = (d: Design, pub: Pubblicazione) => {
    d.pubblicazioni = { ...(d.pubblicazioni || {}), [tipo]: pub };
  };

  await aggiornaDesign(
    data,
    id,
    d => {
      segna(d, { stato: "in_corso", avviataIl: new Date().toISOString() });
    },
    `pubblicazione avviata (${tipo}): ${id}`,
  );

  try {
    /* ── Wall art: nessun Printify ────────────────────────────────────────
       I quadri li stampa Gelato, e la pubblicazione la fa Andrea dal Bulk
       Creator. Qui si consegnano solo i file gia' tagliati nei due rapporti
       del catalogo, con i nomi che il Bulk Creator sa leggere. */
    if (tipo === "wallart") {
      const files = await listaFileBatch(data);
      const trovati: FileStampa[] = [];
      for (const tag of ["3x4", "5x7"]) {
        const f = files.find(x => x.name.includes(`(${tag})`) && /\.png$/i.test(x.name));
        if (f) trovati.push({ tag, nome: f.name, url: linkArtwork(data, f.name), size: f.size });
      }

      if (!trovati.length) {
        throw new Error(
          "I file di stampa non ci sono ancora. Lanciali sul PC con " +
            "`node engine/upscale-batch.mjs` nella repo dell'agente: produce i due formati (3x4) e (5x7).",
        );
      }

      await aggiornaDesign(
        data,
        id,
        d => {
          segna(d, {
            stato: "pronto_download",
            avviataIl: d.pubblicazioni?.[tipo]?.avviataIl || new Date().toISOString(),
            conclusaIl: new Date().toISOString(),
            fileStampa: trovati,
            avvisoQualita:
              trovati.length < 2
                ? "Manca uno dei due formati: rilancia upscale-batch per avere sia (3x4) sia (5x7)."
                : undefined,
          });
          d.applicato = true;
        },
        `file wall art pronti: ${id}`,
      );
      return;
    }

    // Se l'upscale ha già prodotto il file di stampa si usa quello: il PNG
    // grezzo di Gemini è ~765px, che stampato su una maglietta si vede.
    // Convenzione col motore di upscale: stesso nome + "_print".
    const filePrint = design.file.replace(/\.png$/i, "_print.png");
    const daStampa = filePrint !== design.file ? await getImmagine(data, filePrint) : null;
    // Sul capo il file di stampa non e' un optional: l'originale e' 765px col
    // fondo pieno, e stampato viene sgranato dentro un rettangolo di colore
    // (il disastro del 20/08). Meglio fermarsi con le istruzioni giuste.
    if (!daStampa) {
      throw new Error(
        "File di stampa non ancora pronto per questo capo. Sul PC, nella repo dell'agente, lancia: " +
          "`node engine/upscale-batch.mjs` (scontorna con il metodo bordi e upscala con Topaz), poi premi riprova.",
      );
    }
    const fileUsato = filePrint;
    const img = daStampa;
    if (!img) throw new Error(`Immagine ${design.file} non trovata nella repo dell'agente.`);

    // La stampa non si blocca per la risoluzione, ma l'avviso resta scritto:
    // un artwork piccolo stampato grande si vede, e va saputo prima dei resi.
    const dim = dimensioniPng(img.base64);
    const avvisoQualita =
      dim && Math.max(dim.w, dim.h) < MIN_LATO_LUNGO
        ? `Artwork ${dim.w}×${dim.h}px: sotto i ${MIN_LATO_LUNGO}px consigliati per la stampa. Va fatto l'upscale prima di spingerlo con le ads.`
        : undefined;

    const scheda = design.stampa || schedaDiDefault(img.base64);
    const posizione = posizioneScelta || scheda.posizione;

    // Se la grafica va sul retro, il fronte non resta vuoto: la tipografia
    // generata da engine/fronte.py (regola fronte/retro: l'ancora identitaria
    // davanti, la manifestazione dietro). Se il file non c'e' ancora si
    // pubblica comunque, solo retro.
    let fronte: { nomeFile: string; url: string } | null = null;
    if (tipo === "apparel" && posizione === "back") {
      const nomeFronte = design.file.replace(/\.png$/i, "_fronte.png");
      const cFronte = await getImmagine(data, nomeFronte).catch(() => null);
      const urlFronte = cFronte ? linkArtwork(data, nomeFronte) : null;
      if (urlFronte) fronte = { nomeFile: nomeFronte, url: urlFronte };
    }

    // Variante per i capi chiari (testi chiari scuriti): la produce
    // upscale-batch accanto al _print. Se manca e la scheda chiede capi
    // chiari, si pubblica lo stesso ma l'avviso resta scritto.
    let chiaro: { nomeFile: string; url: string } | null = null;
    let avvisoChiaro: string | undefined;
    if (tipo === "apparel") {
      const nomeChiaro = design.file.replace(/\.png$/i, "_print_chiaro.png");
      const files = await listaFileBatch(data).catch(() => []);
      const urlChiaro = files.some(f => f.name === nomeChiaro) ? linkArtwork(data, nomeChiaro) : null;
      // L'avviso guarda i colori EFFETTIVI: quelli della scheda (o del default,
      // che include White) filtrati sulla palette ammessa — gli stessi con cui
      // pubblicaProdotto creera' le varianti.
      const ammessi = COLORI_CAPO_AMMESSI.map(c => c.toLowerCase());
      const capiChiariEffettivi = (scheda.colori || [])
        .filter(c => ammessi.includes(c.toLowerCase()))
        .some(c => c.toLowerCase() !== "black");
      if (urlChiaro) {
        chiaro = { nomeFile: nomeChiaro, url: urlChiaro };
      } else if (capiChiariEffettivi) {
        avvisoChiaro =
          "Manca la variante chiara del design: i capi chiari stampano il file scuro. " +
          "Sul PC: `node engine/upscale-batch.mjs` la genera, poi premi rifai.";
      }
    }

    const pubblicato = await pubblicaProdotto({
      nomeFile: fileUsato,
      base64: img.base64,
      // Printify scarica da qui invece di ricevere 30 MB in base64 nel POST,
      // che gli fanno rispondere 413.
      url: linkArtwork(data, fileUsato),
      fronte,
      chiaro,
      titolo: titoloProdotto({ ...design, tipo }),
      descrizione: descrizioneProdotto(design),
      tipo,
      colori: tipo === "apparel" ? scheda.colori : undefined,
      posizione: tipo === "apparel" ? posizione : undefined,
      tags: [design.avatar, tipo, "DreamBrothers"].filter(Boolean),
    });

    await aggiornaDesign(
      data,
      id,
      d => {
        segna(d, {
          stato: "pubblicato",
          avviataIl: d.pubblicazioni?.[tipo]?.avviataIl || new Date().toISOString(),
          conclusaIl: pubblicato.pubblicatoIl,
          productId: pubblicato.productId,
          shopId: pubblicato.shopId,
          url: pubblicato.url,
          mockup: pubblicato.mockup,
          prezzoDa: pubblicato.prezzoDa,
          varianti: pubblicato.varianti,
          avvisoQualita: [avvisoQualita, avvisoChiaro].filter(Boolean).join(" ") || undefined,
        });
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
        segna(d, {
          stato: "errore",
          avviataIl: d.pubblicazioni?.[tipo]?.avviataIl || new Date().toISOString(),
          conclusaIl: new Date().toISOString(),
          errore,
        });
      },
      `pubblicazione fallita: ${id}`,
    );
  }
}

/**
 * La scheda di stampa quando l'agente non l'ha ancora decisa.
 *
 * Nero e bianco sono le due basi sicure: un artwork qualsiasi regge almeno una
 * delle due. Quali altri colori stiano bene con QUESTO design è una scelta da
 * product designer, e la fa l'agente sul VPS — qui non si tira a indovinare.
 */
function schedaDiDefault(_base64: string): SchedaStampa {
  return {
    posizione: "front",
    colori: ["Black", "White"],
    note: "Default prudente: l'agente non ha ancora deciso posizione e colori.",
    decisaIl: new Date().toISOString(),
    decisaDa: "default",
  };
}

/**
 * Le parole del design, ripulite e in ordine di peso.
 *
 * `testoDaComporre` arriva come lista separata da "/" nell'ordine in cui le
 * frasi stanno nell'immagine ("BORN / TO LEAD / LEO"). La parola forte per il
 * negozio è di solito la più corta e identitaria (il nome del segno), non la
 * prima in alto: chi cerca cerca "Leone", non "BORN".
 */
function paroleDesign(d: Design): { titolo: string; slogan: string } {
  const parti = (d.testoDaComporre || "")
    .replace(/["']/g, "")
    .split("/")
    .map(s => s.trim())
    .filter(Boolean);
  if (!parti.length) return { titolo: "", slogan: "" };

  // La più corta fa da nome, le altre ricomposte fanno da slogan. A parità di
  // lunghezza vince l'ultima: nei design zodiacali il segno sta in fondo.
  let nome = parti[0];
  for (const p of parti) if (p.length <= nome.length) nome = p;
  const slogan = parti.filter(p => p !== nome).join(" ");
  return { titolo: nome, slogan };
}

const titoloCase = (s: string) =>
  s.length > 4 && s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s'])(\S)/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
    : s;

/**
 * Le regole di copy del brand, applicate al testo generato qui.
 *
 * - **Inglese, sempre**: il negozio parla inglese a un pubblico internazionale
 *   (target primario USA); l'italiano si ottiene a valle con la traduzione.
 * - **Mai l'em dash** "—" né l'en dash "–": è la firma tipografica dei testi
 *   generati, e nessuno lo digita davvero. Virgola, punto o a capo.
 * - **Mai il nome del brand nel titolo del prodotto**: ruba caratteri alla
 *   keyword e non aiuta in SERP. Nel meta title sta in coda, e basta.
 */
const RIPULISCI_TRATTINI = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");

/**
 * Titolo commerciale. Se il copywriter dell'agente ne ha scritto uno, è quello:
 * qui si costruisce solo il ripiego, con le parole del design invece del
 * concept di regia (che dava "BORN — T-Shirt DreamBrothers").
 */
export function titoloProdotto(d: Design): string {
  const scritto = d.stampa?.titolo?.trim();
  if (scritto) return RIPULISCI_TRATTINI(scritto).slice(0, 140);

  // Formula del brand: [soggetto] | [beneficio identitario] | [tipo].
  const capo = d.tipo === "apparel" ? "Unisex T-Shirt" : "Art Print";
  const { titolo, slogan } = paroleDesign(d);
  const pezzi = [titolo || titoloCase(d.concept || "Dreamers"), slogan && titoloCase(slogan), capo];
  return RIPULISCI_TRATTINI(pezzi.filter(Boolean).join(" | ")).slice(0, 140);
}

export function descrizioneProdotto(d: Design): string {
  const scritta = d.stampa?.descrizione?.trim();
  if (scritta) return RIPULISCI_TRATTINI(scritta);

  const { titolo, slogan } = paroleDesign(d);
  const claim = [titolo, slogan && titoloCase(slogan)].filter(Boolean).join(" · ");
  return [
    claim && `<p><strong>${claim}</strong></p>`,
    // Niente `concept` e niente `avatar`: il primo è la nota di regia per il
    // generatore, il secondo un'etichetta interna di segmentazione. Nessuno dei
    // due è roba da vetrina. Niente "it's not just a tee, it's...": è il
    // pattern che il Brain vieta esplicitamente.
    d.tipo === "apparel"
      ? `<p>Printed on ringspun cotton with a soft hand feel, so the graphic sits in the fabric instead of on top of it. Unisex fit, true to size.</p>`
      : `<p>Printed on heavyweight matte paper with pigment inks, made to be framed and to stay on the wall for years.</p>`,
    `<p>Made to order and shipped from the production house closest to you. No warehouse, no overproduction, no leftovers.</p>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Meta title e meta description: NON sono il titolo e la descrizione del
 * prodotto ripetuti (era il difetto trovato dall'audit SEO su 128 pagine su
 * 141). Il meta title compete in SERP contro dieci alternative, quindi è un
 * annuncio: qui il brand in coda ci sta, nel titolo del prodotto no.
 */
export function metaProdotto(d: Design): { title: string; description: string } {
  const { titolo, slogan } = paroleDesign(d);
  const capo = d.tipo === "apparel" ? "Tee" : "Print";
  const nome = titolo || titoloCase(d.concept || "Dreamers");

  const title = RIPULISCI_TRATTINI(
    d.stampa?.metaTitle?.trim() ||
      [`${nome} ${capo}`, slogan && titoloCase(slogan), "DreamBrothers"].filter(Boolean).join(" | "),
  ).slice(0, 60);

  const description = RIPULISCI_TRATTINI(
    d.stampa?.metaDescription?.trim() ||
      `${[nome, slogan && titoloCase(slogan)].filter(Boolean).join(", ")}. ` +
        (d.tipo === "apparel"
          ? "Soft ringspun cotton, unisex fit, made to order and shipped from the closest print house."
          : "Heavyweight matte paper and pigment inks, made to order and shipped from the closest print house."),
  ).slice(0, 160);

  return { title, description };
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
 * Mette il design in coda per il Creative Director.
 *
 * Non genera niente qui: il motore è l'abbonamento Claude Max sul VPS, che
 * pesca la coda con `claude -p`. La web app non paga API e non ragiona — è la
 * stessa regola di casa del Research Hub e del Market Intelligence.
 */
export async function creaCreativeDesign(data: string, id: string): Promise<RichiestaCreative> {
  const batch = await getBatch(data);
  const design = batch?.design.find(d => d.id === id);
  if (!design) throw new Error(`Design "${id}" non trovato nel batch ${data}`);
  if (design.decisione !== "approvato") {
    throw new Error("Le creatività si fanno solo sui design approvati: prima approva, poi si promuove.");
  }
  if (design.creative?.stato === "in_coda") return design.creative;

  const richiesta: RichiestaCreative = { stato: "in_coda", richiestoIl: new Date().toISOString() };
  await aggiornaDesign(data, id, d => { d.creative = richiesta; }, `creatività richieste: ${id}`);
  return richiesta;
}

/**
 * La coda per l'agente VPS: i design approvati che aspettano le creatività.
 *
 * Si guardano solo gli ultimi batch — una richiesta vecchia di settimane è roba
 * dimenticata, non lavoro arretrato, e scandire tutta la cartella `output`
 * significherebbe una chiamata GitHub per ogni notte mai prodotta.
 */
export async function creativeInCoda(maxBatch = 7): Promise<BriefCreative[]> {
  const date = (await listaBatch()).slice(0, maxBatch);
  const fuori: BriefCreative[] = [];
  const momento = momentoCorrente();

  for (const data of date) {
    const batch = await getBatch(data).catch(() => null);
    if (!batch) continue;
    for (const d of batch.design) {
      if (d.creative?.stato !== "in_coda") continue;
      fuori.push({
        data,
        id: d.id,
        concept: d.concept,
        avatar: d.avatar,
        prodotto: d.prodotto,
        testoDaComporre: d.testoDaComporre,
        tipo: d.tipo,
        mockup: d.pubblicazioni?.apparel?.mockup ?? d.pubblicazioni?.wallart?.mockup ?? null,
        prezzoDa: d.pubblicazioni?.apparel?.prezzoDa ?? null,
        momento,
        richiestoIl: d.creative.richiestoIl,
      });
    }
  }
  return fuori;
}

/** Toglie il design dalla coda: serve quando l'agente VPS non risponde. */
export async function annullaCreative(data: string, id: string): Promise<void> {
  await aggiornaDesign(data, id, d => { delete d.creative; }, `creativita' annullate: ${id}`);
}

/**
 * I design approvati che non hanno ancora una scheda di stampa.
 *
 * È la seconda coda dell'agente: decidere se un artwork va sul petto o sulla
 * schiena e su quali colori di capo regge è mestiere da product designer, non
 * roba che si indovina da un'euristica.
 */
export async function stampaInCoda(maxBatch = 7): Promise<
  Array<{ data: string; id: string; concept: string; avatar: string; testoDaComporre: string; artwork: string | null }>
> {
  const date = (await listaBatch()).slice(0, maxBatch);
  const fuori = [];
  for (const data of date) {
    const batch = await getBatch(data).catch(() => null);
    if (!batch) continue;
    for (const d of batch.design) {
      if (d.decisione !== "approvato" || d.tipo !== "apparel") continue;
      if (d.stampa?.decisaDa === "agente") continue;
      fuori.push({
        data,
        id: d.id,
        concept: d.concept,
        avatar: d.avatar,
        testoDaComporre: d.testoDaComporre,
        // L'agente guarda il design prima di decidere: senza vederlo non può
        // sapere se il soggetto regge il petto o vuole tutta la schiena.
        artwork: linkArtwork(data, d.file),
      });
    }
  }
  return fuori;
}

/** L'agente consegna la scheda di stampa decisa per un design. */
export async function salvaStampa(input: {
  data: string;
  id: string;
  posizione: "front" | "back";
  colori: string[];
  fronteComplementare?: string | null;
  fronteTesto?: string | null;
  fronteRiga2?: string | null;
  fronteStile?: string | null;
  titolo?: string | null;
  descrizione?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  note?: string | null;
}): Promise<void> {
  const colori = input.colori.map(c => String(c).trim()).filter(Boolean).slice(0, 6);
  if (!colori.length) throw new Error("Serve almeno un colore di capo.");

  const scheda: SchedaStampa = {
    posizione: input.posizione === "back" ? "back" : "front",
    colori,
    fronteComplementare: input.fronteComplementare?.slice(0, 1000) || null,
    fronteTesto: input.fronteTesto?.slice(0, 80) || null,
    fronteRiga2: input.fronteRiga2?.slice(0, 120) || null,
    fronteStile: input.fronteStile?.slice(0, 20) || null,
    titolo: input.titolo?.trim().slice(0, 140) || null,
    descrizione: input.descrizione?.trim().slice(0, 4000) || null,
    metaTitle: input.metaTitle?.trim().slice(0, 60) || null,
    metaDescription: input.metaDescription?.trim().slice(0, 160) || null,
    note: input.note?.slice(0, 1000) || null,
    decisaIl: new Date().toISOString(),
    decisaDa: "agente",
  };
  await aggiornaDesign(input.data, input.id, d => { d.stampa = scheda; }, `scheda di stampa: ${input.id}`);
}

/** L'agente riconsegna: o il pacchetto valido, o il motivo per cui non ce l'ha fatta. */
export async function salvaCreative(input: {
  data: string;
  id: string;
  pacchetto?: unknown;
  errore?: string;
}): Promise<void> {
  if (input.errore) {
    await aggiornaDesign(
      input.data,
      input.id,
      d => {
        d.creative = {
          stato: "errore",
          richiestoIl: d.creative?.richiestoIl || new Date().toISOString(),
          errore: input.errore!.slice(0, 1000),
        };
      },
      `creatività fallite: ${input.id}`,
    );
    return;
  }

  // Se la forma non regge si alza qui: meglio un errore all'agente che mezzo
  // pacchetto salvato che poi rompe la pagina.
  const pacchetto = validaPacchetto(input.pacchetto);
  await aggiornaDesign(
    input.data,
    input.id,
    d => {
      d.creative = {
        stato: "pronto",
        richiestoIl: d.creative?.richiestoIl || new Date().toISOString(),
        pacchetto,
      };
    },
    `creatività pronte: ${input.id}`,
  );
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
