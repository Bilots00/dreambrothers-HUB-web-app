import { describe, expect, it } from "vitest";
import { statoDa, soloNumeri, eAperto, scadenzaLeggibile, eMuroPII } from "./shopifyChargebacks";

describe("soloNumeri (deduplica webhook <-> poller)", () => {
  // Il punto piu' fragile di tutto il sistema. La stessa contestazione arriva
  // due volte con due formati diversi:
  //   webhook REST   -> id: 17293672773
  //   GraphQL poller -> id: "gid://shopify/OrderDisputeSummary/17293672773"
  // Se questi due non collassano sulla stessa chiave, il chargeback #1261
  // finisce a DB in doppia copia e Andrea riceve due notifiche per lo stesso
  // fatto: la campanella diventa rumore, che e' il problema che stiamo
  // risolvendo. Questo test e' l'unica cosa che tiene ferma quella regola.
  it("riduce GID e id numerico alla stessa chiave", () => {
    expect(soloNumeri("gid://shopify/OrderDisputeSummary/17293672773")).toBe("17293672773");
    expect(soloNumeri(17293672773)).toBe("17293672773");
    expect(soloNumeri("17293672773")).toBe("17293672773");
    expect(soloNumeri("gid://shopify/OrderDisputeSummary/17293672773"))
      .toBe(soloNumeri(17293672773));
  });

  it("regge i GID degli ordini e i valori vuoti", () => {
    expect(soloNumeri("gid://shopify/Order/13306487243077")).toBe("13306487243077");
    expect(soloNumeri(null)).toBe("");
    expect(soloNumeri(undefined)).toBe("");
  });
});

describe("statoDa", () => {
  it("normalizza il DisputeStatus GraphQL (SCREAMING_CASE) e quello REST", () => {
    expect(statoDa("NEEDS_RESPONSE")).toBe("needs_response");
    expect(statoDa("needs_response")).toBe("needs_response");
    expect(statoDa("UNDER_REVIEW")).toBe("under_review");
    expect(statoDa("WON")).toBe("won");
    expect(statoDa("LOST")).toBe("lost");
    expect(statoDa("ACCEPTED")).toBe("accepted");
  });

  it("davanti a uno stato sconosciuto sceglie il piu' urgente, non il piu' comodo", () => {
    // Un valore nuovo dell'API non deve MAI far sparire una contestazione dalla
    // campanella: nel dubbio la si tratta come da rispondere.
    expect(statoDa("qualcosa_di_nuovo")).toBe("needs_response");
    expect(statoDa(null)).toBe("needs_response");
    expect(eAperto(statoDa(undefined))).toBe(true);
  });
});

describe("eAperto", () => {
  it("tiene accesa la campanella solo dove la partita e' ancora giocabile", () => {
    expect(eAperto("needs_response")).toBe(true);
    expect(eAperto("under_review")).toBe(true);
    expect(eAperto("won")).toBe(false);
    expect(eAperto("lost")).toBe(false);
    expect(eAperto("accepted")).toBe(false);
  });
});

describe("scadenzaLeggibile", () => {
  const fraGiorni = (n: number) => new Date(Date.now() + n * 86_400_000);

  it("distingue scaduto, oggi e futuro", () => {
    expect(scadenzaLeggibile(fraGiorni(-2))).toMatch(/^prove scadute il /);
    // "oggi" = mancano meno di 24h: Math.ceil manda a 1 qualsiasi frazione di
    // giorno, quindi il caso OGGI si prova con un istante gia' passato di poco.
    expect(scadenzaLeggibile(new Date(Date.now() - 1000))).toMatch(/scadute|OGGI/);
    expect(scadenzaLeggibile(fraGiorni(13))).toMatch(/13 giorni/);
    expect(scadenzaLeggibile(fraGiorni(0.5))).toMatch(/1 giorno/);
  });

  it("non inventa una scadenza quando Shopify non la comunica", () => {
    // Il poller non riceve evidence_due_by (serve read_shopify_payments):
    // mostrare "0 giorni" al posto di "non comunicata" farebbe scattare un
    // panico falso, o peggio, farebbe accettare un chargeback ancora vincibile.
    expect(scadenzaLeggibile(undefined)).toBe("scadenza non comunicata");
    expect(scadenzaLeggibile(null)).toBe("scadenza non comunicata");
  });
});

describe("eMuroPII", () => {
  // Il chargeback #1261 era aperto su Shopify e la pagina diceva "Nessuna
  // contestazione": la query chiedeva il nome del cliente e su un piano senza
  // accesso ai dati personali Shopify butta via TUTTA la risposta, non solo il
  // campo negato. Questo riconoscimento e' cio' che fa scattare la seconda
  // query senza PII. Se smettesse di riconoscere il messaggio, la sezione
  // tornerebbe vuota in silenzio, che e' il modo peggiore di sbagliare.
  it("riconosce il rifiuto PII di Shopify, nella forma esatta che ha rotto #1261", () => {
    expect(eMuroPII(new Error('Shopify: [{"message":"This app is not approved to access the Customer object. Access to personally identifiable information (PII) like customer names, addresses, emails, phone numbers is only available on Shopify, Advanced, and Plus plans."}]'))).toBe(true);
    expect(eMuroPII(new Error("Field access denied: protected customer data requires approval"))).toBe(true);
    expect(eMuroPII("personally identifiable information")).toBe(true);
  });

  it("NON scambia per PII un errore diverso, che va invece mostrato", () => {
    // Un token scaduto o una rete giu' devono restare rossi: ritentare senza
    // i campi cliente non li risolverebbe, li nasconderebbe soltanto.
    expect(eMuroPII(new Error("Shopify: [{\"message\":\"Invalid API key or access token\"}]"))).toBe(false);
    expect(eMuroPII(new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN nelle variabili Railway."))).toBe(false);
    expect(eMuroPII(new Error("fetch failed"))).toBe(false);
    expect(eMuroPII(null)).toBe(false);
  });
});
