import { describe, expect, it } from "vitest";
import { scegliCompagno, slotValido, attivitaCompatibili, serie, primo, type Pren } from "./focuslockCompagni";
import { giorniPrevisti, importoGiorno, scadenza, giornoDi, abitudineValida } from "./focuslockPatti";

const p = (id: number, sub: string, x: Partial<Pren> = {}): Pren => ({ id, googleSub: sub, slotAt: 1_800_000_000_000 - (1_800_000_000_000 % 900_000), durata: 50, attivita: "scrivania", silenzio: 0, preferiti: 0, stato: "attesa", createdAt: id, ...x });

describe("sessioni in coppia: l'abbinamento", () => {
  it("abbina solo stessa ora, stessa durata, lavoro compatibile, mai se stessi", () => {
    const mia = p(1, "a");
    expect(scegliCompagno(mia, [p(2, "a"), p(3, "b", { durata: 25 }), p(4, "c", { attivita: "movimento" })], [])).toBeNull();
    expect(scegliCompagno(mia, [p(5, "d", { attivita: "qualsiasi" })], [])?.id).toBe(5);
  });
  it("prima i preferiti (se li vuole), poi lo stesso silenzio, poi chi aspetta da piu' tempo", () => {
    const mia = p(1, "a", { preferiti: 1, silenzio: 1 });
    const l = [p(2, "b"), p(3, "c", { silenzio: 1 }), p(4, "fav")];
    expect(scegliCompagno(mia, l, ["fav"])?.id).toBe(4);
    expect(scegliCompagno({ ...mia, preferiti: 0 }, l, ["fav"])?.id).toBe(3);
    expect(scegliCompagno(p(1, "a"), [p(9, "x"), p(8, "y")], [])?.id).toBe(8);
  });
  it("l'ora deve essere un quarto d'ora preciso, non oltre 8 giorni", () => {
    const adesso = 1_800_000_000_000;
    const q = adesso - (adesso % 900_000) + 900_000;
    expect(slotValido(q, adesso)).toBe(true);
    expect(slotValido(q + 60_000, adesso)).toBe(false);
    expect(slotValido(q + 9 * 86400_000, adesso)).toBe(false);
    expect(attivitaCompatibili("movimento", "scrivania")).toBe(false);
    expect(primo(3, 7)).toBe(true);
  });
  it("la serie conta i giorni di fila fino a oggi o ieri", () => {
    expect(serie(["2026-10-17", "2026-10-18", "2026-10-19"], "2026-10-19")).toBe(3);
    expect(serie(["2026-10-17", "2026-10-18"], "2026-10-19")).toBe(2);
    expect(serie(["2026-10-15"], "2026-10-19")).toBe(0);
  });
});

describe("il patto: i giorni, la scadenza, il tetto", () => {
  const ab = abitudineValida({ cosa: "Leggere 10 pagine", giorni: [true, false, true, false, true, false, false], entro: "21:00", verifica: { tipo: "sessione", minuti: 25 } })!;
  it("i giorni previsti seguono lunedi'-mercoledi'-venerdi'", () => {
    expect(giorniPrevisti(ab, "2026-10-19", "2026-10-25")).toEqual(["2026-10-19", "2026-10-21", "2026-10-23"]);
  });
  it("la scadenza e' l'ora italiana di quel giorno", () => {
    const t = scadenza("2026-10-19", "21:00");
    expect(giornoDi(t)).toBe("2026-10-19");
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t))).toBe("21:00");
    const inverno = scadenza("2026-12-01", "07:30");
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(inverno))).toBe("07:30");
  });
  it("il tetto del mese ferma l'importo", () => {
    expect(importoGiorno(500, 2000, 0)).toBe(500);
    expect(importoGiorno(500, 2000, 1800)).toBe(200);
    expect(importoGiorno(500, 2000, 2000)).toBe(0);
  });
  it("un'abitudine senza giorni o senza verifica non vale", () => {
    expect(abitudineValida({ cosa: "x", giorni: [false, false, false, false, false, false, false], verifica: { tipo: "sessione" } })).toBeNull();
    expect(abitudineValida({ cosa: "x", giorni: [true, true, true, true, true, true, true], verifica: { tipo: "pensieri" } })).toBeNull();
  });
});
