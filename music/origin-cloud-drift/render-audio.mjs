// Offline-render the built-in score in headless Chrome and save a WAV.
// usage: node render-audio.mjs seconds out.wav [pulse]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const seconds = Number(process.argv[2] || 150), out = process.argv[3] || 'cloud-drift.wav', pulse = process.argv[4] != null ? Number(process.argv[4]) : 0.18, tail = Number(process.argv[5] || 0);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8765/test/blank.html', { waitUntil: 'load' });
await page.addScriptTag({ url: 'http://localhost:8765/test/score.js' });
await page.evaluate(async (seconds, pulse, tail) => {
  const S = window.CloudDrift.Sound;
  const buf = tail > 0 ? await S.renderLoop(seconds, tail, { pulse }) : await S.renderOffline(seconds, { pulse });
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0.89 ? 0.89 / peak : 1;
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { pcm[i * 2] = Math.max(-1, Math.min(1, L[i] * g)) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i] * g)) * 32767; }
  window.__pcm = new Uint8Array(pcm.buffer); window.__peak = peak; window.__sr = buf.sampleRate;
}, seconds, pulse, tail);
const { len, peak, sr } = await page.evaluate(() => ({ len: window.__pcm.length, peak: window.__peak, sr: window.__sr }));
const chunks = []; const CH = 4 * 1024 * 1024;
for (let o = 0; o < len; o += CH) {
  const b64 = await page.evaluate((o, CH) => { let s = ''; const a = window.__pcm.subarray(o, o + CH); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }, o, CH);
  chunks.push(Buffer.from(b64, 'base64'));
}
const data = Buffer.concat(chunks);
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.writeFileSync(out, Buffer.concat([h, data]));
console.log('wrote', out, (data.length / 1e6).toFixed(1), 'MB, raw peak', peak.toFixed(3));
await browser.close();
