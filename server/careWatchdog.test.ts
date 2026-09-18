import { describe, expect, it } from "vitest";
import { valuta } from "./careWatchdog";

const email = { chiave: "email", etichetta: "Email", soglieOre: 72 };

describe("valuta (cuore del cane da guardia)", () => {
  it("suona quando il workflow e' spento, anche se il canale ha appena ricevuto", () => {
    // E' il caso del 29 giugno: il workflow email si e' fermato mentre in
    // Inbox c'erano ancora messaggi recenti. Guardare solo il silenzio avrebbe
    // fatto scattare l'allarme tre giorni dopo; guardare lo stato del workflow
    // lo fa scattare subito.
    const r = valuta(email, 1, false);
    expect(r.inAllarme).toBe(true);
    expect(r.motivo).toMatch(/spento/);
  });

  it("suona quando il canale tace oltre la soglia", () => {
    expect(valuta(email, 73, true).inAllarme).toBe(true);
    expect(valuta(email, 24 * 60, true).motivo).toMatch(/60 giorni/);
  });

  it("NON suona dentro la soglia con il workflow acceso", () => {
    expect(valuta(email, 0, true).inAllarme).toBe(false);
    expect(valuta(email, 71.9, true).inAllarme).toBe(false);
    expect(valuta(email, 72, true).inAllarme).toBe(false);
  });

  it("NON suona quando lo stato del workflow e' semplicemente ignoto", () => {
    // null significa "non lo so" (manca la API key, n8n non risponde), non
    // "e' spento". Trattarlo come spento produrrebbe una notifica falsa al
    // primo riavvio di n8n, e un cane da guardia che mente al primo giorno
    // viene ignorato per sempre.
    expect(valuta(email, 1, null).inAllarme).toBe(false);
    expect(valuta(email, 71, null).inAllarme).toBe(false);
  });

  it("suona su un canale che non ha MAI ricevuto niente", () => {
    // E' lo stato reale di WhatsApp: workflow acceso, zero messaggi da sempre
    // perche' Meta non chiama il webhook. Senza questo ramo il canale
    // resterebbe verde per sempre proprio perche' non funziona.
    const r = valuta(email, null, true);
    expect(r.inAllarme).toBe(true);
    expect(r.motivo).toMatch(/mai ricevuto/);
  });

  it("suona quando il workflow gira ma fallisce, anche col canale appena vivo", () => {
    // E' il caso #1263 del 16/09/2026: credenziale Gmail scaduta alle 09:32, il
    // workflow resta ATTIVO e fallisce 2.826 volte di fila. Guardando solo lo
    // stato e il silenzio (soglia 72 ore) l'allarme sarebbe arrivato il 19,
    // mentre una cliente aspettava gia' da due giorni.
    const r = valuta(email, 1, true, 3);
    expect(r.inAllarme).toBe(true);
    expect(r.motivo).toMatch(/fallisce/);
    expect(r.motivo).toMatch(/3/);
  });

  it("NON suona per un singolo intoppo di rete", () => {
    // Una o due esecuzioni fallite capitano: n8n riavvia, la rete perde un colpo.
    expect(valuta(email, 1, true, 1).inAllarme).toBe(false);
    expect(valuta(email, 1, true, 2).inAllarme).toBe(false);
  });

  it("zero errori, o errori ignoti, non fanno rumore", () => {
    // `null` significa "non lo sappiamo": tipico di un webhook a cui nessuno
    // scrive. Trattarlo come guasto riempirebbe il telefono di falsi allarmi.
    expect(valuta(email, 1, true, 0).inAllarme).toBe(false);
    expect(valuta(email, 1, true, null).inAllarme).toBe(false);
  });

  it("gli errori battono il silenzio nel motivo", () => {
    // Se il canale tace da giorni ED e' in errore, il motivo utile e' l'errore:
    // dice cosa riparare, il silenzio dice solo che qualcosa non va.
    expect(valuta(email, 24 * 10, true, 5).motivo).toMatch(/fallisce/);
  });
});
