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
});
