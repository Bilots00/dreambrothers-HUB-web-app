import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { appDaiDati, filtraAppProgramma, domandaGiudizio, catOpzione } from "./dreammapRientroFiltro";

/* DreamMap app 0.9.395, Andrea (26/11): il Genio del Rientra in rotta ha creato "Protezione tempo libero" che blocca Telegram, per lui
 * un'app per lavorare; poi in chat ha detto di averlo tolto e non era vero. Il server non mette mai un'app produttiva o neutra nel
 * programma, chiede prima per una non classificata, e il prompt della chat e' onesto. */
const sorgente = readFileSync(join(__dirname, "dreammapChat.ts"), "utf8");
const dati = {
  appGiorno: [{ pkg: "com.instagram.android", nome: "Instagram", giudizio: "distraente" }],
  appTutte: [
    { pkg: "org.telegram.messenger", nome: "Telegram", giudizio: "produttiva" },
    { pkg: "com.whatsapp", nome: "WhatsApp", giudizio: "neutra" },
    { pkg: "com.reddit.frontpage", nome: "Reddit", giudizio: "non classificata" },
    { pkg: "com.instagram.android", nome: "Instagram", giudizio: "non classificata" },
  ],
};

describe("il programma del rientro: solo app distraenti", () => {
  const app = appDaiDati(dati);
  it("tiene il giudizio dato dall'utente", () => {
    expect(app.get("org.telegram.messenger")?.giudizio).toBe("produttiva");
    expect(app.get("com.instagram.android")?.giudizio).toBe("distraente");
  });
  it("toglie Telegram (produttiva) e WhatsApp (neutra), tiene Instagram", () => {
    const f = filtraAppProgramma(["org.telegram.messenger", "com.whatsapp", "com.instagram.android"], app);
    expect(f.app).toEqual(["com.instagram.android"]);
    expect(f.tolte.map((x) => x.pkg)).toEqual(["org.telegram.messenger", "com.whatsapp"]);
  });
  it("un pacchetto inventato non passa", () => {
    expect(filtraAppProgramma(["com.inventata"], app).app).toEqual([]);
  });
  it("su un'app non classificata prima la domanda, con le categorie", () => {
    const f = filtraAppProgramma(["com.reddit.frontpage"], app);
    expect(f.app).toEqual([]);
    expect(f.chiedere[0].pkg).toBe("com.reddit.frontpage");
    const d = domandaGiudizio(f.chiedere[0]);
    expect(d.tipo).toBe("domanda");
    expect(d.testo).toMatch(/Reddit\* è un'app che ti distrae o che usi per lavorare/);
    expect(d.opzioni.map((o) => o.cat)).toEqual(["distr", "prod", "neutro"]);
    expect(d.classifica.pkg).toBe("com.reddit.frontpage");
  });
  it("la categoria di un'opzione passa solo se e' vera", () => {
    expect(catOpzione("prod")).toBe("prod");
    expect(catOpzione("lavoro")).toBeUndefined();
  });
  it("l'endpoint del rientro usa il filtro, non tutti i pacchetti", () => {
    expect(sorgente).toMatch(/const f = filtraAppProgramma\(p\.app, appNote\);/);
    expect(sorgente).toMatch(/if \(f\.chiedere\.length && turni < 8\) return domandaGiudizio\(f\.chiedere\[0\]\);/);
    expect(sorgente).not.toMatch(/filter\(\(x: string\) => pacchetti\.has\(x\)\)/);
    expect(sorgente).toMatch(/IL GIUDIZIO DELLE APP \(app 0\.9\.395\)/);
  });
});

describe("la chat del Genio: onesta", () => {
  it("niente piu' \"mai non posso\" assoluto", () => {
    expect(sorgente).not.toMatch(/mai " \+ '"non posso"'/);
    expect(sorgente).not.toMatch(/mai \\"non posso aiutarti\\"/);
  });
  it("la regola in tre parti: aiuta, dice cosa non puo' fare con la strada vera, mai inventa", () => {
    expect(sorgente).toMatch(/AIUTI SEMPRE, E SEI ONESTO \(app 0\.9\.395\)/);
    expect(sorgente).toMatch(/Puoi fare così, così e così/);
    expect(sorgente).toMatch(/Questo non posso farlo io, ma puoi fare così/);
    expect(sorgente).toMatch(/ChatGPT, Claude, Claude Code/);
    expect(sorgente).toMatch(/MAI INVENTARE DI AVER FATTO UNA COSA/);
    expect(sorgente).toMatch(/Dici di aver fatto qualcosa SOLO se nello stesso messaggio hai messo il blocco json/);
  });
  it("i programmi che ci sono gia' non li cambia: da' il pulsante che li apre", () => {
    expect(sorgente).toMatch(/I PROGRAMMI CHE CI SONO GIÀ NON LI CAMBI TU/);
    expect(sorgente).toMatch(/\{\\"apri\\": \\"programma\\", \\"nome\\"/);
  });
  it("con la Modalita' severa accesa dice il motivo vero e lo Sblocco di emergenza, con il punto al vecchio te", () => {
    expect(sorgente).toMatch(/LA MODALITÀ SEVERA NON LA SPEGNI TU \(app 0\.9\.291, rifatta nella 0\.9\.395\)/);
    expect(sorgente).toMatch(/costa un punto al vecchio te/);
    expect(sorgente).toMatch(/\{\\"apri\\": \\"emergenza\\"\}/);
    expect(sorgente).toMatch(/DA CONFERMARE nel brief/);
  });
  it("prima di un programma guarda il giudizio dell'app", () => {
    expect(sorgente).toMatch(/PRIMA DI PROPORRE UN PROGRAMMA GUARDA IL GIUDIZIO DELLE APP/);
  });
  it("mai la Modalita' severa abbreviata nelle regole nuove", () => {
    const nuove = sorgente.split("\n").filter((r) => r.includes("0.9.395") && !r.trim().startsWith("/*") && !r.trim().startsWith("*"));
    for (const r of nuove) expect(r).not.toMatch(/\b(la|con la) severa\b/);
  });
});
