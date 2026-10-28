/**
 * Un solo worker thread, un lavoro alla volta: Railway ha pochi core e una
 * traccia da 5 minuti tiene occupato un core per ~1 minuto. In coda va bene,
 * in parallelo rallenterebbe anche il resto del server.
 */
import { Worker } from "node:worker_threads";
import type { MusicSpec } from "@shared/music";
import type { RenderResult } from "./render";

const JOB_TIMEOUT_MS = 12 * 60_000;
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: RenderResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

function spawn(): Worker {
  const isTs = import.meta.url.endsWith(".ts");
  // dev (tsx): il sorgente accanto; produzione: dist/music-worker.js accanto a dist/index.js
  const url = isTs ? new URL("./worker.ts", import.meta.url) : new URL("./music-worker.js", import.meta.url);
  const w = new Worker(url, isTs ? { execArgv: ["--import", "tsx"] } : {});
  w.on("message", (m: { id: number; ok: boolean; result?: any; error?: string }) => {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    if (m.ok) {
      const r = m.result as RenderResult;
      r.mp3 = Buffer.from(r.mp3 as any); // il clone strutturato arriva come Uint8Array
      p.resolve(r);
    } else p.reject(new Error(m.error));
  });
  const die = (err: Error) => {
    for (const [id, p] of Array.from(pending)) { clearTimeout(p.timer); p.reject(err); pending.delete(id); }
    worker = null;
  };
  w.on("error", die);
  w.on("exit", (code) => { if (code !== 0) die(new Error(`worker musica uscito con codice ${code}`)); else worker = null; });
  w.unref();
  return w;
}

export function renderInWorker(spec: MusicSpec): Promise<RenderResult> {
  if (!worker) worker = spawn();
  const id = ++seq, w = worker;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("render oltre 12 minuti: worker riavviato"));
      void w.terminate();
      if (worker === w) worker = null;
    }, JOB_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, spec });
  });
}
