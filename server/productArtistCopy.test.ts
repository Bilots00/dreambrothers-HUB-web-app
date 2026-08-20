import { describe, expect, it } from "vitest";
import { titoloProdotto, descrizioneProdotto, type Design } from "./productArtistApprovals";

/**
 * Il 20/08 il leone e' finito su Shopify come "BORN — T-Shirt DreamBrothers",
 * con in descrizione la nota di regia del generatore ("Leone frontale fermo su
 * gradini di pietra, cross lighting"). Il titolo prendeva la prima riga del
 * testo del design, che nei design zodiacali e' l'inizio dello slogan, non il
 * nome. Questi test bloccano il ritorno di entrambe le figuracce.
 */
const leone = {
  id: "2026-08-19_leo_born_to_lead_v1",
  file: "2026-08-19_leo_born_to_lead_v1.png",
  concept: "Leone frontale fermo su gradini di pietra, cross lighting, emblema alloro e corona",
  avatar: "Money Game",
  prodotto: "T-Shirt",
  fornitore: "Printify",
  testoDaComporre: '"BORN" / "TO LEAD" / "LEO"',
  tipo: "apparel",
  decisione: "approvato",
  decisoIl: null,
  note: null,
  applicato: false,
} as unknown as Design;

describe("titoloProdotto", () => {
  it("mette per primo il nome identitario, non la prima riga del design", () => {
    const t = titoloProdotto(leone);
    expect(t.startsWith("LEO")).toBe(true);
    expect(t).toContain("Born To Lead");
    expect(t).toContain("T-Shirt");
    expect(t).not.toBe("BORN — T-Shirt DreamBrothers");
  });

  it("non usa mai il concept di regia quando c'e' il testo del design", () => {
    expect(titoloProdotto(leone)).not.toContain("cross lighting");
  });

  it("preferisce il titolo scritto dal copywriter dell'agente", () => {
    const conCopy = {
      ...leone,
      stampa: { posizione: "back", colori: ["Black"], titolo: "LEO — Nato per Guidare | DreamBrothers", decisaIl: "", decisaDa: "agente" },
    } as unknown as Design;
    expect(titoloProdotto(conCopy)).toBe("LEO — Nato per Guidare | DreamBrothers");
  });

  it("sta nei 140 caratteri anche con un testo lunghissimo", () => {
    const lungo = { ...leone, testoDaComporre: "X".repeat(200) } as Design;
    expect(titoloProdotto(lungo).length).toBeLessThanOrEqual(140);
  });
});

describe("descrizioneProdotto", () => {
  it("non riversa in vetrina la nota di regia ne' l'etichetta dell'avatar", () => {
    const html = descrizioneProdotto(leone);
    expect(html).not.toContain("cross lighting");
    expect(html).not.toContain("Money Game");
  });

  it("apre con le parole del design e parla di materiali e stampa su ordinazione", () => {
    const html = descrizioneProdotto(leone);
    expect(html).toContain("LEO");
    expect(html).toMatch(/cotone/i);
    expect(html).toMatch(/ordinazione/i);
  });

  it("preferisce la descrizione scritta dal copywriter dell'agente", () => {
    const conCopy = {
      ...leone,
      stampa: { posizione: "back", colori: ["Black"], descrizione: "<p>Copy vera.</p>", decisaIl: "", decisaDa: "agente" },
    } as unknown as Design;
    expect(descrizioneProdotto(conCopy)).toBe("<p>Copy vera.</p>");
  });

  it("sulla wall art parla di carta, non di cotone", () => {
    const quadro = { ...leone, tipo: "wallart" } as Design;
    expect(descrizioneProdotto(quadro)).toMatch(/carta/i);
    expect(descrizioneProdotto(quadro)).not.toMatch(/cotone/i);
  });
});
