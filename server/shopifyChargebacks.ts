/**
 * Chargeback Shopify: la campanella che mancava.
 *
 * Il caso #1261 (6 ago 2026, hoodie mai arrivati, 132 USD contestati) e' stato
 * scoperto solo il 1 settembre guardando per caso la home di Shopify: Shopify
 * manda l'avviso di contestazione via mail all'indirizzo PROPRIETARIO dello
 * store (info@dreambrothers.it, la casella M365 bloccata dal furto del
 * telefono) e l'app mobile non manda nessuna push per i chargeback. Risultato:
 * meta' del tempo per rispondere bruciato senza saperlo.
 *
 * Qui la contestazione arriva per DUE strade indipendenti, di proposito:
 *
 *   1. webhook disputes/create + disputes/update — immediato e ricco
 *      (importo, motivo della banca, scadenza delle prove);
 *   2. poller ogni 20 minuti sulla ricerca ordini — piu' povero ma non si puo'
 *      "dimenticare" di registrare: recupera anche le contestazioni aperte
 *      PRIMA che il webhook esistesse (come #1261) e quelle il cui webhook si
 *      e' perso per strada.
 *
 * Una sola strada avrebbe ricreato lo stesso buco che stiamo chiudendo.
 */
import { upsertChargeback, getChargebacks } from "./db";

const OWNER_USER_ID = 1;

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

async function shopify<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) throw new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN nelle variabili Railway.");
  const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`Shopify: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data as T;
}

export type StatoChargeback = "needs_response" | "under_review" | "won" | "lost" | "accepted";

/** DisputeStatus dell'Admin API (SCREAMING_CASE) -> il nostro enum. */
export function statoDa(raw: unknown): StatoChargeback {
  const s = String(raw ?? "").toLowerCase();
  if (s === "under_review") return "under_review";
  if (s === "won") return "won";
  if (s === "lost") return "lost";
  if (s === "accepted") return "accepted";
  return "needs_response";
}

/** Solo queste due pesano: sulle altre la partita e' gia' chiusa. */
export function eAperto(stato: string): boolean {
  return stato === "needs_response" || stato === "under_review";
}

export function soloNumeri(gidOrId: unknown): string {
  const s = String(gidOrId ?? "");
  const m = s.match(/(\d+)\s*$/);
  return m ? m[1] : s;
}

function dataDa(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/* ------------------------------------------------------------------ */
/* Push su Telegram (opzionale)                                        */
/* ------------------------------------------------------------------ */

/**
 * Una campanella dentro una web app chiusa non sveglia nessuno: se il bot e'
 * configurato, il chargeback arriva anche sul telefono. Senza le due variabili
 * la funzione non fa nulla e non rompe niente — la riga a DB e' gia' salva.
 */
export async function avvisaSuTelegram(testo: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: testo, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) console.warn("[chargeback] Telegram ha rifiutato:", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (err) {
    console.warn("[chargeback] Telegram irraggiungibile:", err);
    return false;
  }
}

export function scadenzaLeggibile(d?: Date | null): string {
  if (!d) return "scadenza non comunicata";
  const giorni = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const quando = d.toLocaleDateString("it-IT", { day: "2-digit", month: "long" });
  if (giorni < 0) return `prove scadute il ${quando}`;
  if (giorni === 0) return `prove entro OGGI (${quando})`;
  return `prove entro il ${quando} — ${giorni} giorn${giorni === 1 ? "o" : "i"}`;
}

/**
 * Registra una contestazione e avvisa SOLO quando c'e' davvero una novita'
 * (prima comparsa o cambio di stato). Il poller ripassa ogni 20 minuti: se
 * notificasse a ogni giro, la campanella diventerebbe rumore e Andrea
 * smetterebbe di guardarla — che e' esattamente il problema di partenza.
 */
async function registra(dati: Parameters<typeof upsertChargeback>[0], statoNuovo: StatoChargeback) {
  const r = await upsertChargeback(dati);
  const cambioStato = r.esito === "aggiornato" && !!r.statoPrecedente && r.statoPrecedente !== statoNuovo;
  if (r.esito !== "nuovo" && !cambioStato) return { ...r, notificato: false };

  const importo = dati.amount ? `${dati.amount} ${dati.currency ?? ""}`.trim() : "importo da verificare";
  const titolo = r.esito === "nuovo"
    ? "🚨 <b>Nuovo chargeback su Shopify</b>"
    : `♻️ <b>Chargeback aggiornato</b> (${r.statoPrecedente} → ${statoNuovo})`;
  const righe = [
    titolo,
    `Ordine <b>${dati.orderName ?? "?"}</b> — ${importo}`,
    dati.customerName ? `Cliente: ${dati.customerName}` : "",
    dati.reason ? `Motivo banca: ${dati.reason}` : "",
    `⏳ ${scadenzaLeggibile(dati.evidenceDueBy as Date | undefined)}`,
    "",
    "Apri: /care/chargebacks",
  ].filter(Boolean);
  const notificato = await avvisaSuTelegram(righe.join("\n"));
  return { ...r, notificato };
}

/* ------------------------------------------------------------------ */
/* 1. Webhook                                                          */
/* ------------------------------------------------------------------ */

async function dettagliOrdine(orderGid: string) {
  const d = await shopify<{
    order: {
      name: string;
      email: string | null;
      customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
    } | null;
  }>(
    `query($id: ID!){ order(id:$id){ name email customer { firstName lastName email } } }`,
    { id: orderGid },
  );
  const o = d.order;
  if (!o) return {} as { orderName?: string; customerName?: string; customerEmail?: string };
  const nome = [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ").trim();
  return {
    orderName: o.name,
    customerName: nome || undefined,
    customerEmail: o.customer?.email ?? o.email ?? undefined,
  };
}

/**
 * Payload REST di disputes/create e disputes/update. E' la fonte piu' ricca che
 * abbiamo: evidence_due_by e reason non sono leggibili dall'Admin API GraphQL
 * senza lo scope read_shopify_payments, che questa app non ha.
 */
export async function ingestDisputeWebhook(payload: any) {
  const disputeId = soloNumeri(payload?.id);
  if (!disputeId) throw new Error("payload senza id dispute");
  const stato = statoDa(payload?.status);
  const orderId = payload?.order_id ? soloNumeri(payload.order_id) : undefined;

  // Il webhook non porta nome ordine ne' cliente: si va a prenderli, ma se la
  // chiamata fallisce la riga si salva lo stesso. Perdere il nome del cliente
  // e' un fastidio, perdere il chargeback e' il problema di partenza.
  let dettagli: { orderName?: string; customerName?: string; customerEmail?: string } = {};
  if (orderId) {
    try {
      dettagli = await dettagliOrdine(`gid://shopify/Order/${orderId}`);
    } catch (err) {
      console.warn(`[chargeback] dettagli ordine ${orderId} non letti:`, err);
    }
  }

  return registra({
    userId: OWNER_USER_ID,
    disputeId,
    orderId,
    orderGid: orderId ? `gid://shopify/Order/${orderId}` : undefined,
    orderName: dettagli.orderName,
    customerName: dettagli.customerName,
    customerEmail: dettagli.customerEmail,
    amount: payload?.amount != null ? String(payload.amount) : undefined,
    currency: payload?.currency ?? undefined,
    reason: payload?.reason ?? undefined,
    networkReasonCode: payload?.network_reason_code ?? undefined,
    tipo: String(payload?.type ?? "chargeback") === "inquiry" ? "inquiry" : "chargeback",
    status: stato,
    evidenceDueBy: dataDa(payload?.evidence_due_by),
    initiatedAt: dataDa(payload?.initiated_at ?? payload?.created_at),
    raw: payload,
  }, stato);
}

