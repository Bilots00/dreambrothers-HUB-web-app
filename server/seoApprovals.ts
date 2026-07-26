/**
 * SEO Approvals — le proposte dell'agente SEO & Search Visibility Architect.
 *
 * L'agente gira sul VPS (cron + `claude -p`) e scrive le sue proposte come file
 * markdown nella repo privata `dreambrothers-seo-architect-AUTO`. La repo resta
 * l'unica fonte di verità: questa web app la legge e ci scrive sopra la decisione
 * via GitHub Contents API, e l'agente la rilegge al `git pull` del run successivo.
 *
 * Niente DB e niente stato duplicato: se la web app è giù, l'agente continua a
 * funzionare; se l'agente è fermo, le decisioni restano comunque registrate.
 */

const GH_API = "https://api.github.com";

export type Decisione = "in_attesa" | "approvata" | "approvata_con_condizioni" | "rifiutata";

export const DECISIONI: Decisione[] = ["in_attesa", "approvata", "approvata_con_condizioni", "rifiutata"];

export type Proposta = {
  path: string;
  file: string;
  taskId: string;
  titolo: string;
  data: string;
  esecutore: string;
  decisione: Decisione;
  applicato: boolean;
  decisoIl: string | null;
  note: string | null;
  corpo: string;
  sha: string;
};

export type BacklogInfo = {
  totale: number;
  done: number;
  proposed: number;
  waitingAndrea: number;
  blocked: number;
  pending: number;
  rejected: number;
  failed: number;
};

function repoSlug(): { owner: string; repo: string } {
  const slug = process.env.SEO_AGENT_REPO || "Bilots00/dreambrothers-seo-architect-AUTO";
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`SEO_AGENT_REPO malformato: "${slug}" (atteso "owner/repo")`);
  return { owner, repo };
}

function token(): string {
  const t = process.env.SEO_AGENT_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (!t) {
    throw new Error(
      "Manca SEO_AGENT_GITHUB_TOKEN nelle variabili Railway. " +
        "Serve un token GitHub con permesso di lettura/scrittura sulla repo dell'agente SEO.",
    );
  }
  return t;
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${GH_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dreambrothers-hub",
      ...(init?.headers || {}),
    },
  });
  return res;
}

async function ghJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gh(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) throw new Error(`Risorsa non trovata su GitHub: ${path}`);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GitHub ha rifiutato il token (${res.status}). Controlla SEO_AGENT_GITHUB_TOKEN e i suoi permessi.`);
    }
    if (res.status === 409) throw new Error("Conflitto su GitHub: il file è cambiato nel frattempo. Ricarica la pagina e riprova.");
    throw new Error(`GitHub ${res.status} su ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Front-matter: funzioni pure, testate in seoApprovals.test.ts        */
/* ------------------------------------------------------------------ */

export function parseFrontMatter(md: string): { fm: Record<string, string>; corpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { fm: {}, corpo: md };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { fm, corpo: m[2] };
}

export function serializeFrontMatter(fm: Record<string, string>, corpo: string): string {
  const head = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${head}\n---\n${corpo.startsWith("\n") ? "" : "\n"}${corpo}`;
}

/**
 * Normalizza la decisione. Accetta lo schema nuovo (`decisione:`) e quello
 * originale dell'agente (`approvato: si|no|mai`), così le proposte scritte
 * prima di questa funzionalità restano leggibili.
 */
export function leggiDecisione(fm: Record<string, string>): Decisione {
  const d = (fm.decisione || "").toLowerCase().trim();
  if ((DECISIONI as string[]).includes(d)) return d as Decisione;
  const legacy = (fm.approvato || "").toLowerCase().trim();
  if (legacy === "si" || legacy === "sì" || legacy === "yes") return "approvata";
  if (legacy === "mai" || legacy === "never") return "rifiutata";
  return "in_attesa";
}

export function isVero(v: string | undefined): boolean {
  const s = (v || "").toLowerCase().trim();
  return s === "si" || s === "sì" || s === "yes" || s === "true";
}

const ETICHETTA: Record<Decisione, string> = {
  in_attesa: "in attesa",
  approvata: "approvata",
  approvata_con_condizioni: "approvata con condizioni",
  rifiutata: "rifiutata",
};

/** Blocco che l'agente legge per capire cosa fare. Scritto in fondo al file. */
export function bloccoDecisione(decisione: Decisione, note: string, quando: string): string {
  const righe = [
    ``,
    `## DECISIONE DI ANDREA — ${quando}`,
    ``,
    `**Esito:** ${ETICHETTA[decisione]}`,
    ``,
  ];
  const testo = note.trim();
  if (decisione === "approvata_con_condizioni") {
    righe.push(`**Condizioni da rispettare prima di applicare:**`, ``, testo, ``);
    righe.push(
      `> Agente: applica la proposta **solo** rispettando queste condizioni. Se una condizione`,
      `> rende la proposta non più valida, non applicare: riscrivi una nuova proposta che le tenga dentro.`,
      ``,
    );
  } else if (decisione === "rifiutata") {
    righe.push(`**Perché no, e cosa fare invece:**`, ``, testo, ``);
    righe.push(
      `> Agente: non applicare nulla. Tieni il task in coda e riproponi una soluzione alternativa`,
      `> che tenga conto di questa motivazione. Non riproporre la stessa identica proposta.`,
      ``,
    );
  } else if (testo) {
    righe.push(`**Note:**`, ``, testo, ``);
  }
  return righe.join("\n");
}

