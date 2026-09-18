/**
 * Chi e' un cliente vero, e chi e' rumore.
 *
 * Il 16 settembre Naomi Rotensen ha chiesto il reso dell'ordine #1263 dal modulo
 * contatti del negozio. Il messaggio non e' comparso da nessuna parte e nessuno
 * l'ha avvisata per due giorni. Tre difetti distinti, tutti mappati qui dentro:
 *
 *  1. la Inbox non distingueva un cliente da una newsletter, quindi anche quando
 *     un messaggio entrava si perdeva fra TikTok Shop, Okendo e Lucky Orange;
 *  2. le mail del modulo contatti arrivano DA mailer@shopify.com, quindi finivano
 *     tutte in un'unica conversazione intestata "Shopify" invece che alla persona
 *     che ha scritto davvero;
 *  3. nessuno mandava niente su Telegram.
 *
 * Questo modulo risolve 1 e 2 ed e' volutamente PURO: niente rete, niente
 * database, cosi' le regole si possono provare una per una.
 *
 * La regola di fondo e' asimmetrica: **nel dubbio si notifica**. Un cliente perso
 * e' costato 129 euro di chargeback e una recensione con scritto "Scam"; una
 * notifica di troppo costa un pollice che scorre. Quindi la lista nera elenca
 * cio' che si sa essere rumore, e tutto il resto passa.
 */

export type MessaggioInCare = {
  /** Canale come lo scrive chi alimenta /api/care/ingest. */
  channel: string;
  /** Indirizzo o numero del mittente. */
  handle: string;
  nome?: string | null;
  testo: string;
  /**
   * Il chiamante ha gia' riconosciuto un modulo contatti e passa il corpo
   * estratto invece del testo originale.
   *
   * Serve perche' dopo l'estrazione il marcatore ("Email:", "Body:") non c'e'
   * piu' nel testo, quindi `estraiDalModuloShopify` qui dentro non lo
   * riconoscerebbe e la precedenza sulla lista nera non scatterebbe. Trovato in
   * produzione il 18/09/2026: la classificazione tornava "mittente umano non in
   * lista nera", cioe' il risultato giusto per il motivo sbagliato.
   */
  daModuloContatti?: boolean;
};

export type Verdetto = {
  cliente: boolean;
  /** Perche', in chiaro: finisce nel log e nella notifica. */
  motivo: string;
};

/* ------------------------------------------------------------------ */
/* Modulo contatti di Shopify                                          */
/* ------------------------------------------------------------------ */

export type ClienteDalModulo = {
  nome: string | null;
  email: string;
  categoria: string | null;
  corpo: string;
};

/**
 * Estrae il cliente vero da una notifica del modulo contatti.
 *
 * Shopify manda una mail da mailer@shopify.com con dentro i campi del forma.
 * Senza questa estrazione la conversazione viene intestata a Shopify e tutti i
 * messaggi di tutti i clienti collassano in un thread solo: e' esattamente il
 * motivo per cui quello di Naomi sarebbe stato invisibile anche se fosse entrato.
 *
 * Ritorna `null` se il testo non e' un modulo contatti, cosi' il chiamante sa
 * che deve lasciare il messaggio com'e'.
 */
export function estraiDalModuloShopify(testo: string): ClienteDalModulo | null {
  if (!testo) return null;
  // Il riconoscimento sta sull'email, non sulla frase introduttiva: quella e'
  // tradotta nella lingua del negozio e cambia senza preavviso.
  const email = testo.match(/^\s*Email:\s*(\S+@\S+?)\s*$/im)?.[1];
  if (!email) return null;
  const haCorpo = /^\s*Body:/im.test(testo);
  const haNome = /^\s*Name:/im.test(testo);
  if (!haCorpo && !haNome) return null;

  const nome = testo.match(/^\s*Name:\s*(.+?)\s*$/im)?.[1] ?? null;
  const categoria = testo.match(/^\s*Category:\s*(.+?)\s*$/im)?.[1] ?? null;
  // Il corpo va fino alla fine: il cliente scrive su piu' righe.
  const corpo = testo.match(/^\s*Body:\s*([\s\S]*)$/im)?.[1]?.trim() ?? "";

  return { nome, email: email.toLowerCase(), categoria, corpo };
}

/* ------------------------------------------------------------------ */
/* Liste                                                               */
/* ------------------------------------------------------------------ */

/** Canali dove dall'altra parte c'e' sempre una persona. */
const CANALI_UMANI = /^(whatsapp|wa|instagram|ig|facebook|fb|messenger)/i;

/** Caselle che non rispondono mai: nessuna persona dietro. */
const MITTENTI_AUTOMATICI =
  /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|bounce|bounces|postmaster|notifications?|newsletter|news|info\.?bot)@/i;

/**
 * Domini che scrivono per lavoro loro, non per comprare da noi.
 *
 * Presi uno per uno dalla Inbox del 18/09/2026, dove su 30 conversazioni erano
 * clienti veri zero. Zendrop c'e' dentro di proposito: e' il fornitore, le sue
 * mail servono ma non sono customer care e non devono svegliare nessuno.
 */
