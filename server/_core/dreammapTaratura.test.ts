import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { taraturaDa, taraturaTesto, taraturaRegistra } from "./dreammapTaratura";

/* DreamMap app 0.9.397: la domanda di controllo sull'energia. Le righe arrivano con la lettura e servono a tarare la stima della dopamina. */
const sorgente = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("la taratura: quello che arriva dall'app", () => {
  it("tiene solo le righe con un giorno e una risposta da 1 a 5, una per giorno, in ordine", () => {
    const l = taraturaDa([
      { giorno: "2026-11-27", risposta: 4, stima: 2.1, sonno: 40, riposo: 35, dopamina: 38.2, lavoroMin: 150, conSveglia: true },
      { giorno: "2026-11-25", risposta: "2", sonno: 80 },
      { giorno: "2026-11-27", risposta: 1 },
      { giorno: "ieri", risposta: 3 },
      { giorno: "2026-11-26", risposta: 9 },
      "testo",
    ]);
    expect(l.map((r) => r.giorno)).toEqual(["2026-11-25", "2026-11-27"]);
    expect(l[1].risposta).toBe(4);
    expect(l[1].dopamina).toBe(38.2);
    expect(l[1].conSveglia).toBe(true);
    expect(l[0].stima).toBeNull();
  });
  it("scarta i valori fuori dai limiti e il testo libero", () => {
    const [r] = taraturaDa([{ giorno: "2026-11-27", risposta: 3, sonno: 400, dopamina: "<script>", note: "privato" }]);
    expect(r.sonno).toBeNull();
    expect(r.dopamina).toBeNull();
    expect((r as any).note).toBeUndefined();
  });
  it("niente righe, niente contesto: le app di prima vanno come prima", () => {
    expect(taraturaDa(undefined)).toEqual([]);
    expect(taraturaTesto([])).toBe("");
  });
});

describe("la taratura: il Genio e il registro", () => {
  it("il contesto dice risposta, stima e misure, e che la dopamina è una stima", () => {
    const t = taraturaTesto(taraturaDa([{ giorno: "2026-11-27", risposta: 4, stima: 2.1, sonno: 40, riposo: 35, dopamina: 38.2, lavoroMin: 150 }]));
    expect(t).toMatch(/non una misura medica/);
    expect(t).toMatch(/2026-11-27: risposta 4, stima dai numeri 2,1; sonno 40, riposo 35, dopamina 38,2, dalla sveglia al lavoro 150 minuti/);
  });
  it("ogni riga finisce nel registro, con il sub accorciato", () => {
    const spia = vi.spyOn(console, "info").mockImplementation(() => {});
    taraturaRegistra("utente-lunghissimo-12345678", taraturaDa([{ giorno: "2026-11-27", risposta: 2 }]));
    expect(spia).toHaveBeenCalledTimes(1);
    expect(String(spia.mock.calls[0][0])).toMatch(/^\[dreammap-taratura\] \{"chi":"12345678","giorno":"2026-11-27","risposta":2/);
    spia.mockRestore();
  });
  it("la lettura legge il campo taratura e lo passa al Genio", () => {
    const s = sorgente("dreammapConversa.ts");
    expect(s).toMatch(/const taratura = taraturaDa\(b\.taratura\);/);
    expect(s).toMatch(/taraturaRegistra\(sub, taratura\);/);
    expect(s).toMatch(/taraturaTesto\(taratura\)/);
  });
});
