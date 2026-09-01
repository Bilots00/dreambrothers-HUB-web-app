import { describe, expect, it } from "vitest";
import { titoloProdotto, descrizioneProdotto, metaProdotto, type Design } from "./productArtistApprovals";

/**
 * Le regole di copy del brand, messe sotto test perché sono già state violate
 * due volte in produzione:
 *  - il leone è finito su Shopify come "BORN — T-Shirt DreamBrothers", con la
 *    nota di regia del generatore in descrizione;
 *  - poi come "LEO — Born To Lead | T-Shirt DreamBrothers", cioè con l'em dash
 *    (vietato dal Brain: "nessun umano lo digita"), il nome del brand nel
 *    titolo del prodotto, e tutto in italiano su un negozio che parla inglese.
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

const conScheda = (extra: Record<string, unknown>) =>
  ({
    ...leone,
    stampa: { posizione: "back", colori: ["Black"], decisaIl: "", decisaDa: "agente", ...extra },
  }) as unknown as Design;

/** Em dash e en dash: vietati ovunque, anche dentro la copy dell'agente. */
const SENZA_TRATTINI_LUNGHI = /^[^—–]*$/;

describe("titoloProdotto", () => {
  it("mette per primo il nome identitario, non la prima riga del design", () => {
    const t = titoloProdotto(leone);
    expect(t.startsWith("LEO")).toBe(true);
    expect(t).toContain("Born To Lead");
    expect(t).not.toBe("BORN — T-Shirt DreamBrothers");
  });

  it("non nomina mai il brand nel titolo del prodotto", () => {
    expect(titoloProdotto(leone)).not.toMatch(/dreambrothers/i);
    expect(titoloProdotto(conScheda({ titolo: "LEO Tee | DreamBrothers" }))).toBeTruthy();
  });

  it("non usa mai l'em dash, nemmeno se lo scrive l'agente", () => {
    expect(titoloProdotto(leone)).toMatch(SENZA_TRATTINI_LUNGHI);
    expect(titoloProdotto(conScheda({ titolo: "LEO — Born To Lead" }))).toMatch(SENZA_TRATTINI_LUNGHI);
  });

  it("non usa il concept di regia quando c'e' il testo del design", () => {
    expect(titoloProdotto(leone)).not.toContain("cross lighting");
  });

  it("preferisce il titolo scritto dal copywriter dell'agente", () => {
    expect(titoloProdotto(conScheda({ titolo: "Leo Zodiac Lion Tee | Born To Lead" })))
      .toBe("Leo Zodiac Lion Tee | Born To Lead");
  });

  it("sta nei 140 caratteri anche con un testo lunghissimo", () => {
    expect(titoloProdotto({ ...leone, testoDaComporre: "X".repeat(200) } as Design).length)
      .toBeLessThanOrEqual(140);
  });
});

describe("descrizioneProdotto", () => {
  it("non riversa in vetrina la nota di regia ne' l'etichetta dell'avatar", () => {
    const html = descrizioneProdotto(leone);
    expect(html).not.toContain("cross lighting");
    expect(html).not.toContain("Money Game");
  });

  it("e' in inglese e parla di materiali e stampa su ordinazione", () => {
    const html = descrizioneProdotto(leone);
    expect(html).toContain("LEO");
    expect(html).toMatch(/cotton/i);
    expect(html).toMatch(/made to order/i);
    expect(html).not.toMatch(/cotone|ordinazione/i);
  });

  it("non usa l'em dash", () => {
    expect(descrizioneProdotto(leone)).toMatch(SENZA_TRATTINI_LUNGHI);
    expect(descrizioneProdotto(conScheda({ descrizione: "<p>Soft tee — made to order.</p>" })))
      .toMatch(SENZA_TRATTINI_LUNGHI);
  });

  it("evita il pattern 'non e' solo X, e' Y' vietato dal Brain", () => {
    expect(descrizioneProdotto(leone)).not.toMatch(/not just a|it's more than/i);
  });

  it("sulla wall art parla di carta, non di cotone", () => {
    const quadro = { ...leone, tipo: "wallart" } as Design;
    expect(descrizioneProdotto(quadro)).toMatch(/paper/i);
    expect(descrizioneProdotto(quadro)).not.toMatch(/cotton/i);
  });
});

/**
 * Le wall art mute: nascono senza testo E senza concept (batch 2026-09-01: 14
 * quadri, entrambi i campi vuoti). Prima finivano tutte come "Dreamers Art
 * Print" — quattordici prodotti con lo stesso nome su Shopify, e il primo e'
 * stato pubblicato davvero. Il nome vero sta nell'id.
 */
const quadroMuto = {
  id: "2026-09-01_never_stop_dreaming_v1",
  file: "2026-09-01_never_stop_dreaming_v1.png",
  concept: "",
  avatar: "Money Game",
  prodotto: "wall art",
  fornitore: "Gelato",
  testoDaComporre: "",
  tipo: "wallart",
  decisione: "approvato",
  decisoIl: null,
  note: null,
  applicato: false,
} as unknown as Design;

describe("wall art senza testo ne' concept", () => {
  it("prende il nome dall'id invece del generico 'Dreamers'", () => {
    const t = titoloProdotto(quadroMuto);
    expect(t).toBe("Never Stop Dreaming Art Print");
    expect(t).not.toMatch(/^Dreamers/);
  });

  it("non porta la data della notte ne' il numero di versione nel titolo", () => {
    expect(titoloProdotto(quadroMuto)).not.toMatch(/2026|\bv1\b/i);
  });

  it("da' un titolo DIVERSO a due quadri muti diversi", () => {
    const altro = { ...quadroMuto, id: "2026-09-01_hardest_worker_room_v1" } as Design;
    expect(titoloProdotto(altro)).not.toBe(titoloProdotto(quadroMuto));
  });

  it("vale anche per il meta title", () => {
    expect(metaProdotto(quadroMuto).title).toMatch(/Never Stop Dreaming/);
  });

  it("un id senza nulla di utile ricade sul generico invece di restare vuoto", () => {
    const anonimo = { ...quadroMuto, id: "2026-09-01_v1" } as Design;
    expect(titoloProdotto(anonimo)).toBe("Dreamers Art Print");
  });
});

describe("metaProdotto", () => {
  it("non ripete titolo e descrizione del prodotto", () => {
    const m = metaProdotto(leone);
    expect(m.title).not.toBe(titoloProdotto(leone));
    expect(m.description).not.toBe(descrizioneProdotto(leone));
  });

  it("rispetta i limiti dell'audit SEO: title 60, description 160", () => {
    const m = metaProdotto({ ...leone, testoDaComporre: '"A VERY LONG SLOGAN INDEED" / "LEO"' } as Design);
    expect(m.title.length).toBeLessThanOrEqual(60);
    expect(m.description.length).toBeLessThanOrEqual(160);
  });

  it("nel meta title il brand ci sta, in coda", () => {
    expect(metaProdotto(leone).title).toMatch(/DreamBrothers$/);
  });

  it("niente em dash e niente HTML nella meta description", () => {
    const m = metaProdotto(leone);
    expect(m.title).toMatch(SENZA_TRATTINI_LUNGHI);
    expect(m.description).toMatch(SENZA_TRATTINI_LUNGHI);
    expect(m.description).not.toContain("<p>");
  });
});
