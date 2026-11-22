import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { rows } from "./dreammapSocial";
import { whoIs, isIdentity } from "./dreammapRoutes";
import { linguaValida, testoIn } from "./dreammapTraduzioni";

/* DreamMap — IL PATTO CON IL TUO DREAMBROTHER (app 0.9.285, rifatto il 22/11/2026).
 *
 * Andrea: "il contratto di abitudine con il proprio Dreambrother, con un deterrente economico: dare
 * soldi a una persona firmando un contratto con lei".
 *
 * IL GIRO
 *  1. Chi si impegna scrive il patto nell'app (dal contratto di abitudine): l'abitudine, come la
 *     verifica l'app, i giorni, quanto paga per ogni giorno mancato, il tetto del mese, e la
 *     penitenza se non paga il garante.
 *  2. Il garante (il Dreambrother) riceve il codice, firma e scrive come vuole ricevere i soldi
 *     (PayPal, Revolut, Satispay, IBAN). Da li' il patto e' attivo.
 *  3. Ogni giorno il telefono di chi si impegna controlla da solo e manda il verdetto. Un giorno
 *     senza verdetto dopo 24 ore e' "nessun dato", dopo altre 48 ore vale come mancato.
 *  4. Un giorno mancato diventa un DEBITO verso il garante, da pagare entro 48 ore. Il garante lo
 *     sa subito (nell'app e, se l'ha collegato, su Telegram) e i soldi glieli chiede lui.
 *  5. Chi si impegna paga con la sua app (PayPal, Revolut, Satispay, bonifico) e lo segna; il
 *     garante conferma "ricevuti" o dice "non mi sono arrivati".
 *  6. Passate le 48 ore senza pagare: un punto al vecchio te e la penitenza scelta alla firma
 *     (le applica il telefono di chi si impegna, il server segna che e' scattata).
 *
 * I SOLDI NON PASSANO MAI DA DREAMBROTHERS. 22/11/2026: Stripe vieta il trasferimento di denaro tra
 * privati (stripe.com/legal/restricted-businesses), e muovere soldi da una persona all'altra per conto
 * loro e' un servizio di pagamento che richiede l'autorizzazione di Banca d'Italia (PSD2). L'app fa
 * solo da arbitro: decide il giorno, scrive il debito, avvisa il garante, prepara il link di pagamento.
 */

