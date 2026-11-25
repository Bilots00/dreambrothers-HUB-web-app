import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { REGOLA_SPECCHIO, immagineDiSeDa, immagineDiSeTesto } from "./dreammapSpecchio";

/* DreamMap app 0.9.391 (BUG-124), Andrea: "chi sto diventando è diverso da come mi vedo. Il Genio fa da specchio: non può essere in
 * disaccordo con me". La lettura riceve l'immagine di sé (il quiz Come ti vedi) e la regola dello specchio entra nel prompt. */
const sorgente = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("lo specchio: la regola", () => {
  it("distingue l'immagine di sé dalla traiettoria", () => {
    expect(REGOLA_SPECCHIO).toMatch(/IMMAGINE DI SÉ E LA TRAIETTORIA SONO DUE COSE DIVERSE/);
    expect(REGOLA_SPECCHIO).toMatch(/La traiettoria è chi sta diventando se continua con le abitudini di oggi/);
    expect(REGOLA_SPECCHIO).toMatch(/mai l'archetipo/);
  });
  it("dice al Genio di fare da specchio, senza mai contraddire", () => {
    expect(REGOLA_SPECCHIO).toMatch(/non sei mai in disaccordo con come si vede/);
    expect(REGOLA_SPECCHIO).toMatch(/non la correggi, non la giudichi/);
  });
});

describe("lo specchio: quello che arriva dall'app", () => {
  const corpo = { archetipo: "Il Talento nascosto", frase: "Sento di valere più di quello che si vede.", forza: "quello che hai dentro", impresa: true,
    risposte: [{ domanda: "Sbagli una cosa importante. Cosa ti dici, dentro?", risposta: "Lo sapevo che non era cosa per me." }, { domanda: "", risposta: "vuota" }] };
  it("si pulisce: archetipo, frase, forza, impresa e solo le risposte intere", () => {
    const x = immagineDiSeDa(corpo)!;
    expect(x.archetipo).toBe("Il Talento nascosto");
    expect(x.impresa).toBe(true);
    expect(x.risposte).toHaveLength(1);
  });
  it("senza archetipo non c'è (le app di prima non lo mandano)", () => {
    expect(immagineDiSeDa(undefined)).toBeNull();
    expect(immagineDiSeDa({ frase: "x" })).toBeNull();
    expect(immagineDiSeTesto(null)).toBe("");
  });
  it("non lascia passare markup o testi lunghissimi", () => {
    const x = immagineDiSeDa({ archetipo: "<b>Il Costruttore</b>" + "x".repeat(200), risposte: Array.from({ length: 30 }, () => ({ domanda: "d?", risposta: "r." })) })!;
    expect(x.archetipo).not.toMatch(/[<>]/);
    expect(x.archetipo.length).toBeLessThanOrEqual(40);
    expect(x.risposte.length).toBeLessThanOrEqual(12);
  });
  it("il testo per il modello dice come si vede, con le risposte al quiz", () => {
    const t = immagineDiSeTesto(immagineDiSeDa(corpo));
    expect(t).toMatch(/^COME SI VEDE \(la sua immagine di sé, dal quiz "Come ti vedi"\): Il Talento nascosto\./);
    expect(t).toMatch(/LE SUE RISPOSTE AL QUIZ:\n- Sbagli una cosa importante\. Cosa ti dici, dentro\? Lo sapevo che non era cosa per me\./);
    expect(t).toMatch(/prezzo, rischio e clienti/);
  });
});

describe("lo specchio entra nella lettura", () => {
  it("letturaRispondi legge immagineDiSe e mette la regola nel prompt, senza cambiare modello o tetto", () => {
    const s = sorgente("dreammapConversa.ts");
    const i = s.indexOf("export async function letturaRispondi");
    const f = s.slice(i, s.indexOf("\n}\n", i) > 0 ? s.indexOf("\n}\n", i) : s.indexOf("\r\n}\r\n", i));
    expect(f).toContain("immagineDiSeDa(b.immagineDiSe)");
    expect(f).toContain("REGOLA_SPECCHIO,");
    expect(f).toContain("immagineDiSeTesto(ids)");
    expect(f).toContain("modelloJson(sistema, utente, 1400)");
  });
});
