// 20 render Relax 60 s con semi diversi: stampa ogni render che non passa i cancelli.
import { renderSpec } from "../server/music/render";
let bad = 0;
for (let i = 0; i < 20; i++) {
  const purpose = (["relax", "focus", "sleep", "meditate", "study", "work"] as const)[i % 6];
  try {
    const r = await renderSpec({ kind: "track", purpose, lengthSec: 60, seed: 1000 + i });
    if (r.fails.length) { bad++; console.log("ROSSO", purpose, 1000 + i, r.fails, JSON.stringify(r.metrics.junction)); }
  } catch (e) { bad++; console.log("ERRORE", purpose, 1000 + i, String(e)); }
}
console.log("finiti 20, non passati:", bad);
