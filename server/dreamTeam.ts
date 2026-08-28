import { randomUUID } from "crypto";
import {
  getDreamTeamAgentsList,
  getDreamTeamMessagesList,
  insertDreamTeamMessageIfNew,
  getAllUserSettings,
  dreamTeamDbOk,
} from "./db";

// Dream Team — il lato tRPC della stanza. Solo lettura + "imbucare":
// il mastermind (chi parla, in che ordine, chi passa) vive in dreamteam.py
// sul VPS, e questa e' una scelta, non una mancanza: un motore solo.
const OWNER_USER_ID = 1;
const AGENT_ONLINE_MS = 120_000;
// Una domanda "new" piu' vecchia di cosi' non e' "in attesa": e' rimasta senza
// risposta (giro morto a meta', servizio riavviato). La UI deve dire la verita'
// invece di mostrare "sta scrivendo…" per giorni.
const ATTESA_MAX_MS = 10 * 60 * 1000;

export async function dreamTeamStanza() {
  const [messages, settings, dbOk] = await Promise.all([
    getDreamTeamMessagesList(OWNER_USER_ID, 200),
    getAllUserSettings(OWNER_USER_ID),
    dreamTeamDbOk(),
  ]);
  const lastSeen = Number(settings["dreamteam_last_seen"] ?? 0);
  const now = Date.now();
  const attesa = messages.some(
    (m) => m.role === "user" && m.status === "new"
      && now - new Date(m.createdAt).getTime() < ATTESA_MAX_MS,
  );
  return {
    messages: messages.map((m) => ({
      id: m.id, role: m.role, agentCode: m.agentCode, text: m.text,
      source: m.source, status: m.status, replyToId: m.replyToId,
      nota: m.nota, tentativi: m.tentativi,
      deliveredAt: m.deliveredAt, createdAt: m.createdAt,
      // "rimasta senza risposta": new ma fuori dalla finestra di attesa
      senzaRisposta: m.role === "user" && m.status === "new"
        && now - new Date(m.createdAt).getTime() >= ATTESA_MAX_MS,
    })),
    attesa,
    ponteOnline: lastSeen > 0 && now - lastSeen < AGENT_ONLINE_MS,
    occupato: settings["dreamteam_occupato"] === "1",
    groupId: settings["dreamteam_group_id"] ?? null,
    dbOk,
  };
}

export async function dreamTeamAgenti() {
  return getDreamTeamAgentsList(OWNER_USER_ID);
}

export async function dreamTeamInvia(text: string) {
  const esito = await insertDreamTeamMessageIfNew({
    userId: OWNER_USER_ID,
    role: "user",
    agentCode: null,
    text,
    source: "web",
    externalId: `web:${randomUUID()}`,
    status: "new",
    deliveredAt: null,
  });
  // Niente bolla ottimista su un DB morto: la UI deve sapere che NON e' partito.
  if (!esito) return { success: false as const, error: "db unavailable" };
  return { success: true as const, id: esito.id };
}