const GIORNO_IT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
export function giornoDi(ms: number): string { return GIORNO_IT.format(new Date(ms)); }
const GRAZIA_MS = 24 * 3600_000;            // dopo la scadenza: un giorno per mandare il verdetto
const NESSUNDATO_VALE_MS = 48 * 3600_000;   // poi "nessun dato" vale come mancato
export const PAGA_ENTRO_MS = 48 * 3600_000; // un giorno mancato si paga al garante entro 48 ore
const RIPROVA_MS = 24 * 3600_000;           // "non mi sono arrivati": almeno un altro giorno per pagare
/* 0.9.302: "contratto" = nessuno sgarro al contratto di abitudine in quel giorno (lo decide il telefono, Contratto.java) */
export const VERIFICHE = ["sessione", "schermo", "passo", "riga", "coppia", "contratto"];

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_patti (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codice VARCHAR(12) NOT NULL,
        autoreSub VARCHAR(64) NOT NULL,
        autoreNome VARCHAR(60) NULL,
        autoreEmail VARCHAR(160) NULL,
        garanteSub VARCHAR(64) NULL,
        garanteNome VARCHAR(60) NULL,
        garanteEmail VARCHAR(160) NULL,
        abitudine TEXT NOT NULL,
        posta INT NOT NULL,
        tetto INT NOT NULL,
        daGiorno VARCHAR(10) NOT NULL,
        aGiorno VARCHAR(10) NOT NULL,
        stato VARCHAR(12) NOT NULL,
        firmatoAt TIMESTAMP NULL,
        stripeCliente VARCHAR(64) NULL,
        stripeMetodo VARCHAR(64) NULL,
        stripeSessione VARCHAR(80) NULL,
        stripeConto VARCHAR(64) NULL,
        createdAt TIMESTAMP NULL,
        UNIQUE KEY (codice),
        INDEX (autoreSub), INDEX (garanteSub), INDEX (stato)
      )`);
      await rows(sql`CREATE TABLE IF NOT EXISTS focuslock_patti_giorni (
        pattoId INT NOT NULL,
        giorno VARCHAR(10) NOT NULL,
        esito VARCHAR(12) NOT NULL,
        dettaglio VARCHAR(300) NULL,
        importo INT NOT NULL DEFAULT 0,
        pagamento VARCHAR(80) NULL,
        statoPagamento VARCHAR(24) NULL,
        at TIMESTAMP NULL,
        PRIMARY KEY (pattoId, giorno)
      )`);
      /* 22/11/2026: il debito verso il garante al posto di Stripe. Le colonne stripe* restano, vuote. */
      for (const c of ["ricevi TEXT NULL", "tgToken VARCHAR(24) NULL", "tgChat VARCHAR(32) NULL", "tgLang VARCHAR(12) NULL"]) {
        try { await rows(sql.raw("ALTER TABLE focuslock_patti ADD COLUMN " + c)); } catch { /* c'e' gia' */ }
      }
      for (const c of ["scadeAt TIMESTAMP NULL", "pagatoAt TIMESTAMP NULL", "ricevutoAt TIMESTAMP NULL", "penitenzaAt TIMESTAMP NULL", "scadutoAvvisatoAt TIMESTAMP NULL"]) {
        try { await rows(sql.raw("ALTER TABLE focuslock_patti_giorni ADD COLUMN " + c)); } catch { /* c'e' gia' */ }
      }
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/* ---------------------------------------------------------------------------------------
   LE REGOLE, senza database (dreammapCompagni.test.ts)
   --------------------------------------------------------------------------------------- */
/* 0.9.302: la destinazione dei soldi. Di serie l'amico che fa da garante; "beneficenza" = un ente scritto da chi si
   impegna, senza garante (il patto e' attivo subito) e senza addebiti finche' non c'e' un modo vero di donare. */
export type Destinazione = { tipo: "amico" | "beneficenza"; ente?: string };
/** La penitenza se non si paga il garante entro 48 ore. Il punto al vecchio te c'e' sempre; il resto lo sceglie chi si impegna. */
export type SeNonPaga = { grigioOre: number; severaOre: number; serie: boolean };
export type Abitudine = { cosa: string; dopoDi?: string; dove?: string; dueMinuti?: string; giorni: boolean[]; entro: string; verifica: { tipo: string; minuti?: number; ore?: number; parole?: string[] }; destinazione?: Destinazione; seNonPaga?: SeNonPaga };
/** I giorni in cui l'abitudine va fatta, da daGiorno a fino (compreso). giorni: 7 valori da lunedi'. */
export function giorniPrevisti(ab: Abitudine, daGiorno: string, fino: string): string[] {
  const out: string[] = [];
  const d = new Date(daGiorno + "T12:00:00Z");
  for (let i = 0; i < 400; i++) {
    const k = d.toISOString().slice(0, 10);
    if (k > fino) break;
    const lun0 = (d.getUTCDay() + 6) % 7;
    if (ab.giorni[lun0]) out.push(k);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/** La scadenza di un giorno, in ms: l'ora "entro" di quel giorno all'ora italiana (circa: +1 o +2). */
export function scadenza(giorno: string, entro: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(entro || "") || ["", "23", "59"];
  const base = Date.parse(giorno + "T" + String(m[1]).padStart(2, "0") + ":" + m[2] + ":00Z");
  /* l'ora italiana: si prova +1 e +2 e si tiene quella che, riletta a Roma, da' lo stesso giorno e la stessa ora */
  for (const off of [1, 2]) {
    const t = base - off * 3600_000;
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    if (s === String(m[1]).padStart(2, "0") + ":" + m[2] && giornoDi(t) === giorno) return t;
  }
  return base - 3600_000;
}
/** Quanto si paga per un giorno mancato, senza superare il tetto del mese (centesimi). */
export function importoGiorno(posta: number, tetto: number, giaNelMese: number): number {
  return Math.max(0, Math.min(posta, tetto - giaNelMese));
}
export function seNonPagaValido(x: any): SeNonPaga {
  const n = (v: any, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  return { grigioOre: n(x?.grigioOre, 72), severaOre: n(x?.severaOre, 24), serie: !!x?.serie };
}
export function abitudineValida(x: any): Abitudine | null {
  if (!x || typeof x !== "object") return null;
  const cosa = String(x.cosa || "").trim().slice(0, 160);
  const giorni = Array.isArray(x.giorni) && x.giorni.length === 7 ? x.giorni.map((g: any) => !!g) : null;
  const tipo = String(x.verifica?.tipo || "");
  if (!cosa || !giorni || !giorni.some(Boolean) || !VERIFICHE.includes(tipo)) return null;
  const entro = /^\d{1,2}:\d{2}$/.test(String(x.entro || "")) ? String(x.entro) : "23:59";
  const ente = String(x.destinazione?.ente || "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const destinazione: Destinazione | undefined = x.destinazione?.tipo === "beneficenza" ? (ente ? { tipo: "beneficenza", ente } : undefined) : undefined;
  if (x.destinazione?.tipo === "beneficenza" && !destinazione) return null;
  return {
    cosa, giorni, entro, ...(destinazione ? { destinazione } : {}), seNonPaga: seNonPagaValido(x.seNonPaga),
    dopoDi: String(x.dopoDi || "").trim().slice(0, 120), dove: String(x.dove || "").trim().slice(0, 80), dueMinuti: String(x.dueMinuti || "").trim().slice(0, 120),
    verifica: { tipo, minuti: Math.max(0, Math.min(600, Number(x.verifica?.minuti) || 0)), ore: Math.max(0, Math.min(24, Number(x.verifica?.ore) || 0)),
      parole: (Array.isArray(x.verifica?.parole) ? x.verifica.parole : []).map((p: any) => String(p || "").trim().toLowerCase()).filter(Boolean).slice(0, 5) },
  };
}

/* ---------------------------------------------------------------------------------------
   COME IL GARANTE VUOLE RICEVERE I SOLDI, e il link che prepara il pagamento
   --------------------------------------------------------------------------------------- */
export type Ricevi = { paypal?: string; revolut?: string; satispay?: string; iban?: string; intestatario?: string };
/** Pulisce quello che scrive il garante. Torna null se non c'e' nemmeno un modo per pagarlo. */
export function riceviValido(x: any): Ricevi | null {
  if (!x || typeof x !== "object") return null;
  const nome = (v: any) => String(v || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(paypal\.me|revolut\.me)\//i, "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
  const tel = String(x.satispay || "").replace(/[^\d+]/g, "").slice(0, 16);
  const iban = String(x.iban || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 34);
  const out: Ricevi = {};
  if (nome(x.paypal)) out.paypal = nome(x.paypal);
  if (nome(x.revolut)) out.revolut = nome(x.revolut);
  if (tel.replace("+", "").length >= 8) out.satispay = tel;
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) { out.iban = iban; out.intestatario = String(x.intestatario || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 70); }
  return Object.keys(out).length ? out : null;
}
/** Il link PayPal.me con la cifra gia' scritta (paypal.com: "PayPal.Me/nome/25AUD" chiede 25 dollari australiani). */
export function linkPaypal(nome: string, centesimi: number): string {
  const e = (Math.max(0, centesimi) / 100).toFixed(2).replace(/\.00$/, "");
  return "https://paypal.me/" + encodeURIComponent(nome) + "/" + e + "EUR";
}

/** A che punto e' il debito di un giorno mancato, visto adesso. */
export type StatoDebito = "da_pagare" | "scaduto" | "pagato" | "ricevuto" | null;
export function statoDebito(g: { esito: string; importo: number; statoPagamento?: string | null; scadeAt?: number | null }, adesso: number): StatoDebito {
  if (g.esito !== "mancato" || !(Number(g.importo) > 0)) return null;
  const s = String(g.statoPagamento || "");
  if (s === "ricevuto") return "ricevuto";
  if (s === "pagato") return "pagato";
  if (s !== "da_pagare") return null;
  return g.scadeAt && adesso > g.scadeAt ? "scaduto" : "da_pagare";
}
const ms = (t: any): number | null => (t ? new Date(t).getTime() : null);

export function perBeneficenza(p: any): boolean {
  try { return JSON.parse(String(p?.abitudine || "{}"))?.destinazione?.tipo === "beneficenza"; } catch { return false; }
}
/** Lo stato iniziale di un giorno mancato: verso un ente resta da donare, verso un amico e' un debito da pagare. */
function statoMancato(p: any, importo: number): string {
  if (importo <= 0) return Number(p.posta) > 0 ? "tetto" : "niente";
  return perBeneficenza(p) ? "da_donare" : "da_pagare";
}

/* ---------------------------------------------------------------------------------------
   L'AVVISO AL GARANTE SU TELEGRAM (facoltativo, un bot solo per il patto, che si chiama DreamMap)
   Basta una variabile su Railway: PATTI_TELEGRAM_TOKEN = il token che da' BotFather. All'avvio il server
   chiede a Telegram il nome del bot (getMe), si registra da solo il webhook (setWebhook) con una parola
   segreta ricavata dal token, e scrive la descrizione del bot in ogni lingua (setMyDescription). Senza
   token, l'avviso resta nell'app. L'API dei bot e' gratuita fino a circa 30 messaggi al secondo
   (core.telegram.org/bots/faq).
   22/11/2026, Andrea: "la maggior parte degli utenti sara' fuori dall'Italia": il bot si chiama solo DreamMap
   e scrive nella lingua di Telegram di chi riceve (language_code di /start), in inglese se non la conosce.
   --------------------------------------------------------------------------------------- */
/* le lingue in cui il bot scrive la sua descrizione all'avvio; i messaggi invece vanno in QUALSIASI lingua */
export const LINGUE_DESCRIZIONE = ["en", "it", "es", "pt", "fr", "de", "ru", "uk", "ja", "zh", "ko", "ar", "hi", "tr", "pl", "nl", "sv", "id"];
type ChiaveTg = "mancato" | "mancatoParola" | "scaduto" | "pagato" | "benvenuto" | "linkScaduto" | "collegato" | "amico" | "descrizione" | "breve";
/** Cifra e giorno scritti come li scrive chi legge (Intl), per i segnaposto {euro} e {data}. */
export function formatiTg(lingua: string, v: { giorno?: string; centesimi?: number }): { data: string; euro: string } {
  const loc = linguaValida(lingua) || "en";
  let data = "", euro = "";
  try { data = v.giorno ? new Date(v.giorno + "T12:00:00Z").toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" }) : ""; } catch { data = v.giorno || ""; }
  const c = Number(v.centesimi || 0);
  try { euro = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(c / 100); } catch { euro = (c / 100) + " EUR"; }
  return { data, euro };
}
/** Un messaggio del bot nella lingua di chi riceve (tradotto una volta da dreammapTraduzioni). */
export async function testoTg(lingua: string, chiave: ChiaveTg, v: { chi?: string; giorno?: string; centesimi?: number } = {}): Promise<string> {
  const l = linguaValida(lingua) || "en";
  const chi = v.chi || await testoIn("telegram", l, "amico");
  return testoIn("telegram", l, chiave, { chi, ...formatiTg(l, v) });
}

const TG = { bot: "", segreto: "" };
function telegramAcceso(): boolean { return !!(process.env.PATTI_TELEGRAM_TOKEN && TG.bot && TG.segreto); }
async function tgApi(metodo: string, corpo: any): Promise<any> {
  const t = process.env.PATTI_TELEGRAM_TOKEN; if (!t) return null;
  return (await fetch(`https://api.telegram.org/bot${t}/${metodo}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })).json();
}
async function telegramPrepara(): Promise<void> {
  const t = process.env.PATTI_TELEGRAM_TOKEN; if (!t) return;
  try {
    const me: any = await tgApi("getMe", {});
    if (!me?.ok || !me.result?.username) return;
    const segreto = createHash("sha256").update("patti-webhook:" + t).digest("hex").slice(0, 48);
    const url = String(process.env.PUBLIC_BASE_URL || "https://meta-ai-media-buyer-production.up.railway.app").replace(/\/+$/, "") + "/api/focuslock/patti/telegram-webhook";
    const w: any = await tgApi("setWebhook", { url, secret_token: segreto, allowed_updates: ["message"] });
    if (!w?.ok) return;
    TG.bot = String(me.result.username); TG.segreto = segreto;
    /* la descrizione del bot nella lingua di chi lo apre; senza language_code (l'inglese) vale per tutte le altre */
    for (const l of LINGUE_DESCRIZIONE) {
      const lc = l === "en" ? undefined : l;
      try {
        await tgApi("setMyDescription", { description: await testoIn("telegram", l, "descrizione"), ...(lc ? { language_code: lc } : {}) });
        await tgApi("setMyShortDescription", { short_description: await testoIn("telegram", l, "breve"), ...(lc ? { language_code: lc } : {}) });
      } catch { /* la prossima volta */ }
    }
  } catch { /* si riprova al prossimo avvio */ }
}
async function telegram(chat: string, testo: string): Promise<void> {
  if (!chat) return;
  try { await tgApi("sendMessage", { chat_id: chat, text: testo, disable_web_page_preview: true }); } catch { /* l'avviso nell'app resta comunque */ }
}
async function avvisaGarante(p: any, chiave: ChiaveTg, v: { giorno?: string; centesimi?: number } = {}) {
  if (p?.tgChat) await telegram(String(p.tgChat), await testoTg(String(p.tgLang || "en"), chiave, { chi: p.autoreNome || "", ...v }));
}