/* ------------------------------------------------------------------ */
/* 2. Poller (rete di sicurezza)                                       */
/* ------------------------------------------------------------------ */

type NodoOrdine = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  totalPriceSet: { presentmentMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
  disputes: { id: string; status: string; initiatedAs: string }[];
};

/**
 * Cerca gli ordini contestati e li allinea a DB.
 *
 * Si passa dalla ricerca ordini (chargeback_status:) e non da
 * shopifyPaymentsAccount.disputes perche' quest'ultimo pretende lo scope
 * read_shopify_payments: con il token attuale risponde "Access denied", e una
 * rete di sicurezza che dipende da uno scope che non abbiamo non e' una rete.
 * Il prezzo e' che di qui NON arrivano motivo e scadenza (OrderDisputeSummary
 * espone solo id, stato e tipo): li porta il webhook, e l'upsert non
 * sovrascrive con null quello che il webhook ha gia' scritto.
 */
export async function sincronizzaChargebacks(): Promise<{
  trovati: number; nuovi: number; aggiornati: number; errori: string[];
}> {
  const esito = { trovati: 0, nuovi: 0, aggiornati: 0, errori: [] as string[] };

  const stati = ["needs_response", "under_review", "won", "lost", "accepted"];
  const q = stati.map((s) => `chargeback_status:${s}`).join(" OR ");

  let dati: { orders: { edges: { node: NodoOrdine }[] } };
  try {
    dati = await shopify(
      `query($q: String!) {
        orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
          edges { node {
            id name email createdAt
            totalPriceSet { presentmentMoney { amount currencyCode } }
            customer { firstName lastName email }
            disputes { id status initiatedAs }
          } }
        }
      }`,
      { q },
    );
  } catch (err) {
    esito.errori.push(err instanceof Error ? err.message : String(err));
    return esito;
  }

  for (const { node } of dati.orders?.edges ?? []) {
    for (const d of node.disputes ?? []) {
      esito.trovati++;
      const stato = statoDa(d.status);
      const nome = [node.customer?.firstName, node.customer?.lastName].filter(Boolean).join(" ").trim();
      try {
        const r = await registra({
          userId: OWNER_USER_ID,
          disputeId: soloNumeri(d.id),
          orderId: soloNumeri(node.id),
          orderGid: node.id,
          orderName: node.name,
          customerName: nome || undefined,
          customerEmail: node.customer?.email ?? node.email ?? undefined,
          // Importo dell'ORDINE nella valuta con cui ha pagato il cliente: e'
          // una stima dell'importo contestato finche' il webhook non porta
          // quello esatto della banca (una contestazione puo' essere parziale).
          amount: node.totalPriceSet?.presentmentMoney?.amount,
          currency: node.totalPriceSet?.presentmentMoney?.currencyCode,
          tipo: String(d.initiatedAs ?? "").toUpperCase() === "INQUIRY" ? "inquiry" : "chargeback",
          status: stato,
        }, stato);
        if (r.esito === "nuovo") esito.nuovi++;
        else if (r.esito === "aggiornato") esito.aggiornati++;
      } catch (err) {
        esito.errori.push(`${node.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return esito;
}

/** Quante contestazioni pesano ancora sulla campanella. */
export async function contaChargebackAperti(userId = OWNER_USER_ID): Promise<number> {
  const righe = await getChargebacks(userId);
  return righe.filter((c) => eAperto(c.status) && c.nostroStato !== "risolto").length;
}
