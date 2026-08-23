/**
 * I file video dell'agente Video Editor.
 *
 * Il montaggio gira sul PC di Andrea (Tinker vive dentro BlueStacks, che su un
 * VPS Linux non esiste) e committa gli MP4 nella repo dell'agente. La repo è
 * privata, quindi `raw.githubusercontent` non è raggiungibile dal browser: la
 * web app fa da ponte, con lo stesso schema già collaudato per gli artwork di
 * Printify — link **firmato e a scadenza**.
 *
 * Perché firmato e non protetto dal cookie di sessione: il tag `<video>` fa una
 * richiesta con Range multipli, e ogni proxy o preload che perde il cookie
 * mostrerebbe un player nero senza spiegare perché. La firma sta nell'URL e
 * viaggia sempre.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { basePubblica } from "./artworkLink";

const GH_API = "https://api.github.com";
// Sei ore: il tempo di una sessione di review al mattino, con margine.
const DURATA_MS = 6 * 60 * 60 * 1000;

function chiave(): string {
  const k = process.env.CARE_WEBHOOK_SECRET || process.env.JWT_SECRET;
  if (!k) throw new Error("Manca CARE_WEBHOOK_SECRET (o JWT_SECRET): senza non posso firmare il link al video.");
  return k;
}

function firma(data: string, file: string, scadenza: number): string {
  return createHmac("sha256", chiave()).update(`video/${data}/${file}/${scadenza}`).digest("hex").slice(0, 32);
}

function repoSlug(): { owner: string; repo: string } {
  const slug = process.env.VIDEO_EDITOR_REPO || "Bilots00/dreambrothers-video-editor-AUTO";
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error(`VIDEO_EDITOR_REPO malformato: "${slug}" (atteso "owner/repo")`);
  return { owner, repo };
}

function token(): string {
  // Si ricade sui token degli altri agenti: sono tutti sullo stesso account, e
  // chiedere ad Andrea un quarto token per la stessa cosa è lavoro inutile.
  const t =
    process.env.VIDEO_EDITOR_GITHUB_TOKEN ||
    process.env.PRODUCT_ARTIST_GITHUB_TOKEN ||
    process.env.SEO_AGENT_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN;
  if (!t) throw new Error("Manca VIDEO_EDITOR_GITHUB_TOKEN nelle variabili Railway.");
  return t;
}

async function ghJson<T>(path: string): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} su ${path}`);
  return (await res.json()) as T;
}

/** L'URL firmato da mettere in `<video src>`, o null se non sappiamo il dominio. */
export function linkVideo(data: string, file: string): string | null {
  const base = basePubblica();
  if (!base) return null;
  const scadenza = Date.now() + DURATA_MS;
  const sig = firma(data, file, scadenza);
  return `${base}/api/video/file/${encodeURIComponent(data)}/${encodeURIComponent(file)}?exp=${scadenza}&sig=${sig}`;
}

export function verificaLinkVideo(data: string, file: string, exp: string, sig: string): boolean {
  const scadenza = Number(exp);
  if (!Number.isFinite(scadenza) || scadenza < Date.now()) return false;
  const atteso = firma(data, file, scadenza);
  const a = Buffer.from(atteso);
  const b = Buffer.from(String(sig || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Il file dalla repo dell'agente.
 *
 * Sotto il megabyte l'API Contents restituisce già il contenuto; un MP4 da 15
 * secondi ne pesa 3-5, e in quel caso `content` torna VUOTO senza errore — è la
 * stessa trappola che sugli artwork lasciava metà anteprime bianche. Quindi
 * sopra la soglia si passa dall'API Blobs, che arriva a 100 MB.
 */
export async function getFileVideo(data: string, file: string): Promise<{ buffer: Buffer; mime: string } | null> {
  if (file.includes("..") || file.includes("/")) throw new Error("nome file non valido");
  const { owner, repo } = repoSlug();

  const meta = await ghJson<{ content: string; sha: string; size: number }>(
    `/repos/${owner}/${repo}/contents/output/${encodeURIComponent(data)}/${encodeURIComponent(file)}`,
  ).catch(() => null);
  if (!meta) return null;

  const nome = file.toLowerCase();
  const mime = nome.endsWith(".mp4") ? "video/mp4"
    : nome.endsWith(".jpg") || nome.endsWith(".jpeg") ? "image/jpeg"
    : nome.endsWith(".png") ? "image/png"
    : "application/octet-stream";

  let base64 = meta.content ? meta.content.replace(/\n/g, "") : "";
  if (!base64) {
    const blob = await ghJson<{ content: string }>(`/repos/${owner}/${repo}/git/blobs/${meta.sha}`).catch(() => null);
    if (!blob?.content) return null;
    base64 = blob.content.replace(/\n/g, "");
  }

  return { buffer: Buffer.from(base64, "base64"), mime };
}
