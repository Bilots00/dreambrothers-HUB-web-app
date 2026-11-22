import { describe, expect, it } from "vitest";
import { scegliCompagno, slotValido, attivitaCompatibili, serie, primo, type Pren } from "./dreammapCompagni";
import { giorniPrevisti, importoGiorno, scadenza, giornoDi, abitudineValida, perBeneficenza, riceviValido, linkPaypal, statoDebito, seNonPagaValido, formatiTg } from "./dreammapPatti";
import { linguaValida, controllaTraduzione, segnaposto, sorgente, pacchi, traduci, _provaClaude } from "./dreammapTraduzioni";

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

describe("il patto del contratto di abitudine (0.9.302)", () => {
  const base = { cosa: "Rispettare il contratto di abitudine", giorni: [true, true, true, true, true, true, true], entro: "23:59" };
  it("accetta la verifica contratto, verso un amico o un ente", () => {
    expect(abitudineValida({ ...base, verifica: { tipo: "contratto" } })?.verifica.tipo).toBe("contratto");
    expect(abitudineValida({ ...base, verifica: { tipo: "contratto" } })?.destinazione).toBeUndefined();
    const b = abitudineValida({ ...base, verifica: { tipo: "contratto" }, destinazione: { tipo: "beneficenza", ente: "  La Croce Rossa <di Roma>  " } });
    expect(b?.destinazione).toEqual({ tipo: "beneficenza", ente: "La Croce Rossa di Roma" });
  });
  it("beneficenza senza ente non vale", () => {
    expect(abitudineValida({ ...base, verifica: { tipo: "contratto" }, destinazione: { tipo: "beneficenza", ente: "  " } })).toBeNull();
  });
  it("riconosce un patto verso un ente", () => {
    expect(perBeneficenza({ abitudine: JSON.stringify({ destinazione: { tipo: "beneficenza", ente: "Emergency" } }) })).toBe(true);
    expect(perBeneficenza({ abitudine: JSON.stringify({ cosa: "x" }) })).toBe(false);
    expect(perBeneficenza({ abitudine: "rotto" })).toBe(false);
  });
});

describe("il patto senza Stripe: il debito verso il garante (22/11/2026)", () => {
  it("come ricevere: tiene solo quello che si puo' usare per pagare", () => {
    expect(riceviValido({ paypal: "https://paypal.me/Marco.Rossi", revolut: "@marcor", satispay: "+39 333 123 4567", iban: "it60 x054 2811 1010 0000 0123 456", intestatario: "Marco Rossi" }))
      .toEqual({ paypal: "Marco.Rossi", revolut: "marcor", satispay: "+393331234567", iban: "IT60X0542811101000000123456", intestatario: "Marco Rossi" });
    expect(riceviValido({ iban: "non un iban", satispay: "123" })).toBeNull();
    expect(riceviValido(null)).toBeNull();
  });
  it("il link PayPal ha la cifra e la valuta", () => {
    expect(linkPaypal("marco", 500)).toBe("https://paypal.me/marco/5EUR");
    expect(linkPaypal("marco", 250)).toBe("https://paypal.me/marco/2.50EUR");
  });
  it("il debito: da pagare, poi scaduto dopo la scadenza; pagato e ricevuto non scadono", () => {
    const t = Date.parse("2026-11-20T10:00:00Z");
    const g = { esito: "mancato", importo: 500, statoPagamento: "da_pagare", scadeAt: t };
    expect(statoDebito(g, t - 1)).toBe("da_pagare");
    expect(statoDebito(g, t + 1)).toBe("scaduto");
    expect(statoDebito({ ...g, statoPagamento: "pagato" }, t + 1)).toBe("pagato");
    expect(statoDebito({ ...g, statoPagamento: "ricevuto" }, t + 1)).toBe("ricevuto");
  });
  it("niente debito senza soldi, verso un ente o in un giorno rispettato", () => {
    expect(statoDebito({ esito: "mancato", importo: 0, statoPagamento: "niente", scadeAt: null }, 0)).toBeNull();
    expect(statoDebito({ esito: "mancato", importo: 500, statoPagamento: "da_donare", scadeAt: null }, 0)).toBeNull();
    expect(statoDebito({ esito: "rispettato", importo: 0, statoPagamento: null, scadeAt: null }, 0)).toBeNull();
  });
  it("la penitenza se non paga: numeri dentro i limiti, la serie si o no", () => {
    expect(seNonPagaValido({ grigioOre: 200, severaOre: -3, serie: 1 })).toEqual({ grigioOre: 72, severaOre: 0, serie: true });
    expect(seNonPagaValido(undefined)).toEqual({ grigioOre: 0, severaOre: 0, serie: false });
    expect(abitudineValida({ cosa: "x", giorni: [true, true, true, true, true, true, true], verifica: { tipo: "contratto" }, seNonPaga: { grigioOre: 6, serie: true } })?.seNonPaga)
      .toEqual({ grigioOre: 6, severaOre: 0, serie: true });
  });
});

