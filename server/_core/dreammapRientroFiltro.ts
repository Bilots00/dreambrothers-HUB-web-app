/* DreamMap app 0.9.395, Andrea (26/11): "il genio nella revisione prima di chiedere di creare un programma o un blocco dovrebbe
 * PRIMA chiedere se un'app e' PRODUTTIVA e chiedere all'utente di catalogarla". In un Rientra in rotta il modello aveva messo
 * Telegram (per lui un'app per lavorare) nel programma "Protezione tempo libero": il server accettava ogni pacchetto che l'app
 * aveva mandato, senza sapere cosa ne pensava l'utente. Adesso ogni app arriva con il suo giudizio (quello del Report, telefono
 * e computer) e qui, senza fidarsi del modello:
 *   - un'app produttiva o neutra non entra MAI nel programma;
 *   - se il modello chiude con un'app non classificata, il server fa prima la domanda ("Telegram per te e' un'app che ti
 *     distrae o che usi per lavorare?"), e la risposta l'app la salva nella classificazione del Report.
 * Funzioni pure: le prova dreammapRientroFiltro.test.ts. */

export type GiudizioApp = "distraente" | "neutra" | "produttiva" | "non classificata";
export type AppConGiudizio = { pkg: string; nome: string; giudizio: GiudizioApp };

function normale(g: unknown): GiudizioApp {
  const s = String(g ?? "").toLowerCase();
  if (s.startsWith("distr")) return "distraente";
  if (s.startsWith("neutr")) return "neutra";
  if (s.startsWith("prod")) return "produttiva";
  return "non classificata";
}

/** Le app mandate dall'app (dati.appGiorno e dati.appTutte), con il loro giudizio. Mai un pacchetto inventato. */
export function appDaiDati(dati: any): Map<string, AppConGiudizio> {
  const m = new Map<string, AppConGiudizio>();
  const d = dati ?? {};
  for (const l of [d.appGiorno, d.appTutte]) {
    for (const a of Array.isArray(l) ? l : []) {
      if (!a || typeof a.pkg !== "string" || !a.pkg) continue;
      const g = normale(a.giudizio);
      const prima = m.get(a.pkg);
      /* se le due liste dicono cose diverse vale quella classificata */
      if (!prima || prima.giudizio === "non classificata") m.set(a.pkg, { pkg: a.pkg, nome: String(a.nome || a.pkg).slice(0, 60), giudizio: g });
    }
  }
  return m;
}

/** Le app che il modello vuole bloccare, divise: { app: solo le distraenti, chiedere: le non classificate, tolte: produttive e neutre }. */
export function filtraAppProgramma(richieste: unknown, app: Map<string, AppConGiudizio>) {
  const out = { app: [] as string[], chiedere: [] as AppConGiudizio[], tolte: [] as AppConGiudizio[] };
  for (const x of (Array.isArray(richieste) ? richieste : []).map(String)) {
    const a = app.get(x);
    if (!a) continue;                                   // pacchetto inventato: fuori
    if (a.giudizio === "distraente") { if (!out.app.includes(x)) out.app.push(x); }
    else if (a.giudizio === "non classificata") { if (!out.chiedere.some((c) => c.pkg === x)) out.chiedere.push(a); }
    else out.tolte.push(a);
  }
  out.app = out.app.slice(0, 6);
  return out;
}

/** La domanda sul giudizio di un'app: le opzioni portano la categoria (cat), che l'app salva nel Report. */
export function domandaGiudizio(a: { pkg: string; nome: string }) {
  return {
    tipo: "domanda" as const,
    testo: "Prima di bloccarla: per te *" + a.nome + "* è un'app che ti distrae o che usi per lavorare?",
    opzioni: [
      { ico: "📵", t: "Mi distrae", cat: "distr" },
      { ico: "💼", t: "La uso per lavorare", cat: "prod" },
      { ico: "⚖️", t: "Né l'una né l'altra", cat: "neutro" },
    ],
    mostraCaduta: false,
    classifica: { pkg: a.pkg, nome: a.nome },
  };
}

/** Le opzioni di una domanda del modello: la categoria passa solo se e' una di quelle vere. */
export function catOpzione(c: unknown): "distr" | "prod" | "neutro" | undefined {
  return c === "distr" || c === "prod" || c === "neutro" ? c : undefined;
}
