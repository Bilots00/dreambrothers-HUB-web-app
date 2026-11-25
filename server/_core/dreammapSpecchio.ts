/*
 * L'IMMAGINE DI SÉ E LA TRAIETTORIA (DreamMap app 0.9.391, BUG-124, Andrea 25/11/2026).
 *
 * Andrea: "nella slide Come ti vedi oggi compare il risultato della lettura, chi sto diventando: ma chi sto diventando è diverso da come
 * mi vedo. Il Genio fa da specchio: non può essere in disaccordo con me; se mi vedo in un modo, me lo mostra. Prima capisce come mi
 * vedo, poi fa le domande su abitudini e azioni, collega ambiente, identità e azione, e trova chi sto diventando".
 *
 * L'app fa il quiz "Come ti vedi" (nove domande sull'immagine di sé, come farebbe Maxwell Maltz; con un sogno d'impresa tre parlano di
 * prezzo, rischio e clienti, come Dan Kennedy) e manda alla lettura l'archetipo e le risposte (immagineDiSe). Qui la regola dello
 * specchio e la distinzione fra immagine di sé e traiettoria, in un posto solo, e la pulizia di quello che arriva dal telefono.
 * Lo controlla dreammapSpecchio.test.ts.
 */
export const REGOLA_SPECCHIO = [
  "L'IMMAGINE DI SÉ E LA TRAIETTORIA SONO DUE COSE DIVERSE (app 0.9.391, Andrea: \"chi sto diventando è diverso da come mi vedo\").",
  "L'immagine di sé è come la persona si vede: il suo archetipo, uscito dal quiz \"Come ti vedi\" (COME SI VEDE, se c'è). Tu le fai da specchio: non sei mai in disaccordo con come si vede, non la correggi, non la giudichi e non la sminuisci. Parti da lì e tieni la sua forza.",
  "La traiettoria è chi sta diventando se continua con le abitudini di oggi: la decidono le risposte sulle abitudini e i dati del telefono, mai l'archetipo. Non usare mai l'archetipo come traiettoria, e non dire mai che la persona \"è\" il profilo della traiettoria: ci sta andando, se non cambia niente.",
  "Chi deve diventare tiene la forza del suo archetipo e cambia solo l'abitudine che la frena. Esempio, per chi si vede come il Custode: \"una persona che ogni giorno protegge un'ora per il suo sogno, con la stessa cura che dà agli altri\".",
].join("\n");

export type ImmagineDiSe = { archetipo: string; frase: string; forza: string; impresa: boolean; risposte: { domanda: string; risposta: string }[] };

const via = (t: unknown, max: number) => String(t ?? "").replace(/\u0000/g, "").replace(/[<>{}`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Quello che l'app manda (b.immagineDiSe), pulito: testi corti, al massimo 12 risposte. null se non c'è un archetipo. */
export function immagineDiSeDa(x: any): ImmagineDiSe | null {
  if (!x || typeof x !== "object") return null;
  const archetipo = via(x.archetipo, 40);
  if (!archetipo) return null;
  const risposte = (Array.isArray(x.risposte) ? x.risposte : []).slice(0, 12)
    .map((r: any) => ({ domanda: via(r?.domanda, 160), risposta: via(r?.risposta, 120) }))
    .filter((r: { domanda: string; risposta: string }) => r.domanda && r.risposta);
  return { archetipo, frase: via(x.frase, 220), forza: via(x.forza, 80), impresa: x.impresa === true, risposte };
}

/** Il pezzo del messaggio per il modello: come si vede, con le sue parole e le risposte al quiz. "" se non c'è. */
export function immagineDiSeTesto(x: ImmagineDiSe | null): string {
  if (!x) return "";
  return "COME SI VEDE (la sua immagine di sé, dal quiz \"Come ti vedi\"): " + x.archetipo + "."
    + (x.frase ? "\nCome lo direbbe lei: \"" + x.frase + "\"" : "")
    + (x.forza ? "\nLa sua forza: " + x.forza + "." : "")
    + (x.impresa ? "\nIl suo sogno è un'impresa: nel quiz ha risposto anche su prezzo, rischio e clienti." : "")
    + (x.risposte.length ? "\nLE SUE RISPOSTE AL QUIZ:\n" + x.risposte.map((r) => "- " + r.domanda + " " + r.risposta).join("\n") : "");
}
