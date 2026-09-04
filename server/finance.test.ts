import { describe, expect, it } from "vitest";
import { etichettaCampione, statoCiclo, differenzaDalBenchmark, curvaUnita, leggiLibro, estremiTrade } from "./finance";

describe("estremiTrade", () => {
  it("misura sul capitale del libro, non sul nozionale a leva", () => {
    const chiuse = [{ pnl_netto: 25, coin: "SOL" }, { pnl_netto: -50, coin: "BTC" }, { pnl_netto: 10, coin: "ETH" }];
    const e = estremiTrade(chiuse, 10_000);
    expect(e.miglior_pct).toBe(0.25);
    expect(e.peggior_pct).toBe(-0.5);
    expect(e.miglior?.coin).toBe("SOL");
    expect(e.peggior?.coin).toBe("BTC");
  });
  it("senza operazioni non inventa uno zero", () => {
    expect(estremiTrade([], 10_000)).toEqual({ miglior_pct: null, peggior_pct: null });
    expect(estremiTrade(undefined, 10_000).miglior_pct).toBeNull();
  });
});

describe("etichettaCampione (TradingLab 7.5)", () => {
  // E' la riga piccola sotto il numero verde grande: l'unica cosa che puo' fermare
  // una conclusione affrettata dopo dieci giorni. Le soglie sono quelle della guida
  // e non vanno spostate per far sembrare il campione piu' maturo di quanto sia.
  it("senza operazioni non finge uno zero", () => {
    expect(etichettaCampione(0).livello).toBe("nessuno");
    expect(etichettaCampione(null).livello).toBe("nessuno");
    expect(etichettaCampione(undefined).livello).toBe("nessuno");
  });
  it("sotto 30 e' troppo piccolo, 30-100 indicativo, oltre 100 ragionevole", () => {
    expect(etichettaCampione(1).livello).toBe("piccolo");
    expect(etichettaCampione(29).livello).toBe("piccolo");
    expect(etichettaCampione(30).livello).toBe("indicativo");
    expect(etichettaCampione(100).livello).toBe("indicativo");
    expect(etichettaCampione(101).livello).toBe("ragionevole");
  });
});

describe("statoCiclo", () => {
  const ora = Date.parse("2026-09-04T12:00:00Z");
  it("legge il battito del VPS, non l'orologio del browser", () => {
    expect(statoCiclo({ t: "2026-09-04T11:57:00Z" }, ora)).toMatchObject({ acceso: true, minutiFa: 3 });
    expect(statoCiclo({ t: "2026-09-04T08:00:00Z" }, ora)).toMatchObject({ acceso: false, minutiFa: 240 });
    expect(statoCiclo({ t: "2026-09-04T08:00:00Z" }, ora).testo).toBe("fermo da 4 ore");
  });
  it("un ciclo orario e' vivo fino a 90 minuti di silenzio", () => {
    expect(statoCiclo({ t: "2026-09-04T10:30:00Z" }, ora).acceso).toBe(true);
    expect(statoCiclo({ t: "2026-09-04T10:29:00Z" }, ora).acceso).toBe(false);
  });
  it("senza battito non dice ne' acceso ne' fermo", () => {
    expect(statoCiclo(null).acceso).toBeNull();
    expect(statoCiclo({ t: "boh" }).acceso).toBeNull();
  });
});

describe("differenzaDalBenchmark", () => {
  it("+10% in un mese in cui BTC fa +40% e' -30, non un numero verde", () => {
    expect(differenzaDalBenchmark(10, 40)).toBe(-30);
    expect(differenzaDalBenchmark(16.8, 1.8)).toBe(15);
  });
  it("senza uno dei due numeri non c'e' confronto", () => {
    expect(differenzaDalBenchmark(10, null)).toBeNull();
    expect(differenzaDalBenchmark(null, 5)).toBeNull();
  });
});

describe("curvaUnita", () => {
  it("allinea il benchmark sui tempi dell'equity e lascia null dove manca", () => {
    const eq = [{ t: "a", equity: 100 }, { t: "b", equity: 110 }, { t: "c", equity: 105 }];
    const bench = [{ t: "a", valore: 100 }, { t: "c", valore: 120 }];
    expect(curvaUnita(eq, bench)).toEqual([
      { t: "a", portafoglio: 100, btc: 100 },
      { t: "b", portafoglio: 110, btc: null },
      { t: "c", portafoglio: 105, btc: 120 },
    ]);
  });
});

describe("leggiLibro", () => {
  it("senza configurazione dice perche', invece di inventare un conto vuoto", async () => {
    const prima = { base: process.env.TRADER_DASH_BASE, segreto: process.env.TRADER_DASH_SECRET };
    delete process.env.TRADER_DASH_BASE; delete process.env.TRADER_DASH_SECRET;
    const r = await leggiLibro("principale", { forza: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/non configurati/);
    if (prima.base) process.env.TRADER_DASH_BASE = prima.base;
    if (prima.segreto) process.env.TRADER_DASH_SECRET = prima.segreto;
  });
  it("un 503 del VPS e' 'non ancora generata', non un errore generico", async () => {
    process.env.TRADER_DASH_BASE = "https://esempio.test"; process.env.TRADER_DASH_SECRET = "s";
    const fetchFn = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const r = await leggiLibro("intraday", { forza: true, fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/non ha ancora generato/);
  });
});