/* ---------------------------------------------------------------------------------------
   IL CONTROLLO DEL SERVER: i giorni senza verdetto e i debiti scaduti
   --------------------------------------------------------------------------------------- */
async function giaNelMese(pattoId: number, giorno: string): Promise<number> {
  const r = await rows(sql`SELECT COALESCE(SUM(importo), 0) AS t FROM focuslock_patti_giorni WHERE pattoId = ${pattoId} AND giorno LIKE ${giorno.slice(0, 7) + "%"} AND giorno <> ${giorno}`);
  return Number(r[0]?.t || 0);
}
/** Un giorno appena diventato mancato: il debito con la sua scadenza, e l'avviso al garante. */
async function segnaMancato(p: any, g: string, dettaglio: string | null, nuovo: boolean) {
  const imp = importoGiorno(Number(p.posta), Number(p.tetto), await giaNelMese(Number(p.id), g));
  const st = statoMancato(p, imp);
  const scade = st === "da_pagare" ? new Date(Date.now() + PAGA_ENTRO_MS) : null;
  if (nuovo) {
    await rows(sql`INSERT INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, statoPagamento, scadeAt, at) VALUES (${p.id}, ${g}, 'mancato', ${dettaglio}, ${imp}, ${st}, ${scade}, NOW())
      ON DUPLICATE KEY UPDATE esito = 'mancato', dettaglio = VALUES(dettaglio), importo = VALUES(importo), statoPagamento = VALUES(statoPagamento), scadeAt = VALUES(scadeAt), at = NOW()`);
  } else {
    await rows(sql`UPDATE focuslock_patti_giorni SET esito = 'mancato', importo = ${imp}, statoPagamento = ${st}, scadeAt = ${scade}, at = NOW() WHERE pattoId = ${p.id} AND giorno = ${g} AND esito = 'nessundato'`);
  }
  if (!perBeneficenza(p)) {
    const chi = p.autoreNome || "Il tuo amico";
    await avvisaGarante(p, imp > 0 ? "mancato" : "mancatoParola", { giorno: g, centesimi: imp });
  }
  return { importo: imp, statoPagamento: st };
}
export async function controllaPatti(adesso = Date.now()): Promise<number> {
  await ensureTables();
  const attivi = await rows(sql`SELECT * FROM focuslock_patti WHERE stato IN ('attivo', 'finito', 'sciolto') AND aGiorno >= ${giornoDi(adesso - 60 * 86400_000)} LIMIT 500`);
  let fatti = 0;
  for (const p of attivi) {
    let ab: Abitudine | null = null; try { ab = JSON.parse(p.abitudine); } catch { ab = null; }
    if (!ab) continue;
    const scritti = await rows(sql`SELECT giorno, esito, importo, statoPagamento, scadeAt, scadutoAvvisatoAt FROM focuslock_patti_giorni WHERE pattoId = ${p.id}`);
    /* i debiti scaduti: il garante lo sa anche se il telefono di chi si impegna resta spento (vale anche a patto finito o sciolto) */
    for (const s of scritti) {
      if (statoDebito({ ...s, scadeAt: ms(s.scadeAt) }, adesso) !== "scaduto" || s.scadutoAvvisatoAt) continue;
      await rows(sql`UPDATE focuslock_patti_giorni SET scadutoAvvisatoAt = NOW() WHERE pattoId = ${p.id} AND giorno = ${s.giorno} AND scadutoAvvisatoAt IS NULL`);
      await avvisaGarante(p, "scaduto", { giorno: String(s.giorno), centesimi: Number(s.importo) });
      fatti++;
    }
    if (p.stato !== "attivo") continue;
    const oggi = giornoDi(adesso);
    const fino = String(p.aGiorno) < oggi ? String(p.aGiorno) : oggi;
    const per = new Map(scritti.map((s: any) => [String(s.giorno), s]));
    for (const g of giorniPrevisti(ab, String(p.daGiorno), fino)) {
      const s: any = per.get(g);
      const sc = scadenza(g, ab.entro);
      if (!s) {
        if (adesso - sc < GRAZIA_MS) continue;
        await rows(sql`INSERT IGNORE INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, at) VALUES (${p.id}, ${g}, 'nessundato', 'Nessun dato dal telefono entro un giorno', 0, NOW())`);
        fatti++;
        continue;
      }
      /* "nessun dato" che resta tale per altre 48 ore vale come mancato */
      if (s.esito === "nessundato" && adesso - sc >= GRAZIA_MS + NESSUNDATO_VALE_MS) {
        await segnaMancato(p, g, "Nessun dato dal telefono per tre giorni", false);
        fatti++;
        continue;
      }
      /* i giorni mancati scritti quando c'era Stripe (da_collegare, manca_carta, manca_conto, errore): diventano debiti con 48 ore da adesso */
      if (s.esito === "mancato" && Number(s.importo) > 0 && !perBeneficenza(p) && !["da_pagare", "pagato", "ricevuto", "inviato"].includes(String(s.statoPagamento || ""))) {
        await rows(sql`UPDATE focuslock_patti_giorni SET statoPagamento = 'da_pagare', scadeAt = ${new Date(adesso + PAGA_ENTRO_MS)} WHERE pattoId = ${p.id} AND giorno = ${g}`);
        fatti++;
      }
    }
    if (String(p.aGiorno) < giornoDi(adesso - GRAZIA_MS - NESSUNDATO_VALE_MS)) await rows(sql`UPDATE focuslock_patti SET stato = 'finito' WHERE id = ${p.id} AND stato = 'attivo'`);
  }
  return fatti;
}

