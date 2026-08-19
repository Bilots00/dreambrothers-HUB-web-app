/**
 * Creative Director — dalle creatività pubblicitarie per un prodotto approvato.
 *
 * Non è un generatore di frasi a caso: monta in un colpo solo i due ruoli già
 * mappati nel Brain — il **Creative Director** (`areas/creatives/_hub-creatives`,
 * che detta il loop chi → cosa/perché → visual hook → VOC → filtro anti-AI) e il
 * **Copywriter** (`areas/hr-training/ruoli/copywriter`) — e li fa lavorare sullo
 * stesso design con le schede vere davanti, non con un riassunto.
 *
 * La strategia non è un parametro fisso: la scelta della piattaforma, dell'avatar
 * e dell'angle nasce dall'incrocio fra il design, la platform matrix del Brain e
 * il momento dell'anno in cui siamo. Una t-shirt identitaria per Aurora a fine
 * agosto non si spinge come una wall art per Money Game a dicembre.
 */

import { runResearchLLM } from "./research";
import { getBrandContext, leggiBrain } from "./brainClient";

/* ------------------------------------------------------------------ */
/* Forma del risultato                                                 */
/* ------------------------------------------------------------------ */

export type Creativita = {
  /** es. "Reel 9:16", "Statica 1:1", "Carosello 4:5" */
  formato: string;
  /** i primi 3 secondi: è l'unico pezzo che decide se il resto viene visto */
  hook: string;
  /** script scena per scena se è video, direzione visiva se è statica */
  direzione: string;
  primaryText: string;
  headline: string;
  cta: string;
  /** perché questa creatività dovrebbe funzionare su questo avatar */
  razionale: string;
};

export type PacchettoCreativo = {
  generatoIl: string;
  /** avatar scelto: uno solo, mai voci mischiate (regola del Brain) */
  avatar: string;
  piattaforma: string;
  perchePiattaforma: string;
  /** dove siamo nel calendario e cosa cambia di conseguenza */
  momento: string;
  angle: string;
  creativita: Creativita[];
  noteMediaBuyer: string;
  /** schede del Brain effettivamente lette: se è vuoto, ha lavorato col solo DNA */
  fonti: string[];
};

/* ------------------------------------------------------------------ */
/* Le schede che i due ruoli leggono prima di scrivere                 */
/* ------------------------------------------------------------------ */

const SCHEDE_BASE = [
  "areas/creatives/_hub-creatives.md",
  "areas/hr-training/ruoli/copywriter.md",
  "areas/marketing/advertising/strategia-ads.md",
  "areas/copywriting/copy-per-avatar.md",
  "areas/copywriting/banca-hook.md",
  "areas/copywriting/regole-anti-ai.md",
  "areas/marketing/creative-learnings.md",
  "areas/clienti-mercato/recensioni-voc.md",
  "areas/design/template-creativita.md",
];

/** L'avatar dichiarato dal design decide quale scheda-avatar entra nel contesto. */
function schedaAvatar(avatar: string): string | null {
  const a = (avatar || "").toLowerCase();
  if (a.includes("money")) return "areas/business/avatar-money-game.md";
  if (a.includes("aurora")) return "areas/business/avatar-aurora.md";
  if (a.includes("sognatrice") || a.includes("sensibile")) return "areas/business/avatar-sognatrice-sensibile.md";
  return null;
}

/** Il momento dell'anno, in chiaro: il modello non ha una data affidabile da solo. */
function momentoCorrente(): string {
  const ora = new Date();
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const mese = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", month: "2-digit" }).format(ora),
  );
  const stagione =
    mese <= 2 || mese === 12
      ? "inverno — stagione regalo/proposito di inizio anno"
      : mese <= 5
        ? "primavera — rinnovo, 'nuova versione di me'"
        : mese <= 8
          ? "estate — fine stagione, rientro e ripartenza di settembre all'orizzonte"
          : "autunno — rientro, nuova routine, avvicinamento al Q4 e al Black Friday";
  return `${fmt.format(ora)} (${stagione})`;
}

/* ------------------------------------------------------------------ */
/* Generazione                                                         */
/* ------------------------------------------------------------------ */

/** La forma attesa, descritta al modello: il motore free-tier non applica schemi. */
const FORMA_JSON = `{
  "avatar": "l'unico avatar scelto",
  "piattaforma": "la piattaforma ads principale",
  "perchePiattaforma": "perché questa e non le altre, per QUESTO prodotto e QUESTO avatar",
  "momento": "cosa cambia per il periodo dell'anno in cui siamo",
  "angle": "l'angolo di comunicazione",
  "creativita": [
    {
      "formato": "es. Reel 9:16 · Statica 1:1 · Carosello 4:5",
      "hook": "i primi 3 secondi",
      "direzione": "script scena per scena se video, direzione visiva se statica",
      "primaryText": "il testo lungo dell'inserzione",
      "headline": "titolo breve",
      "cta": "call to action",
      "razionale": "perché dovrebbe funzionare su questo avatar"
    }
  ],
  "noteMediaBuyer": "budget di test, pubblico, cosa guardare per capire se funziona"
}`;

