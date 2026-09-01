/**
 * Il cane da guardia del silenzio.
 *
 * I messaggi dei clienti entrano nella Inbox passando da n8n. Il 29 giugno il
 * workflow email si e' fermato (credenziale IMAP morta: Microsoft ha disattivato
 * l'autenticazione base) e quello WhatsApp ha smesso di ricevere chiamate da
 * Meta. Nessuno se ne e' accorto per due mesi, perche' una casella che non
 * riceve piu' niente e' identica a una casella dove nessuno scrive.
 *
 * Il 25 agosto una cliente ha scritto per un ordine mai arrivato. Quel messaggio
 * non e' mai comparso da nessuna parte. Quattro giorni dopo e' andata in banca.
 *
 * Questo modulo non trasporta messaggi: li conta. Gira dentro la web app e non
 * dentro n8n proprio perche' deve poter dire "n8n e' morto". Se un canale tace
 * oltre la sua soglia, o se il suo workflow risulta spento, alza l'allarme e
 * avvisa. Il silenzio smette di essere silenzioso.
 */
import { getUltimoMessaggioPerCanale, getAllUserSettings, upsertUserSetting } from "./db";
import { avvisaSuTelegram } from "./shopifyChargebacks";

const OWNER_USER_ID = 1;

export type Canale = {
  /** Chiave del canale come la scrive n8n in /api/care/ingest. */
  chiave: string;
  etichetta: string;
  /**
   * Dopo quante ore di silenzio il canale e' sospetto.
   *
   * Non e' "quanto spesso scrivono i clienti": e' quanto a lungo possiamo NON
   * ricevere niente senza che sia strano. Su un negozio con poche decine di
   * ordini al mese due giorni di posta muta sono plausibili, due settimane no.
   * Meglio una soglia larga che si accende di rado ma vera, che una stretta che
   * fa rumore e si impara a ignorare.
   */
  soglieOre: number;
  /** Workflow n8n che alimenta il canale, se ne esiste uno. */
  workflowId?: string;
};

export const CANALI: Canale[] = [
  { chiave: "email", etichetta: "Email", soglieOre: 72, workflowId: "h0HCZNFuq5mHKpj1" },
  { chiave: "whatsapp", etichetta: "WhatsApp", soglieOre: 168, workflowId: "tWTxka4DRaKSkQ27" },
];

export type StatoCanale = {
  chiave: string;
  etichetta: string;
  ultimoMessaggio: string | null;
  oreDiSilenzio: number | null;
  soglieOre: number;
  workflowAttivo: boolean | null;
  inAllarme: boolean;
  motivo: string;
};

/* ------------------------------------------------------------------ */
/* n8n                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Chiede a n8n se un workflow e' ancora attivo.
 *
 * Ritorna `null` quando non lo sappiamo (niente API key, n8n irraggiungibile).
 * `null` NON e' `false`: un workflow di cui non sappiamo nulla non deve far
 * scattare un allarme, altrimenti la prima volta che n8n riavvia arriva una
 * notifica falsa e il cane da guardia perde credibilita' al primo giorno.
 */