describe("i testi in qualsiasi lingua (dreammapTraduzioni)", () => {
  it("accetta solo lingue vere, anche il giapponese, e tiene le varianti che contano", () => {
    expect(linguaValida("ja")).toBe("ja");
    expect(linguaValida("ja-JP")).toBe("ja");
    expect(linguaValida("pt_BR")).toBe("pt-BR");
    expect(linguaValida("zh-Hant")).toBe("zh-Hant");
    expect(linguaValida("xx")).toBe("");
    expect(linguaValida("<script>")).toBe("");
  });
  it("scarta le frasi tradotte male: segnaposto o grassetto persi", () => {
    const src = { a: "Ti deve {euro}", b: "Se non paghi <b>entro 48 ore</b>", c: "Ciao" };
    const r = controllaTraduzione(src, { a: "They owe you money", b: "If you don't pay <b>within 48 hours</b>", c: 5 });
    expect(Object.keys(r.buone)).toEqual(["b"]);
    expect(r.male.sort()).toEqual(["a", "c"]);
    expect(segnaposto("{chi} {euro} {chi}")).toBe("{chi},{euro}");
  });
  it("i pacchi italiani ci sono e il Genio parla su Telegram", () => {
    expect(pacchi()).toContain("telegram");
    const t = sorgente("telegram")!;
    expect(t.collegato).toContain("Genio");
    expect(segnaposto(t.mancato)).toBe("{chi},{data},{euro}");
  });
  it("cifra e giorno nel formato di chi legge, anche in giapponese", () => {
    expect(formatiTg("en", { giorno: "2026-11-23", centesimi: 500 })).toEqual({ data: "Monday, November 23", euro: "€5" });
    expect(formatiTg("de", { centesimi: 250 }).euro).toContain("2,50");
    expect(formatiTg("ja", { giorno: "2026-11-23", centesimi: 500 }).data).toContain("11月23日");
  });
});

describe("il traduttore: rifà le frasi venute male e non traduce due volte", () => {
  it("giapponese: glossario, pacco, secondo giro sulla frase rotta, poi dalla memoria", async () => {
    const chiamate: string[] = [];
    _provaClaude({ beta: { messages: { stream: (req: any) => {
      const sorg = JSON.parse(String(req.messages[0].content).split("Italian source, as JSON:\n\n")[1]);
      const tipo = sorg.genio ? "glossario" : Object.keys(sorg).length === 1 ? "secondo" : "pacco";
      chiamate.push(tipo);
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(sorg)) out[k] = "JA:" + v;
      if (tipo === "pacco") out.mancato = "JA senza segnaposto";
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }) };
    } } } });
    const r = await traduci("telegram", "ja-JP");
    expect(r.lingua).toBe("ja");
    expect(r.testi.mancato).toContain("{euro}");
    expect(chiamate).toEqual(["glossario", "pacco", "secondo"]);
    await traduci("telegram", "ja");
    expect(chiamate.length).toBe(3);
    const it = await traduci("telegram", "it");
    expect(it.testi.collegato).toContain("Genio");
    _provaClaude(null);
  });
});
