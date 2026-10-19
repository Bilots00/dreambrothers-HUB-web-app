import { describe, it, expect } from "vitest";
import { firma, firmaValida } from "./focuslockVita";

describe("vita in settimane: gli indirizzi firmati dei file", () => {
  it("un indirizzo firmato vale fino alla scadenza", () => {
    const ora = Date.now(), scade = ora + 3600_000;
    expect(firmaValida(42, scade, firma(42, scade), ora)).toBe(true);
  });
  it("scaduto, di un altro file o troppo lontano non vale", () => {
    const ora = Date.now(), scade = ora + 3600_000;
    expect(firmaValida(42, ora - 1000, firma(42, ora - 1000), ora)).toBe(false);
    expect(firmaValida(43, scade, firma(42, scade), ora)).toBe(false);
    const lontano = ora + 30 * 24 * 3600_000;
    expect(firmaValida(42, lontano, firma(42, lontano), ora)).toBe(false);
    expect(firmaValida(42, scade, "nonvale", ora)).toBe(false);
  });
});
