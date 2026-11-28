import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { REGOLA_PASSO_AVANZA, REGOLA_PASSO_AVANZA_BREVE, passoSoloRaccolta } from "./dreammapRegolaPassi";

/* DreamMap app 0.9.390 (BUG-122), Andrea: "Guarda quali prodotti hanno venduto di più nell'ultimo mese, 45 minuti: lo legge l'AI in
 * 2 secondi mentre l'utente dorme. Servono passi concreti". La regola c'e', con gli esempi giusti e sbagliati, ed entra in ogni prompt
 * che scrive passi, tappe, roadmap o il perche' del passo di domani. */
const sorgente = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("un passo fa avanzare: la regola", () => {
  it("dice cosa è un passo e cosa non lo è", () => {
    expect(REGOLA_PASSO_AVANZA).toMatch(/azione che fa avanzare: produrre, costruire, lanciare, pubblicare, vendere, contattare/);
    expect(REGOLA_PASSO_AVANZA).toMatch(/Raccogliere dati, leggere numeri.*NON sono passi/);
    expect(REGOLA_PASSO_AVANZA).toMatch(/Togli le decisioni/);
  });
  it("ha l'esempio sbagliato di BUG-122 e quello giusto", () => {
    expect(REGOLA_PASSO_AVANZA).toContain("NO \"Guarda quali prodotti hanno venduto di più nell'ultimo mese (45 minuti)\"");
    expect(REGOLA_PASSO_AVANZA).toContain("SÌ \"Metti in prima pagina il prodotto che ha venduto di più nell'ultimo mese");
    expect((REGOLA_PASSO_AVANZA.match(/NO \"/g) || []).length).toBeGreaterThanOrEqual(4);
  });
  it("chiede tempi realistici, mai 45 minuti di serie", () => {
    expect(REGOLA_PASSO_AVANZA).toMatch(/IL TEMPO DI UN PASSO è quello che quel compito richiede davvero/);
    expect(REGOLA_PASSO_AVANZA).toMatch(/Mai 45 minuti di serie/);
    expect(REGOLA_PASSO_AVANZA_BREVE).toMatch(/mai 45 di serie/);
  });
  it("riconosce un passo di sola raccolta dati", () => {
    expect(passoSoloRaccolta("Guarda quali prodotti hanno venduto di più nell'ultimo mese")).toBe(true);
    expect(passoSoloRaccolta("Controlla dove i visitatori abbandonano il carrello")).toBe(true);
    expect(passoSoloRaccolta("Cercare un fornitore")).toBe(true);
    expect(passoSoloRaccolta("Metti in prima pagina il prodotto che ha venduto di più nell'ultimo mese")).toBe(false);
    expect(passoSoloRaccolta("Scrivi ai clienti che hanno comprato una volta sola (20 minuti)")).toBe(false);
  });
});

describe("un passo fa avanzare: i prompt la usano", () => {
  it("la chat dell'agente e il lavoratore sul VPS (REGOLE_SCRITTURA)", () => {
    const s = sorgente("dreammapChat.ts");
    const a = s.indexOf("const REGOLE_SCRITTURA = ["), b = s.indexOf("].join(", a);
    expect(s.slice(a, b)).toContain("REGOLA_PASSO_AVANZA,");
    expect(s.slice(a, b)).not.toMatch(/richiede almeno 25 minuti/);
  });
  it("le revisioni e il perché del passo di domani (dreammapConversa)", () => {
    const s = sorgente("dreammapConversa.ts");
    const a = s.indexOf("const REGOLE = ["), b = s.indexOf("].join(", a);
    expect(s.slice(a, b)).toContain("REGOLA_PASSO_AVANZA,");
    expect(s.slice(a, b)).not.toMatch(/dura almeno 25 minuti/);
    const p = s.slice(s.indexOf("b.evento === \"passo_domani\""), s.indexOf("Risposte della persona finora"));
    expect(p).toMatch(/Il Tempo è quello che il compito richiede davvero/);
    expect(p).toMatch(/quanto lo stima il percorso, tieni quel numero/);
    expect(p).toMatch(/lo fa l'intelligenza artificiale in pochi secondi/);
  });
  /* app 0.9.403 (BUG-284, BUG-282): campi separati, un tempo unico, la categoria del lavoro */
  it("il passo di domani: campi separati, un tempo solo e la categoria (dreammapConversa)", () => {
    const s = sorgente("dreammapConversa.ts");
    const p = s.slice(s.indexOf("b.evento === \"passo_domani\""), s.indexOf("Risposte della persona finora"));
    expect(p).toMatch(/ognuna sulla sua riga/);
    expect(p).toMatch(/nel Perché niente priorità e niente minuti/);
    expect(p).toMatch(/IL TEMPO È UNO SOLO: un solo numero di minuti in tutta la risposta/);
    expect(p).toMatch(/\\"Categoria:\\"/);
    expect(p).toMatch(/sito, scrittura, video, studio, chiamata, riunione, vendita, email, design, marketing, sport, casa, mente/);
    expect(p).toMatch(/chiamata solo se si telefona/);
  });
  it("gli strumenti che scrivono la roadmap (aggiorna_roadmap e scrivi_roadmap)", () => {
    const t = sorgente("dreammapAgentTools.ts");
    expect(t.slice(t.indexOf("name: \"aggiorna_roadmap\""), t.indexOf("input_schema", t.indexOf("name: \"aggiorna_roadmap\"")))).toContain("REGOLA_PASSO_AVANZA_BREVE");
    const p = sorgente("dreammapPonte.ts");
    expect(p.slice(p.indexOf("name: \"scrivi_roadmap\""), p.indexOf("inputSchema", p.indexOf("name: \"scrivi_roadmap\"")))).toContain("REGOLA_PASSO_AVANZA_BREVE");
  });
});