export async function workflowAttivo(workflowId: string): Promise<boolean | null> {
  const base = process.env.N8N_BASE_URL;
  const key = process.env.N8N_API_KEY;
  if (!base || !key) return null;
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/workflows/${workflowId}`, {
      headers: { "X-N8N-API-KEY": key, accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.active === "boolean" ? j.active : null;
  } catch (err) {
    console.warn(`[watchdog] n8n non raggiungibile per ${workflowId}:`, err);
    return null;
  }
}

/**
 * Riaccende un workflow spento.
 *
 * E' la parte che rende il cane da guardia utile e non solo rumoroso: se il
 * workflow si e' disattivato da solo, la web app lo rimette in piedi senza
 * aspettare che qualcuno legga la notifica. Se n8n rifiuta (tipicamente perche'
 * una credenziale non e' piu' valida, che e' esattamente quello che e'
 * successo all'IMAP) ritorna il messaggio di errore, che vale piu' di un
 * semplice "non riuscito": dice cosa riparare.
 */
export async function riaccendiWorkflow(workflowId: string): Promise<{ ok: boolean; errore?: string }> {
  const base = process.env.N8N_BASE_URL;
  const key = process.env.N8N_API_KEY;
  if (!base || !key) return { ok: false, errore: "N8N_BASE_URL / N8N_API_KEY non configurate" };
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/api/v1/workflows/${workflowId}/activate`, {
      method: "POST",
      headers: { "X-N8N-API-KEY": key, accept: "application/json" },
    });
    if (r.ok) return { ok: true };
    return { ok: false, errore: `${r.status} ${await r.text().catch(() => "")}`.slice(0, 300) };
  } catch (err) {
    return { ok: false, errore: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ */
/* Diagnosi                                                            */
/* ------------------------------------------------------------------ */

/**
 * Decide se un canale e' in allarme. Funzione pura: e' il cuore del modulo e
 * l'unico pezzo che si puo' provare senza database ne' rete.
 *
 * Due motivi indipendenti, e basta uno solo:
 *  - il workflow risulta SPENTO (certezza, non indizio);
 *  - il canale tace da piu' della sua soglia (indizio forte).
 */
export function valuta(
  canale: Pick<Canale, "chiave" | "etichetta" | "soglieOre">,
  oreDiSilenzio: number | null,
  workflowAttivoOra: boolean | null,
): { inAllarme: boolean; motivo: string } {
  if (workflowAttivoOra === false) {
    return { inAllarme: true, motivo: "il workflow n8n che alimenta questo canale e' spento" };
  }
  if (oreDiSilenzio === null) {
    // Mai ricevuto niente: non e' un guasto dimostrato, ma non e' nemmeno
    // normale per un canale che dovrebbe essere in ascolto.
    return { inAllarme: true, motivo: "nessun messaggio mai ricevuto su questo canale" };
  }
  if (oreDiSilenzio > canale.soglieOre) {
    const giorni = Math.floor(oreDiSilenzio / 24);
    return {
      inAllarme: true,
      motivo: `nessun messaggio da ${giorni > 0 ? `${giorni} giorni` : `${Math.round(oreDiSilenzio)} ore`}`,
    };
  }
  return { inAllarme: false, motivo: "" };
}

export async function controllaCanali(userId = OWNER_USER_ID): Promise<StatoCanale[]> {
  const ultimi = await getUltimoMessaggioPerCanale(userId);
  const adesso = Date.now();

  const stati: StatoCanale[] = [];
  for (const canale of CANALI) {
    const ultimo = ultimi[canale.chiave] ?? null;
    const oreDiSilenzio = ultimo ? (adesso - ultimo.getTime()) / 3_600_000 : null;
    const attivo = canale.workflowId ? await workflowAttivo(canale.workflowId) : null;
    const { inAllarme, motivo } = valuta(canale, oreDiSilenzio, attivo);
    stati.push({
      chiave: canale.chiave,
      etichetta: canale.etichetta,
      ultimoMessaggio: ultimo ? ultimo.toISOString() : null,
      oreDiSilenzio: oreDiSilenzio === null ? null : Math.round(oreDiSilenzio),
      soglieOre: canale.soglieOre,
      workflowAttivo: attivo,
      inAllarme,
      motivo,
    });
  }
  return stati;
}

/* ------------------------------------------------------------------ */
/* Ciclo dello scheduler                                               */
/* ------------------------------------------------------------------ */

const chiaveAllarme = (canale: string) => `care_allarme_${canale}`;

/**
 * Un giro di controllo.
 *
 * Avvisa solo sul FRONTE di salita, cioe' quando un canale entra in allarme,
 * non a ogni giro. Un canale rotto resta rotto per giorni: se notificasse ogni
 * ora, la notifica diventerebbe rumore e verrebbe ignorata, che e' precisamente
 * il modo in cui questo problema e' rimasto invisibile due mesi.
 */
export async function giroWatchdog(userId = OWNER_USER_ID): Promise<{
  stati: StatoCanale[]; nuoviAllarmi: string[]; rientrati: string[]; riaccesi: string[];
}> {
  const stati = await controllaCanali(userId);
  const settings = await getAllUserSettings(userId);
  const nuoviAllarmi: string[] = [];
  const rientrati: string[] = [];
  const riaccesi: string[] = [];

  for (const s of stati) {
    const eraInAllarme = settings[chiaveAllarme(s.chiave)] === "true";

    // Se il workflow e' spento si prova a rialzarlo prima di disturbare Andrea:
    // se basta quello, il canale torna vivo da solo.
    if (s.workflowAttivo === false) {
      const canale = CANALI.find((c) => c.chiave === s.chiave);
      if (canale?.workflowId) {
        const r = await riaccendiWorkflow(canale.workflowId);
        if (r.ok) {
          riaccesi.push(s.etichetta);
          s.motivo = "workflow trovato spento e riacceso automaticamente";
        } else if (r.errore) {
          s.motivo = `workflow spento e NON riaccendibile: ${r.errore}`;
        }
      }
    }

    if (s.inAllarme && !eraInAllarme) {
      nuoviAllarmi.push(s.etichetta);
      await avvisaSuTelegram(
        [
          "🔕 <b>Canale clienti muto</b>",
          `<b>${s.etichetta}</b>: ${s.motivo}`,
          s.ultimoMessaggio
            ? `Ultimo messaggio: ${new Date(s.ultimoMessaggio).toLocaleString("it-IT")}`
            : "Nessun messaggio mai ricevuto",
          "",
          "Un cliente potrebbe averti scritto senza che tu lo veda.",
        ].join("\n"),
      );
    }
    if (!s.inAllarme && eraInAllarme) rientrati.push(s.etichetta);

    await upsertUserSetting(userId, chiaveAllarme(s.chiave), String(s.inAllarme));
  }

  return { stati, nuoviAllarmi, rientrati, riaccesi };
}
