/* ---- LA TARATURA DELL'ENERGIA (DreamMap app 0.9.397) ----
 * Andrea: "il Genio chiede quanto ti senti carico quando inizi a lavorare e lo confronta con quello che l'app misura. Salva in locale
 * la risposta accanto ai valori misurati di quel giorno, e mandala al server con i dati della lettura, cosi' in futuro si puo' tarare
 * la stima della dopamina sulle risposte degli utenti".
 * Le righe arrivano con la lettura (POST /api/focuslock/agent/lettura, campo `taratura`): al massimo le ultime dieci, una per giorno.
 * Qui si puliscono (solo numeri e date, niente testo libero), si scrive una riga di registro per riga (per tararle dopo) e si danno al
 * Genio come contesto: come dice di sentirsi e cosa misurava l'app quel giorno. La dopamina resta una stima, mai una misura medica. */

export type RigaTaratura = {
  giorno: string; risposta: number; stima: number | null; sonno: number | null; focus: number | null; riposo: number | null;
  dopamina: number | null; lavoroMin: number | null; lavoroDetto: number | null; conSveglia: boolean | null; rimandi: number | null;
};

function numero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

/** Le righe che arrivano dall'app, pulite: giorno AAAA-MM-GG, risposta da 1 a 5, i valori nei loro limiti. Le altre si scartano. */
export function taraturaDa(x: unknown): RigaTaratura[] {
  if (!Array.isArray(x)) return [];
  const visti = new Set<string>();
  const out: RigaTaratura[] = [];
  for (const r of x.slice(-10)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const giorno = typeof o.giorno === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.giorno) ? o.giorno : "";
    const risposta = numero(o.risposta, 1, 5);
    if (!giorno || risposta == null || visti.has(giorno)) continue;
    visti.add(giorno);
    out.push({
      giorno, risposta: Math.round(risposta), stima: numero(o.stima, 1, 5),
      sonno: numero(o.sonno, 0, 100), focus: numero(o.focus, 0, 100), riposo: numero(o.riposo, 0, 100), dopamina: numero(o.dopamina, 0, 100),
      lavoroMin: numero(o.lavoroMin, 0, 1440), lavoroDetto: numero(o.lavoroDetto, 0, 1440),
      conSveglia: typeof o.conSveglia === "boolean" ? o.conSveglia : null, rimandi: numero(o.rimandi, 0, 20),
    });
  }
  return out.sort((a, b) => (a.giorno < b.giorno ? -1 : a.giorno > b.giorno ? 1 : 0));
}

/** Il contesto per il Genio: una riga per giorno, in italiano. Vuoto se non ci sono righe. */
export function taraturaTesto(l: RigaTaratura[]): string {
  if (!l.length) return "";
  const v = (n: number | null, u = "") => (n == null ? "non misurato" : String(n).replace(".", ",") + u);
  return "COME DICE DI SENTIRSI QUANDO INIZIA A LAVORARE (da 1, a terra, a 5, pieno di energia) E COSA MISURAVA L'APP QUEL GIORNO"
    + " (la dopamina è una stima del telefono, non una misura medica):\n"
    + l.map((r) => `${r.giorno}: risposta ${r.risposta}, stima dai numeri ${v(r.stima)}; sonno ${v(r.sonno)}, riposo ${v(r.riposo)}, dopamina ${v(r.dopamina)}, dalla sveglia al lavoro ${v(r.lavoroMin, " minuti")}`).join("\n");
}

/** Una riga di registro per riga di taratura: si cercano con "[dreammap-taratura]". Il sub e' accorciato: basta a contare le persone. */
export function taraturaRegistra(sub: string, l: RigaTaratura[]): void {
  if (!l.length) return;
  const chi = String(sub || "").slice(-8);
  for (const r of l) {
    try { console.info("[dreammap-taratura] " + JSON.stringify({ chi, ...r })); } catch { /* il registro non ferma mai la lettura */ }
  }
}
