import { describe, expect, it } from "vitest";
import { parseFrontMatter, serializeFrontMatter, leggiDecisione, isVero, bloccoDecisione } from "./seoApprovals";

const PROPOSTA = `---
task_id: T003
titolo: Favicon implementation
data: 2026-07-27
esecutore: agente
decisione: in_attesa
applicato: no
---

## Il problema

\`/favicon.ico\` risponde 404 su tutto il sito.
`;

describe("parseFrontMatter", () => {
  it("estrae le chiavi e lascia il corpo intatto", () => {
    const { fm, corpo } = parseFrontMatter(PROPOSTA);
    expect(fm.task_id).toBe("T003");
    expect(fm.titolo).toBe("Favicon implementation");
    expect(fm.decisione).toBe("in_attesa");
    expect(corpo.trim().startsWith("## Il problema")).toBe(true);
  });

  it("regge i CRLF, che arrivano dai commit fatti da Windows", () => {
    const { fm } = parseFrontMatter(PROPOSTA.replace(/\n/g, "\r\n"));
    expect(fm.task_id).toBe("T003");
    expect(fm.decisione).toBe("in_attesa");
  });

  it("toglie le virgolette dai valori quotati", () => {
    const { fm } = parseFrontMatter(`---\nnote: "serve prima il consenso"\n---\nciao`);
    expect(fm.note).toBe("serve prima il consenso");
  });

  it("su un file senza front-matter restituisce tutto come corpo", () => {
    const { fm, corpo } = parseFrontMatter("# solo testo");
    expect(fm).toEqual({});
    expect(corpo).toBe("# solo testo");
  });
});

describe("serializeFrontMatter", () => {
  it("fa round-trip senza perdere chiavi né corpo", () => {
    const { fm, corpo } = parseFrontMatter(PROPOSTA);
    fm.decisione = "approvata";
    const out = serializeFrontMatter(fm, corpo);
    const re = parseFrontMatter(out);
    expect(re.fm.decisione).toBe("approvata");
    expect(re.fm.task_id).toBe("T003");
    expect(re.corpo.trim()).toBe(corpo.trim());
  });

  it("produce sempre un front-matter riconoscibile", () => {
    const out = serializeFrontMatter({ a: "1" }, "corpo");
    expect(out.startsWith("---\na: 1\n---\n")).toBe(true);
  });
});

describe("leggiDecisione", () => {
  it("legge lo schema nuovo", () => {
    expect(leggiDecisione({ decisione: "approvata_con_condizioni" })).toBe("approvata_con_condizioni");
    expect(leggiDecisione({ decisione: "RIFIUTATA" })).toBe("rifiutata");
  });

  it("resta compatibile con lo schema originale dell'agente", () => {
    expect(leggiDecisione({ approvato: "si" })).toBe("approvata");
    expect(leggiDecisione({ approvato: "sì" })).toBe("approvata");
    expect(leggiDecisione({ approvato: "mai" })).toBe("rifiutata");
    expect(leggiDecisione({ approvato: "no" })).toBe("in_attesa");
  });

  it("su valori sconosciuti o assenti resta in attesa, mai approvata", () => {
    expect(leggiDecisione({})).toBe("in_attesa");
    expect(leggiDecisione({ decisione: "boh" })).toBe("in_attesa");
    expect(leggiDecisione({ approvato: "forse" })).toBe("in_attesa");
  });
});

describe("isVero", () => {
  it("riconosce solo i valori affermativi espliciti", () => {
    expect(isVero("si")).toBe(true);
    expect(isVero("SÌ")).toBe(true);
    expect(isVero("true")).toBe(true);
    expect(isVero("no")).toBe(false);
    expect(isVero(undefined)).toBe(false);
    expect(isVero("")).toBe(false);
  });
});

describe("bloccoDecisione", () => {
  it("sul rifiuto include la motivazione e vieta l'applicazione", () => {
    const b = bloccoDecisione("rifiutata", "Troppo rischioso sul tema live, fallo su una copia", "2026-07-27");
    expect(b).toContain("**Esito:** rifiutata");
    expect(b).toContain("Troppo rischioso sul tema live");
    expect(b).toContain("non applicare nulla");
    expect(b).toContain("Non riproporre la stessa identica proposta");
  });

  it("sull'approvazione condizionata riporta le condizioni", () => {
    const b = bloccoDecisione("approvata_con_condizioni", "Solo sulle collection in inglese", "2026-07-27");
    expect(b).toContain("**Esito:** approvata con condizioni");
    expect(b).toContain("Condizioni da rispettare");
    expect(b).toContain("Solo sulle collection in inglese");
  });

  it("sull'approvazione piena senza note non inventa sezioni", () => {
    const b = bloccoDecisione("approvata", "", "2026-07-27");
    expect(b).toContain("**Esito:** approvata");
    expect(b).not.toContain("Note:");
    expect(b).not.toContain("Condizioni");
  });
});
