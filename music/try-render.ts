// Prova locale: node --import tsx music/try-render.ts <purpose> <lengthSec> <seed> [mood] [sfxType]
import fs from "node:fs";
import { renderSpec } from "../server/music/render";
const [purpose = "relax", len = "150", seed = "64", mood, sfxType] = process.argv.slice(2);
const kind = purpose === "sfx" ? "sfx" : "track";
const r = await renderSpec({ kind, purpose: purpose as any, lengthSec: Number(len), seed: Number(seed), mood: mood as any, sfxType: sfxType as any });
const name = `music/out/${purpose}-${sfxType || mood || "def"}-${seed}.mp3`;
fs.writeFileSync(name, r.mp3);
const { gate, junction, ...m } = r.metrics;
console.log(JSON.stringify({ name, title: r.title, dur: r.durationSec.toFixed(2), loopSec: r.loopSec, loopStart: r.loopStartSec, kb: (r.mp3.length / 1024) | 0, ...m, gate: { o: gate.openingSec, gap: gate.longestGapSec, min: gate.minDb.toFixed(1) }, junction, fails: r.fails }));
