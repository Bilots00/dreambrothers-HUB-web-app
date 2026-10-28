// Il thread che suona: riceve una MusicSpec, restituisce l'mp3 e le misure.
// In produzione e' bundlato a parte in dist/music-worker.js (vedi "build" in package.json).
import { parentPort } from "node:worker_threads";
import { renderSpec } from "./render";

parentPort?.on("message", async (msg: { id: number; spec: any }) => {
  try {
    const r = await renderSpec(msg.spec);
    parentPort!.postMessage({ id: msg.id, ok: true, result: r });
  } catch (e: any) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: String(e?.stack || e) });
  }
});
