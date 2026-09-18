import { describe, expect, it } from "vitest";
import { classifica, estraiDalModuloShopify, ordiniCitati, testoNotifica } from "./careClienti";

// Il testo che arriva a /api/care/ingest e' "Oggetto: ... // <corpo>": lo compone
// il workflow n8n. I casi qui sotto sono copiati dalla Inbox reale del 18/09/2026.
const daInbox = (oggetto: string, corpo: string) => `Oggetto: ${oggetto} // ${corpo}`;

const MODULO_NAOMI = daInbox(
  "New customer message on 16 September 2026 at 12:46",
  [
    "You received a new message from your online store's contact form.",
    "Country Code: NL",
    "Name: Naomi Rotensen",
    "Email: naomirotensen@hotmail.com",
    "Category: Returns & Refunds",
    "Body: Dear dream brothers,",
    "Recently I ordered the hoodie. I want to return it.",
    "My order number is #1263.",
  ].join("\n"),
);

describe("estraiDalModuloShopify", () => {
  it("tira fuori la cliente vera dalla notifica di Shopify", () => {
    // Senza questo, la conversazione resta intestata a mailer@shopify.com e tutti
    // i clienti finiscono in un thread solo chiamato "Shopify".
    const c = estraiDalModuloShopify(MODULO_NAOMI);
    expect(c).not.toBeNull();
    expect(c!.email).toBe("naomirotensen@hotmail.com");
    expect(c!.nome).toBe("Naomi Rotensen");
    expect(c!.categoria).toBe("Returns & Refunds");
    expect(c!.corpo).toContain("#1263");
    // Il corpo non deve fermarsi alla prima riga.
    expect(c!.corpo).toContain("return it");
  });

  it("non scambia per modulo contatti una mail normale che cita un'email", () => {
    const testo = daInbox("Re: ordine", "Scrivimi pure a mario@example.com quando puoi.");
    expect(estraiDalModuloShopify(testo)).toBeNull();
  });

  it("ritorna null su testo vuoto", () => {
    expect(estraiDalModuloShopify("")).toBeNull();
  });
});