const DOMINI_RUMORE = [
  "shop.tiktok.com",
  "notifications.tiktok.com",
  "ads-service.tiktok.com",
  "tiktok.com",
  "microsoftadvertising.com",
  "judge.me",
  "okendo.io",
  "luckyorange.com",
  "track123.com",
  "vitals.co",
  "section.store",
  "tapita.io",
  "casparcreate.com",
  "dreamstime.com",
  "email.openai.com",
  "openai.com",
  "google.com",
  "backupstatus.idrive.com",
  "idrive.com",
  "zendrop.com",
  "intercom.zendrop.com",
  "klaviyo.com",
  "mailchimp.com",
  "stripe.com",
  "paypal.com",
];

/**
 * Frasi da agenzia che offre servizi. Sono tenute strette di proposito: devono
 * pescare il pitch e non il cliente che si lamenta delle vendite.
 */
const PITCH = [
  /\bi came across\b/i,
  /\badditional orders\b/i,
  /\bconversion (issues|rate) \w+/i,
  /\bincrease your (sales|revenue|conversions)\b/i,
  /\bfree audit\b/i,
  /\bmiglior numero whatsapp\b/i,
  /\bporto \d+[-–]\d+ ordini\b/i,
  /\bdarmi il \d+%\b/i,
];

function dominio(handle: string): string {
  const m = String(handle ?? "").toLowerCase().match(/@([^>\s]+)$/);
  return m ? m[1] : "";
}

/* ------------------------------------------------------------------ */
/* Il giudizio                                                         */
/* ------------------------------------------------------------------ */

/**
 * Decide se questo messaggio merita una notifica.
 *
 * L'ordine delle regole conta: il modulo contatti vince sulla lista nera,
 * perche' arriva da un dominio che nella lista nera c'e' (shopify.com) ma dentro
 * c'e' una persona che aspetta una risposta.
 */
export function classifica(m: MessaggioInCare): Verdetto {
  const handle = String(m.handle ?? "").toLowerCase().trim();
  const testo = String(m.testo ?? "");
  const canale = String(m.channel ?? "").toLowerCase();

  if (CANALI_UMANI.test(canale)) {
    return { cliente: true, motivo: `messaggio diretto su ${canale}` };
  }

  // Prima di ogni esclusione: e' un modulo contatti? Arriva da shopify.com, che
  // e' in lista nera, ma dentro c'e' una persona che aspetta una risposta.
  if (m.daModuloContatti || estraiDalModuloShopify(testo)) {
    return { cliente: true, motivo: "modulo contatti del negozio" };
  }

  if (!handle) {
    return { cliente: true, motivo: "mittente sconosciuto, nel dubbio si avvisa" };
  }

  // Le notifiche che il negozio manda a se stesso (riepiloghi ordini, avvisi).
  if (handle === "info@dreambrothers.it") {
    return { cliente: false, motivo: "notifica automatica del negozio a se stesso" };
  }

  if (MITTENTI_AUTOMATICI.test(handle)) {
    return { cliente: false, motivo: "casella automatica che non riceve risposte" };
  }

  const dom = dominio(handle);
  const rumoroso = DOMINI_RUMORE.find((d) => dom === d || dom.endsWith(`.${d}`));
  if (rumoroso) {
    return { cliente: false, motivo: `dominio di servizio (${rumoroso})` };
  }

  const pitch = PITCH.find((re) => re.test(testo));
  if (pitch) {
    return { cliente: false, motivo: "offerta commerciale non richiesta" };
  }

  return { cliente: true, motivo: "mittente umano non in lista nera" };
}

/* ------------------------------------------------------------------ */
/* Presentazione                                                       */
/* ------------------------------------------------------------------ */

const ETICHETTA_CANALE: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** Ordini citati nel testo: in cima al messaggio, sono la prima cosa da cercare. */
export function ordiniCitati(testo: string): string[] {
  const trovati = String(testo ?? "").match(/#\d{3,6}/g) ?? [];
  // Array.from e non lo spread: il target di questo progetto non fa iterare i Set.
  return Array.from(new Set(trovati));
}

/**
 * Il messaggio che arriva sul telefono. Corto: deve dire chi ha scritto, per
 * quale ordine e le prime righe, senza costringere ad aprire niente.
 */
export function testoNotifica(m: MessaggioInCare & { conversationId?: number }): string {
  const canale = ETICHETTA_CANALE[String(m.channel ?? "").toLowerCase()] ?? m.channel;
  const chi = m.nome && m.nome !== m.handle ? `${m.nome} (${m.handle})` : m.handle;
  const ordini = ordiniCitati(m.testo);

  const estratto = String(m.testo ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  const righe = [
    "💬 <b>Nuovo messaggio cliente</b>",
    `<b>${canale}</b> · ${escapeHtml(chi)}`,
  ];
  if (ordini.length) righe.push(`Ordine: <b>${ordini.join(", ")}</b>`);
  righe.push("", escapeHtml(estratto));
  if (m.conversationId) {
    righe.push("", `Inbox: /care/inbox (conversazione ${m.conversationId})`);
  }
  return righe.join("\n");
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
