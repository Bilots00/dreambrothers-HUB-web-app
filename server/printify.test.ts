/**
 * Il prezzo di una maglietta e' una regola commerciale, non un calcolo: qui
 * diventa un check che blocca. Il 20/08/2026 il leone e' uscito a 58.99 € perche'
 * il ricarico moltiplicativo prendeva per buono un fornitore caro invece di
 * scartarlo; il caso resta in questo file e non deve mai piu' passare.
 */
import { describe, it, expect } from "vitest";
import { prezzoApparel, TAGLIE_AMMESSE, COLORI_CAPO_AMMESSI } from "./printify";

// Costi reali misurati sull'API Printify il 21/08/2026, Gildan 5000 nera,
// in centesimi di USD (Printify fattura in USD, il negozio incassa in EUR).
const OPT_FRONTE = 890; //          OPT OnDemand, dalla S alla 2XL
const OPT_FRONTE_ETICHETTA = 962; // + etichetta al collo
const OPT_FRONTE_RETRO = 1598; //   fronte + retro
const PRINTFUL_FRONTE_RETRO = 2353; // il fornitore vecchio, stessa maglietta

describe("listino apparel", () => {
  it("tiene il prezzo deciso da Andrea: 29.90 fronte, 37.90 fronte+retro", () => {
    expect(prezzoApparel(OPT_FRONTE, false)).toBe(2990);
    expect(prezzoApparel(OPT_FRONTE_ETICHETTA, false)).toBe(2990);
    expect(prezzoApparel(OPT_FRONTE_RETRO, true)).toBe(3790);
  });

  it("non cambia prezzo tra le taglie: su OPT il capo costa uguale fino alla 2XL", () => {
    const taglie = [890, 890, 890, 890, 890]; // S, M, L, XL, 2XL
    const prezzi = new Set(taglie.map(c => prezzoApparel(c, false)));
    expect(prezzi.size).toBe(1);
  });

  it("il caso leone del 20/08 non si ripete: mai piu' un capo sopra i 45 €", () => {
    // Con il vecchio ricarico 1.8x questo costo produceva 5899 (58.99 €).
    expect(prezzoApparel(PRINTFUL_FRONTE_RETRO, true)).toBeLessThan(4500);
  });

  it("se il fornitore rincara il prezzo sale invece di andare sotto margine", () => {
    const costoAssurdo = 4000; // 40 USD di sola produzione
    const prezzo = prezzoApparel(costoAssurdo, true);
    expect(prezzo).toBeGreaterThan(3790);
    // resta sopra il margine minimo del 40% sul costo sbarcato (capo + spedizione)
    const costoEur = (costoAssurdo + 449) * 0.86;
    expect((prezzo - costoEur) / prezzo).toBeGreaterThan(0.4);
  });

  it("i prezzi finiscono sempre in .90, mai in .99 o tondi", () => {
    for (const costo of [890, 1598, 2353, 4000, 6000]) {
      for (const doppia of [false, true]) {
        expect(prezzoApparel(costo, doppia) % 100).toBe(90);
      }
    }
  });
});

describe("catalogo capi", () => {
  it("si arriva alla 2XL e basta: niente 3XL, 4XL, 5XL", () => {
    expect(TAGLIE_AMMESSE).toEqual(["S", "M", "L", "XL", "2XL"]);
    for (const fuori of ["3XL", "4XL", "5XL"]) {
      expect(TAGLIE_AMMESSE).not.toContain(fuori);
    }
  });

  it("la palette resta quella del brand", () => {
    expect(COLORI_CAPO_AMMESSI).toEqual(["Black", "White", "Sand", "Sport Grey"]);
  });
});