describe("classifica", () => {
  it("il modulo contatti vince sulla lista nera", () => {
    // Arriva da shopify.com, che e' un dominio di servizio: senza la precedenza
    // esplicita verrebbe scartato proprio il caso che ci e' costato due giorni.
    const v = classifica({ channel: "email", handle: "mailer@shopify.com", testo: MODULO_NAOMI });
    expect(v.cliente).toBe(true);
    expect(v.motivo).toMatch(/modulo contatti/);
  });

  it("il flag daModuloContatti vale anche quando il marcatore e' gia' stato tolto", () => {
    // Il percorso reale estrae il corpo PRIMA di classificare, quindi il testo
    // non contiene piu' "Email:"/"Body:". Senza il flag la precedenza non
    // scattava e la classificazione tornava giusta per il motivo sbagliato:
    // trovato in produzione il 18/09/2026, non dai test unitari.
    const v = classifica({
      channel: "email",
      handle: "cliente@dominioinlistanera.example",
      testo: "[Returns & Refunds] Vorrei restituire la felpa, ordine #1263.",
      daModuloContatti: true,
    });
    expect(v.cliente).toBe(true);
    expect(v.motivo).toMatch(/modulo contatti/);
  });

  it("il flag batte anche una frase che sembra un pitch", () => {
    // Un cliente vero puo' scrivere parole che somigliano a un'offerta: se la
    // richiesta arriva dal modulo contatti del negozio, e' un cliente e basta.
    const v = classifica({
      channel: "email",
      handle: "tizio@gmail.com",
      testo: "I came across your store and my order never arrived",
      daModuloContatti: true,
    });
    expect(v.cliente).toBe(true);
  });

  it("riconosce una mail scritta a mano da una cliente", () => {
    const v = classifica({
      channel: "email",
      handle: "NaomiRotensen@hotmail.com",
      testo: daInbox("Return", "I want to return it. My order number is #1263."),
    });
    expect(v.cliente).toBe(true);
  });

  it("qualsiasi cosa su WhatsApp e' una persona", () => {
    expect(classifica({ channel: "whatsapp", handle: "+31600000000", testo: "hallo?" }).cliente).toBe(true);
    expect(classifica({ channel: "instagram", handle: "someone", testo: "ciao" }).cliente).toBe(true);
  });

  it("scarta il rumore che riempiva la Inbox", () => {
    const rumore: Array<[string, string]> = [
      ["sellersupport@shop.tiktok.com", "Partecipa al TikTok Shop LIVE Auction Accelerator"],
      ["no-reply@okendo.io", "Your Week In Reviews For DreamBrothers"],
      ["hello@luckyorange.com", "What are your heatmaps saying?"],
      ["info@track123.com", "Your weekly report of Track123"],
      ["noreply@email.openai.com", "Effetto professionale da un selfie"],
      ["hi@vitals.co", "Just a little housekeeping"],
      ["daniel@section.store", "Your cart does more than hold products"],
      ["noreply@dreamstime.com", "The Story Behind the Image"],
      ["support@judge.me", "Critical Role, Shopify, WPP Media"],
      ["noreply@google.com", "Il tuo codice di verifica di Play Console"],
      ["support@zendrop.com", "Hello Andrea, thank you for your patience"],
    ];
    for (const [handle, oggetto] of rumore) {
      const v = classifica({ channel: "email", handle, testo: daInbox(oggetto, oggetto) });
      expect(v.cliente, `${handle} doveva essere scartato`).toBe(false);
    }
  });

  it("scarta il riepilogo che il negozio manda a se stesso", () => {
    const v = classifica({
      channel: "email",
      handle: "info@dreambrothers.it",
      testo: daInbox("You have 94 unfulfilled orders older than 2 days", "1001 - $55.54 #1002"),
    });
    expect(v.cliente).toBe(false);
  });

  it("scarta le offerte delle agenzie da indirizzi gmail veri", () => {
    // Questi due passano ogni filtro sul dominio: il mittente e' una gmail come
    // quella di un cliente. Si riconoscono solo dal testo.
    const v1 = classifica({
      channel: "email",
      handle: "virtuousepics022@gmail.com",
      testo: daInbox("New Google message", "If I help you generate 30-50 additional orders by fixing conversion issues on your store"),
    });
    const v2 = classifica({
      channel: "email",
      handle: "proawelewa18@gmail.com",
      testo: daInbox("Nuovo messaggio", "Potresti darmi il 2% se porto 30-50 ordini? Qual e' il miglior numero WhatsApp"),
    });
    expect(v1.cliente).toBe(false);
    expect(v2.cliente).toBe(false);
  });

  it("nel dubbio notifica", () => {
    // La regola che conta: un mittente mai visto passa. Meglio una notifica di
    // troppo che un'altra cliente in banca.
    const v = classifica({ channel: "email", handle: "qualcuno@dominiomaivisto.xyz", testo: "Buongiorno, avrei un problema" });
    expect(v.cliente).toBe(true);
  });
});

describe("testoNotifica", () => {
  it("mette in cima chi ha scritto e per quale ordine", () => {
    const t = testoNotifica({
      channel: "email",
      handle: "naomirotensen@hotmail.com",
      nome: "Naomi Rotensen",
      testo: "I want to return it. My order number is #1263.",
      conversationId: 42,
    });
    expect(t).toContain("Naomi Rotensen");
    expect(t).toContain("#1263");
    expect(t).toContain("Email");
    expect(t).toContain("42");
  });

  it("non rompe l'HTML di Telegram con i caratteri speciali", () => {
    const t = testoNotifica({ channel: "email", handle: "a@b.c", nome: "Tom <script>", testo: "5 < 6 & 7 > 2" });
    expect(t).not.toContain("<script>");
    expect(t).toContain("&lt;script&gt;");
    expect(t).toContain("&amp;");
  });
});

describe("ordiniCitati", () => {
  it("trova gli ordini e non li ripete", () => {
    expect(ordiniCitati("ordine #1263, di nuovo #1263 e poi #1261")).toEqual(["#1263", "#1261"]);
  });
  it("ignora i numeri che non sono ordini", () => {
    expect(ordiniCitati("costa 55.90 euro, taglia S")).toEqual([]);
  });
});