/** Estrae il JSON anche quando il modello lo incarta in un blocco markdown. */
function estraiJson(testo: string): string {
  const pulito = testo.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const apre = pulito.indexOf("{");
  const chiude = pulito.lastIndexOf("}");
  return apre >= 0 && chiude > apre ? pulito.slice(apre, chiude + 1) : pulito;
}

export async function generaCreative(input: {
  /** dal design approvato */
  concept: string;
  avatar: string;
  prodotto: string;
  testoDaComporre: string;
  tipo: "apparel" | "wallart";
  /** link al mockup Printify, se il prodotto è già pubblicato */
  mockup?: string | null;
  prezzoDa?: number | null;
}): Promise<PacchettoCreativo> {
  const paths = [...SCHEDE_BASE];
  const avatarPath = schedaAvatar(input.avatar);
  if (avatarPath) paths.push(avatarPath);

  const [brand, schede] = await Promise.all([getBrandContext(), leggiBrain(paths)]);

  const contestoBrain = schede.length
    ? schede.map(s => `### ${s.path}\n${s.testo}`).join("\n\n")
    : "(Brain non raggiungibile: lavora sul solo DNA di brand qui sopra e dichiaralo nelle note.)";

  const prezzo = input.prezzoDa ? `${(input.prezzoDa / 100).toFixed(2)} €` : "non ancora fissato";

  const system = `Sei due ruoli del team DreamBrothers che lavorano insieme sulla stessa creatività:
il CREATIVE DIRECTOR (regia visiva, visual hook, psicologia del consumatore) e il COPYWRITER (le parole).
Segui alla lettera i mansionari e le regole che trovi nelle schede del Brain qui sotto: sono la fonte,
non un suggerimento.

REGOLE NON NEGOZIABILI:
- UN solo avatar per pacchetto. Mai mischiare le voci.
- MAI false claims o promesse magiche: un prodotto è un promemoria identitario, non un miracolo.
- Applica il filtro anti-AI della scheda regole-anti-ai: niente frasi da chatbot, niente em dash,
  niente parole-vetrina. Scrivi come parla il pubblico, con il lessico che trovi nelle schede VOC.
- Le creatività servono per ADS a pagamento (traffico freddo o caldo, dichiaralo), non per organico.
- Scegli UNA piattaforma principale usando la platform matrix del Brain e motiva la scelta con
  il prodotto, l'avatar e il momento dell'anno che ti vengono dati — non con generiche buone pratiche.

DNA DI BRAND
${brand}

SCHEDE DEL BRAIN
${contestoBrain}`;

  const user = `Prodotto appena approvato e pubblicato, da spingere con le ads.

- Concept del design: ${input.concept}
- Avatar dichiarato dal Product Artist: ${input.avatar}
- Tipo prodotto: ${input.tipo === "apparel" ? "capo di abbigliamento" : "wall art (quadro/poster)"}
- Prodotto: ${input.prodotto}
- Testo stampato sul design: ${input.testoDaComporre}
- Prezzo di partenza: ${prezzo}
- Momento in cui stiamo lanciando: ${momentoCorrente()}

Produci il pacchetto creativo: la piattaforma migliore con il perché, l'angle, e 3-4 creatività
pronte da caricare (hook, direzione visiva o script, primary text, headline, CTA, razionale).
Chiudi con le note per il Media Buyer: budget di test, tipo di pubblico, cosa guardare per capire
se sta funzionando.

Rispondi SOLO con un oggetto JSON valido di questa forma, senza testo attorno e senza blocchi
markdown, con 3 o 4 elementi in "creativita":
${FORMA_JSON}`;

  const testo = await runResearchLLM(system, user);
  if (!testo?.trim()) {
    throw new Error("Il Creative Director non ha restituito nulla. Riprova fra qualche secondo.");
  }

  let dati: Omit<PacchettoCreativo, "generatoIl" | "fonti">;
  try {
    dati = JSON.parse(estraiJson(testo));
  } catch {
    throw new Error("Risposta del Creative Director non leggibile (JSON non valido).");
  }
  if (!Array.isArray(dati.creativita) || !dati.creativita.length) {
    throw new Error("Il Creative Director non ha prodotto creatività. Riprova.");
  }

  return {
    ...dati,
    generatoIl: new Date().toISOString(),
    fonti: schede.map(s => s.path),
  };
}