/* ------------------------------------------------------------------ */
/* Lettura / scrittura su GitHub                                       */
/* ------------------------------------------------------------------ */

type GhContentFile = { name: string; path: string; sha: string; type: string; content?: string; encoding?: string };

function decodeB64(s: string): string {
  return Buffer.from(s.replace(/\n/g, ""), "base64").toString("utf-8");
}

function toProposta(path: string, sha: string, md: string): Proposta {
  const { fm, corpo } = parseFrontMatter(md);
  const file = path.split("/").pop() || path;
  return {
    path,
    file,
    taskId: fm.task_id || "—",
    titolo: fm.titolo || file.replace(/\.md$/, ""),
    data: fm.data || "",
    esecutore: (fm.esecutore || "agente").toLowerCase(),
    decisione: leggiDecisione(fm),
    applicato: isVero(fm.applicato),
    decisoIl: fm.deciso_il && fm.deciso_il !== "null" ? fm.deciso_il : null,
    note: fm.note && fm.note !== "null" ? fm.note : null,
    corpo: corpo.trim(),
    sha,
  };
}

export async function listProposte(): Promise<Proposta[]> {
  const { owner, repo } = repoSlug();
  let entries: GhContentFile[];
  try {
    entries = await ghJson<GhContentFile[]>(`/repos/${owner}/${repo}/contents/proposals`);
  } catch (e) {
    // cartella ancora vuota: l'agente non ha ancora prodotto nulla
    if (e instanceof Error && e.message.includes("non trovata")) return [];
    throw e;
  }
  const files = (Array.isArray(entries) ? entries : []).filter((e) => e.type === "file" && e.name.endsWith(".md"));
  const out = await Promise.all(
    files.map(async (f) => {
      const full = await ghJson<GhContentFile>(`/repos/${owner}/${repo}/contents/${encodeURI(f.path)}`);
      return toProposta(f.path, full.sha, decodeB64(full.content || ""));
    }),
  );
  // le più recenti in cima; a parità di data, quelle ancora da decidere prima
  return out.sort((a, b) => {
    if (a.decisione === "in_attesa" && b.decisione !== "in_attesa") return -1;
    if (b.decisione === "in_attesa" && a.decisione !== "in_attesa") return 1;
    return (b.data || "").localeCompare(a.data || "") || b.file.localeCompare(a.file);
  });
}

export async function decidiProposta(args: {
  path: string;
  decisione: Exclude<Decisione, "in_attesa">;
  note?: string;
  sha?: string;
}): Promise<Proposta> {
  const { owner, repo } = repoSlug();
  const note = (args.note || "").trim();

  if ((args.decisione === "rifiutata" || args.decisione === "approvata_con_condizioni") && note.length < 10) {
    throw new Error(
      args.decisione === "rifiutata"
        ? "Scrivi perché la rifiuti e cosa potrebbe fare invece: senza motivazione l'agente riproporrebbe la stessa cosa."
        : "Scrivi le condizioni da rispettare: senza condizioni l'approvazione condizionata non ha senso.",
    );
  }

  const current = await ghJson<GhContentFile>(`/repos/${owner}/${repo}/contents/${encodeURI(args.path)}`);
  if (args.sha && args.sha !== current.sha) {
    throw new Error("La proposta è cambiata nel frattempo (l'agente l'ha aggiornata). Ricarica la pagina e rileggila prima di decidere.");
  }

  const md = decodeB64(current.content || "");
  const { fm, corpo } = parseFrontMatter(md);
  if (isVero(fm.applicato)) throw new Error("Questa proposta è già stata applicata: la decisione non è più modificabile.");

  const quando = new Date().toISOString().slice(0, 10);
  fm.decisione = args.decisione;
  fm.deciso_il = quando;
  if (note) fm.note = JSON.stringify(note.replace(/\s+/g, " ").slice(0, 200));
  delete fm.approvato; // sostituito dallo schema nuovo
  if (!fm.applicato) fm.applicato = "no";

  const nuovo = serializeFrontMatter(fm, `${corpo.trimEnd()}\n${bloccoDecisione(args.decisione, note, quando)}`);

  await ghJson(`/repos/${owner}/${repo}/contents/${encodeURI(args.path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `approvals: ${ETICHETTA[args.decisione]} — ${fm.task_id || args.path}`,
      content: Buffer.from(nuovo, "utf-8").toString("base64"),
      sha: current.sha,
    }),
  });

  return toProposta(args.path, current.sha, nuovo);
}

export async function getBacklog(): Promise<BacklogInfo> {
  const { owner, repo } = repoSlug();
  const f = await ghJson<GhContentFile>(`/repos/${owner}/${repo}/contents/state/backlog.json`);
  const data = JSON.parse(decodeB64(f.content || "")) as { task?: Array<{ status?: string }> };
  const task = data.task || [];
  const count = (s: string) => task.filter((t) => t.status === s).length;
  return {
    totale: task.length,
    done: count("done"),
    proposed: count("proposed"),
    waitingAndrea: count("waiting-andrea"),
    blocked: count("blocked"),
    pending: count("pending"),
    rejected: count("rejected"),
    failed: count("failed"),
  };
}