/* ---------------------------------------------------------------------------------------
   CHI SEI (il tesserino di Google, ricordato dieci minuti)
   --------------------------------------------------------------------------------------- */
const TESSERE = new Map<string, { sub: string; email: string | null; name: string | null; at: number }>();
async function chi(req: Request, res: Response) {
  const h = String(req.headers["authorization"] || "");
  const k = createHash("sha256").update(h).digest("hex");
  const c = TESSERE.get(k);
  if (c && Date.now() - c.at < 10 * 60_000) return c;
  const w = await whoIs(req);
  if (!isIdentity(w)) { res.status((w as any).status || 401).json({ error: (w as any).error || "unauthorized" }); return null; }
  const v = { sub: w.sub, email: w.email, name: w.name, at: Date.now() };
  TESSERE.set(k, v);
  if (TESSERE.size > 2000) { const via: string[] = []; TESSERE.forEach((y, x) => { if (Date.now() - y.at > 10 * 60_000) via.push(x); }); via.forEach((x) => TESSERE.delete(x)); }
  return v;
}
const pulisci = (t: unknown, n: number) => String(t ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const giornoOk = (g: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(g || ""));

async function vistaPatto(p: any, sub: string) {
  const giorni = await rows(sql`SELECT giorno, esito, dettaglio, importo, statoPagamento, scadeAt, pagatoAt, ricevutoAt, penitenzaAt FROM focuslock_patti_giorni WHERE pattoId = ${p.id} ORDER BY giorno DESC LIMIT 120`);
  let ab: any = null; try { ab = JSON.parse(p.abitudine); } catch { ab = null; }
  let ricevi: Ricevi | null = null; try { ricevi = p.ricevi ? JSON.parse(p.ricevi) : null; } catch { ricevi = null; }
  const adesso = Date.now();
  const lista = giorni.map((g: any) => {
    const debito = statoDebito({ ...g, scadeAt: ms(g.scadeAt) }, adesso);
    return { giorno: g.giorno, esito: g.esito, dettaglio: g.dettaglio || "", importo: Number(g.importo || 0), statoPagamento: g.statoPagamento || null,
      debito, scadeAt: ms(g.scadeAt), pagatoAt: ms(g.pagatoAt), ricevutoAt: ms(g.ricevutoAt), penitenzaAt: ms(g.penitenzaAt),
      paypal: debito && debito !== "ricevuto" && ricevi?.paypal ? linkPaypal(ricevi.paypal, Number(g.importo || 0)) : null };
  });
  const somma = (f: (g: any) => boolean) => lista.filter(f).reduce((a: number, g: any) => a + g.importo, 0);
  const garante = p.garanteSub === sub;
  return {
    id: Number(p.id), codice: p.codice, ruolo: p.autoreSub === sub ? "autore" : "garante",
    autore: p.autoreNome || "Chi si impegna", garante: p.garanteNome || null, firmato: !!p.garanteSub,
    abitudine: ab, posta: Number(p.posta), tetto: Number(p.tetto), daGiorno: p.daGiorno, aGiorno: p.aGiorno, stato: p.stato,
    destinazione: ab?.destinazione?.tipo === "beneficenza" ? { tipo: "beneficenza", ente: String(ab.destinazione.ente || "") } : { tipo: "amico" },
    seNonPaga: seNonPagaValido(ab?.seNonPaga),
    /* come pagare il garante: lo vedono lui e chi gli deve i soldi */
    ricevi, telegram: garante ? { acceso: telegramAcceso(), collegato: !!p.tgChat } : undefined,
    /* le app vecchie mostravano "Collega la carta" con pagamenti accesi: restano spenti per sempre */
    pagamenti: { acceso: false, carta: false, conto: false },
    giorni: lista,
    totali: {
      mancati: lista.filter((g: any) => g.esito === "mancato").length, rispettati: lista.filter((g: any) => g.esito === "rispettato").length,
      inviati: somma((g) => g.debito === "ricevuto"), dovuti: somma((g) => g.esito === "mancato"),
      daPagare: somma((g) => g.debito === "da_pagare" || g.debito === "scaduto"), dichiarati: somma((g) => g.debito === "pagato"),
    },
  };
}

/** Il patto e il giorno, controllando chi chiede: l'autore o il garante. */
async function pattoGiorno(id: unknown, giorno: unknown, sub: string, ruolo: "autore" | "garante") {
  if (!giornoOk(giorno)) return null;
  const p = ruolo === "autore"
    ? await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(id)} AND autoreSub = ${sub} LIMIT 1`)
    : await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(id)} AND garanteSub = ${sub} LIMIT 1`);
  if (!p.length) return null;
  const g = await rows(sql`SELECT * FROM focuslock_patti_giorni WHERE pattoId = ${p[0].id} AND giorno = ${String(giorno)} LIMIT 1`);
  if (!g.length) return null;
  return { p: p[0], g: g[0], debito: statoDebito({ ...g[0], scadeAt: ms(g[0].scadeAt) }, Date.now()) };
}

