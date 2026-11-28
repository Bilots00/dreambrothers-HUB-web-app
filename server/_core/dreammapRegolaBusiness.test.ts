import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { REGOLA_ROADMAP_BUSINESS, REGOLA_ROADMAP_BUSINESS_BREVE, DOMANDA_OBIETTIVO_BUSINESS } from "./dreammapRegolaBusiness";

/* DreamMap app 0.9.402 (BUG-255), Andrea: la roadmap di un sogno di business segue Promote, Deliver, Build di Hormozi per chi parte
 * da zero; se l'attivita' e' gia' avviata prima la consegna; le ore per parte non sono obbligatorie; quando si crea la roadmap
 * l'agente chiede l'obiettivo (soldi in fretta o brand duraturo). La regola c'e' ed entra in ogni prompt che scrive la roadmap. */
const sorgente = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("i sogni di business: la regola", () => {
  it("mette Promote, Deliver e Build in quest'ordine", () => {
    const p = REGOLA_ROADMAP_BUSINESS.indexOf("1) PROMOTE"), d = REGOLA_ROADMAP_BUSINESS.indexOf("2) DELIVER"), b = REGOLA_ROADMAP_BUSINESS.indexOf("3) BUILD");
    expect(p).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(p);
    expect(b).toBeGreaterThan(d);
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/Hormozi/);
    expect(REGOLA_ROADMAP_BUSINESS_BREVE).toMatch(/Promote, Deliver, Build/);
  });
  it("dice che le ore non sono obbligatorie e che con meno ore si arriva dopo", () => {
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/LE ORE NON SONO OBBLIGATORIE/);
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/arriva dopo/);
    expect(REGOLA_ROADMAP_BUSINESS_BREVE).toMatch(/con meno ore si arriva dopo/);
  });
  it("tiene conto del contesto: se l'attività è già avviata, prima la consegna", () => {
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/già avviata.*prima si sistema la consegna/);
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/un ottimo marketing fa fallire più in fretta un cattivo prodotto/);
    expect(REGOLA_ROADMAP_BUSINESS_BREVE).toMatch(/già avviata, prima si sistema la consegna/);
  });
  it("chiede l'obiettivo prima di scrivere le tappe, e dice come cambiano", () => {
    expect(DOMANDA_OBIETTIVO_BUSINESS).toMatch(/soldi in fretta.*brand solido.*community/);
    expect(REGOLA_ROADMAP_BUSINESS).toContain(DOMANDA_OBIETTIVO_BUSINESS);
    expect(REGOLA_ROADMAP_BUSINESS_BREVE).toContain(DOMANDA_OBIETTIVO_BUSINESS);
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/Con i soldi in fretta le tappe/);
    expect(REGOLA_ROADMAP_BUSINESS).toMatch(/Con il brand duraturo le tappe/);
  });
  it("non usa il trattino lungo né le caporali", () => {
    expect(REGOLA_ROADMAP_BUSINESS + REGOLA_ROADMAP_BUSINESS_BREVE).not.toMatch(/[—–«»]/);
  });
});

describe("i sogni di business: i prompt la usano", () => {
  it("la chat dell'agente e il lavoratore sul VPS (REGOLE_SCRITTURA), con la domanda nell'intervista e nella prima roadmap", () => {
    const s = sorgente("dreammapChat.ts");
    const a = s.indexOf("const REGOLE_SCRITTURA = ["), b = s.indexOf("].join(", a);
    expect(s.slice(a, b)).toContain("REGOLA_ROADMAP_BUSINESS,");
    const i = s.slice(s.indexOf("L'INTERVISTA PER LA ROADMAP SU MISURA"), s.indexOf("LE REGOLE DELLA PARTITA (app 0.9.285)"));
    expect(i).toMatch(/7\) se il sogno è un business.*l'obiettivo: soldi in fretta oppure un brand solido/);
    const p = s.slice(s.indexOf("LA PRIMA ROADMAP SU MISURA"), s.indexOf("Quando proponi o aggiorni la roadmap"));
    expect(p).toMatch(/Se il sogno è un business, una delle quattro domande è l'obiettivo/);
  });
  it("le revisioni che propongono il percorso nuovo (dreammapConversa)", () => {
    const s = sorgente("dreammapConversa.ts");
    const a = s.indexOf("const REGOLE = ["), b = s.indexOf("].join(", a);
    expect(s.slice(a, b)).toContain("REGOLA_ROADMAP_BUSINESS,");
  });
  it("gli strumenti che scrivono la roadmap (aggiorna_roadmap e scrivi_roadmap) e le istruzioni del ponte", () => {
    const t = sorgente("dreammapAgentTools.ts");
    expect(t.slice(t.indexOf("name: \"aggiorna_roadmap\""), t.indexOf("input_schema", t.indexOf("name: \"aggiorna_roadmap\"")))).toContain("REGOLA_ROADMAP_BUSINESS_BREVE");
    const p = sorgente("dreammapPonte.ts");
    expect(p.slice(p.indexOf("name: \"scrivi_roadmap\""), p.indexOf("inputSchema", p.indexOf("name: \"scrivi_roadmap\"")))).toContain("REGOLA_ROADMAP_BUSINESS_BREVE");
    expect(p).toMatch(/per un sogno di business anche l'obiettivo: soldi in fretta oppure un brand solido/);
  });
});