export function registerDreamMapPattiRoutes(app: Express) {
  /* il bot DreamMap: il nome, il webhook e le descrizioni si sistemano da soli */
  telegramPrepara().catch(() => { /* senza Telegram l'avviso resta nell'app */ });
  /* il controllo del server: ogni venti minuti, i giorni senza verdetto e i debiti scaduti */
  setInterval(() => { controllaPatti().catch(() => { /* il prossimo giro ci riprova */ }); }, 20 * 60_000);

  /* un patto nuovo: { abitudine, posta (euro), tetto (euro al mese), durataGiorni, garanteNome, nome }
     0.9.302: con abitudine.destinazione = { tipo: "beneficenza", ente } non c'e' garante: il patto e' attivo da domani */
  app.post("/api/focuslock/patti", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const ab = abitudineValida(b.abitudine);
    if (!ab) { res.status(400).json({ error: "abitudine non valida: serve cosa, almeno un giorno e come la verifica l'app" }); return; }
    /* app 0.9.337: il contratto si fa sempre con un garante, e i soldi possono essere zero ("basta la parola") */
    const pe = Number.isFinite(Number(b.posta)) ? Number(b.posta) : 5;
    const posta = Math.round(Math.max(0, Math.min(100, pe)) * 100);
    const tetto = Math.round(Math.max(pe, Math.min(500, Number.isFinite(Number(b.tetto)) ? Number(b.tetto) : 50)) * 100);
    const durata = Math.max(7, Math.min(180, Math.round(Number(b.durataGiorni) || 30)));
    const da = new Date(Date.now() + 86400_000);       // si comincia domani: oggi si firma
    const daGiorno = giornoDi(da.getTime()), aGiorno = giornoDi(da.getTime() + (durata - 1) * 86400_000);
    try {
      await ensureTables();
      const codice = randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() + String(Date.now() % 100).padStart(2, "0");
      const benef = ab.destinazione?.tipo === "beneficenza";
      await rows(sql`INSERT INTO focuslock_patti (codice, autoreSub, autoreNome, autoreEmail, garanteNome, abitudine, posta, tetto, daGiorno, aGiorno, stato, createdAt)
        VALUES (${codice}, ${who.sub}, ${pulisci(b.nome || who.name || "", 60) || null}, ${who.email}, ${benef ? pulisci(ab.destinazione?.ente, 60) : (pulisci(b.garanteNome, 60) || null)}, ${JSON.stringify(ab)}, ${posta}, ${tetto}, ${daGiorno}, ${aGiorno}, ${benef ? "attivo" : "attesa"}, NOW())`);
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${codice} LIMIT 1`);
      res.json({ patto: await vistaPatto(p[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* i miei patti: quelli in cui mi impegno e quelli in cui faccio da garante */
  app.get("/api/focuslock/patti", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const l = await rows(sql`SELECT * FROM focuslock_patti WHERE (autoreSub = ${who.sub} OR garanteSub = ${who.sub}) AND stato <> 'annullato' ORDER BY id DESC LIMIT 30`);
      const out = [];
      for (const p of l) out.push(await vistaPatto(p, who.sub));
      res.json({ patti: out, pagamenti: false });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante legge il patto prima di firmarlo */
  app.get("/api/focuslock/patti/codice/:codice", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${String(req.params.codice || "").toUpperCase().slice(0, 12)} LIMIT 1`);
      if (!p.length || p[0].stato === "annullato") { res.status(404).json({ error: "patto non trovato" }); return; }
      if (p[0].autoreSub === who.sub) { res.status(409).json({ error: "questo e' il tuo patto: il garante deve essere un'altra persona" }); return; }
      if (perBeneficenza(p[0])) { res.status(404).json({ error: "patto non trovato" }); return; }
      res.json({ patto: await vistaPatto(p[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante firma: { codice, nome, ricevi }. Da li' il patto e' attivo. Se ci sono soldi, deve dire come riceverli. */
  app.post("/api/focuslock/patti/firma", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE codice = ${String(b.codice || "").toUpperCase().slice(0, 12)} LIMIT 1`);
      if (!p.length || p[0].stato !== "attesa" || perBeneficenza(p[0])) { res.status(404).json({ error: "patto non trovato o gia' firmato" }); return; }
      if (p[0].autoreSub === who.sub) { res.status(409).json({ error: "il garante deve essere un'altra persona" }); return; }
      const ricevi = riceviValido(b.ricevi);
      if (Number(p[0].posta) > 0 && !ricevi) { res.status(400).json({ error: "scrivi almeno un modo per ricevere i soldi: PayPal, Revolut, Satispay o IBAN" }); return; }
      await rows(sql`UPDATE focuslock_patti SET garanteSub = ${who.sub}, garanteNome = ${pulisci(b.nome || who.name || p[0].garanteNome || "", 60) || null}, garanteEmail = ${who.email}, ricevi = ${ricevi ? JSON.stringify(ricevi) : null}, stato = 'attivo', firmatoAt = NOW() WHERE id = ${p[0].id} AND stato = 'attesa'`);
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${p[0].id} LIMIT 1`);
      res.json({ patto: await vistaPatto(q[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante cambia come vuole ricevere i soldi: { id, ricevi } */
  app.post("/api/focuslock/patti/ricevi", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const ricevi = riceviValido(b.ricevi);
    if (!ricevi) { res.status(400).json({ error: "scrivi almeno un modo per ricevere i soldi: PayPal, Revolut, Satispay o IBAN" }); return; }
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(b.id)} AND garanteSub = ${who.sub} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      await rows(sql`UPDATE focuslock_patti SET ricevi = ${JSON.stringify(ricevi)} WHERE id = ${p[0].id}`);
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${p[0].id} LIMIT 1`);
      res.json({ patto: await vistaPatto(q[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il verdetto di un giorno, dal telefono di chi si impegna: { id, giorno, esito, dettaglio } */
  app.post("/api/focuslock/patti/giorno", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const b = req.body || {};
    const esito = b.esito === "rispettato" ? "rispettato" : b.esito === "mancato" ? "mancato" : "";
    if (!esito || !giornoOk(b.giorno)) { res.status(400).json({ error: "verdetto non valido" }); return; }
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(b.id)} AND autoreSub = ${who.sub} AND stato = 'attivo' LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non attivo" }); return; }
      const ab: Abitudine = JSON.parse(p[0].abitudine);
      const g = String(b.giorno);
      if (!giorniPrevisti(ab, String(p[0].daGiorno), String(p[0].aGiorno)).includes(g)) { res.status(400).json({ error: "quel giorno non e' nel patto" }); return; }
      if (giornoDi(Date.now()) < g) { res.status(400).json({ error: "quel giorno non e' ancora arrivato" }); return; }
      const c = await rows(sql`SELECT esito FROM focuslock_patti_giorni WHERE pattoId = ${p[0].id} AND giorno = ${g} LIMIT 1`);
      /* il primo verdetto vale; "nessun dato" si corregge se il telefono arriva tardi */
      if (c.length && c[0].esito !== "nessundato") { res.json({ ok: true, gia: c[0].esito }); return; }
      const dett = pulisci(b.dettaglio, 300) || null;
      if (esito === "rispettato") {
        await rows(sql`INSERT INTO focuslock_patti_giorni (pattoId, giorno, esito, dettaglio, importo, at) VALUES (${p[0].id}, ${g}, 'rispettato', ${dett}, 0, NOW())
          ON DUPLICATE KEY UPDATE esito = 'rispettato', dettaglio = VALUES(dettaglio), at = NOW()`);
        res.json({ ok: true, esito });
        return;
      }
      const m = await segnaMancato(p[0], g, dett, true);
      res.json({ ok: true, esito, importo: m.importo, statoPagamento: m.statoPagamento });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* chi si impegna dice di aver pagato: { id, giorno }. Ferma la scadenza finche' il garante non dice il contrario. */
  app.post("/api/focuslock/patti/pagato", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const x = await pattoGiorno(req.body?.id, req.body?.giorno, who.sub, "autore");
      if (!x || !x.debito) { res.status(404).json({ error: "nessun debito per quel giorno" }); return; }
      if (x.debito === "da_pagare" || x.debito === "scaduto") {
        await rows(sql`UPDATE focuslock_patti_giorni SET statoPagamento = 'pagato', pagatoAt = NOW() WHERE pattoId = ${x.p.id} AND giorno = ${x.g.giorno} AND statoPagamento = 'da_pagare'`);
        await avvisaGarante(x.p, "pagato", { giorno: String(x.g.giorno), centesimi: Number(x.g.importo) });
      }
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${x.p.id} LIMIT 1`);
      res.json({ patto: await vistaPatto(q[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante conferma: { id, giorno, arrivati: true | false }. "Non mi sono arrivati" riapre il debito per almeno un altro giorno. */
  app.post("/api/focuslock/patti/ricevuto", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const x = await pattoGiorno(req.body?.id, req.body?.giorno, who.sub, "garante");
      if (!x || !x.debito) { res.status(404).json({ error: "nessun debito per quel giorno" }); return; }
      if (req.body?.arrivati === false) {
        if (x.debito === "pagato") {
          const scade = new Date(Math.max(ms(x.g.scadeAt) || 0, Date.now() + RIPROVA_MS));
          await rows(sql`UPDATE focuslock_patti_giorni SET statoPagamento = 'da_pagare', pagatoAt = NULL, scadeAt = ${scade} WHERE pattoId = ${x.p.id} AND giorno = ${x.g.giorno} AND statoPagamento = 'pagato'`);
        }
      } else if (x.debito !== "ricevuto") {
        await rows(sql`UPDATE focuslock_patti_giorni SET statoPagamento = 'ricevuto', ricevutoAt = NOW() WHERE pattoId = ${x.p.id} AND giorno = ${x.g.giorno}`);
      }
      const q = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${x.p.id} LIMIT 1`);
      res.json({ patto: await vistaPatto(q[0], who.sub) });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il telefono di chi si impegna ha applicato la penitenza di un debito scaduto: { id, giorno }. Una volta sola. */
  app.post("/api/focuslock/patti/penitenza", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    try {
      await ensureTables();
      const x = await pattoGiorno(req.body?.id, req.body?.giorno, who.sub, "autore");
      if (!x || x.debito !== "scaduto") { res.status(409).json({ error: "quel debito non e' scaduto" }); return; }
      if (x.g.penitenzaAt) { res.json({ ok: true, gia: true }); return; }
      await rows(sql`UPDATE focuslock_patti_giorni SET penitenzaAt = NOW() WHERE pattoId = ${x.p.id} AND giorno = ${x.g.giorno} AND penitenzaAt IS NULL`);
      res.json({ ok: true, gia: false });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il garante collega Telegram: { id } -> il link al bot. Il codice e' suo, non quello del patto: chi si impegna non puo' mettersi al suo posto. */
  app.post("/api/focuslock/patti/telegram", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    if (!telegramAcceso()) { res.status(503).json({ error: "gli avvisi su Telegram non sono ancora accesi" }); return; }
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${Number(req.body?.id)} AND garanteSub = ${who.sub} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      let tok = String(p[0].tgToken || "");
      if (!tok) { tok = randomBytes(12).toString("hex").slice(0, 20); await rows(sql`UPDATE focuslock_patti SET tgToken = ${tok} WHERE id = ${p[0].id}`); }
      res.json({ url: "https://t.me/" + TG.bot + "?start=" + tok });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* il webhook del bot: "/start <codice del garante>" lega la chat al patto */
  app.post("/api/focuslock/patti/telegram-webhook", async (req: Request, res: Response) => {
    if (!telegramAcceso() || req.headers["x-telegram-bot-api-secret-token"] !== TG.segreto) { res.status(403).end(); return; }
    res.json({ ok: true });
    try {
      const m = req.body?.message; const chat = m?.chat?.id; const t = String(m?.text || ""); const lingua = linguaValida(m?.from?.language_code) || "en";
      const tok = (/^\/start\s+([a-f0-9]{20})$/.exec(t.trim()) || [])[1];
      if (!chat) return;
      if (!tok) { await telegram(String(chat), await testoTg(lingua, "benvenuto")); return; }
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE tgToken = ${tok} LIMIT 1`);
      if (!p.length) { await telegram(String(chat), await testoTg(lingua, "linkScaduto")); return; }
      await rows(sql`UPDATE focuslock_patti SET tgChat = ${String(chat)}, tgLang = ${lingua} WHERE id = ${p[0].id}`);
      await telegram(String(chat), await testoTg(lingua, "collegato", { chi: p[0].autoreNome || "" }));
    } catch { /* Telegram ha gia' avuto la sua risposta */ }
  });

  /* il garante scioglie il patto (chi si impegna non puo' farlo da solo: e' il senso del patto). I debiti gia' scritti restano. */
  app.post("/api/focuslock/patti/sciogli", async (req: Request, res: Response) => {
    const who = await chi(req, res); if (!who) return;
    const id = Number((req.body || {}).id);
    try {
      await ensureTables();
      const p = await rows(sql`SELECT * FROM focuslock_patti WHERE id = ${id} LIMIT 1`);
      if (!p.length) { res.status(404).json({ error: "patto non trovato" }); return; }
      /* 0.9.302: un patto verso la beneficenza non ha garante: lo scioglie chi si impegna (nell'app, solo dopo l'attesa
         del contratto di abitudine) */
      const autoreInAttesa = p[0].autoreSub === who.sub && (p[0].stato === "attesa" || perBeneficenza(p[0]));
      if (p[0].garanteSub !== who.sub && !autoreInAttesa) { res.status(403).json({ error: "solo il garante scioglie un patto firmato" }); return; }
      await rows(sql`UPDATE focuslock_patti SET stato = ${p[0].stato === "attesa" ? "annullato" : "sciolto"} WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: "db: " + (e?.message || String(e)) }); }
  });

  /* le app vecchie chiamano ancora questi tre: i pagamenti con la carta non esistono piu' */
  for (const via of ["carta", "conto", "aggiorna-pagamento"]) {
    app.post("/api/focuslock/patti/" + via, (_req: Request, res: Response) => { res.status(410).json({ error: "I soldi del patto non passano più dall'app: aggiorna DreamMap" }); });
  }
}
