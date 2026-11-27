import { describe, expect, it, vi } from "vitest";
import {
  createGraphClient, pianoInstagram, componiCaption, pubblicaInstagram, pubblicaFacebook,
  attendiContenitore, controllaToken, pulisci, ErrorePubblicazione, type GraphClient, type PostDaPubblicare,
} from "./socialPublish";
import {
  cicloPubblicazione, leggiAsset, mediaPerMeta, verificaLinkMedia, linkMedia, MAX_TENTATIVI,
  ATTESA_TRA_TENTATIVI_MS, type BozzaInCoda, type DepsCiclo,
} from "./socialPublishStore";

const TOKEN = "EAAG-segretissimo-123";
const IMG = (n: number) => ({ url: `https://hub.test/api/social/media/1/${n}`, tipo: "image" as const });
const post = (over: Partial<PostDaPubblicare> = {}): PostDaPubblicare => ({
  platform: "instagram", format: "post", caption: "Ciao", hashtags: "#dream #brothers", media: [IMG(0)], ...over,
});

/** Graph API finta: registra ogni chiamata e risponde con quello che gli diciamo. */
function grafoFinto(risposte: (metodo: string, path: string, params: Record<string, string>) => unknown) {
  const chiamate: Array<{ metodo: string; path: string; params: Record<string, string> }> = [];
  const graph: GraphClient = {
    async get(path, params = {}) { chiamate.push({ metodo: "GET", path, params }); return risposte("GET", path, params) as any; },
    async post(path, params = {}) { chiamate.push({ metodo: "POST", path, params }); return risposte("POST", path, params) as any; },
  };
  return { graph, chiamate };
}

const finito = () => ({ status_code: "FINISHED" });
const noSleep = { sleep: async () => {}, intervalloMs: 0 };

describe("createGraphClient", () => {
  it("POST: token nel corpo, mai nell'URL", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: "c1" }) }));
    const g = createGraphClient(TOKEN, { fetchImpl, version: "v23.0" });
    await g.post("/17841/media", { image_url: "https://x/y.jpg", caption: "ciao" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; method: string }];
    expect(url).toBe("https://graph.facebook.com/v23.0/17841/media");
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body);
    expect(body.get("access_token")).toBe(TOKEN);
    expect(body.get("image_url")).toBe("https://x/y.jpg");
  });

  it("GET: token nell'header Authorization, non nella query", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status_code: "FINISHED" }) }));
    const g = createGraphClient(TOKEN, { fetchImpl });
    await g.get("/c1", { fields: "status_code" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).not.toContain(TOKEN);
    expect(url).toContain("fields=status_code");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("un errore Meta che contiene il token non lo fa uscire", async () => {
    const fetchImpl = async () => ({
      ok: false, status: 400,
      json: async () => ({ error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } }),
    });
    const g = createGraphClient(TOKEN, { fetchImpl });
    const e = await g.post("/x/media", {}).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorePubblicazione);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).toMatch(/Token Meta scaduto/);
    expect(e.definitivo).toBe(true);
  });

  it("limite di frequenza: non definitivo, si riprova", async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 4, message: "Application request limit reached" } }) });
    const e = await createGraphClient(TOKEN, { fetchImpl }).post("/x", {}).catch((x) => x);
    expect(e.definitivo).toBe(false);
  });

  it("pulisci toglie il token ovunque", () => {
    expect(pulisci(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe("a [token] b [token]");
  });
});

describe("componiCaption", () => {
  it("unisce caption e hashtag", () => {
    expect(componiCaption("Ciao", "#a #b", "instagram")).toBe("Ciao\n\n#a #b");
  });
  it("rifiuta prima di chiamare Meta una caption oltre 2200 caratteri", () => {
    expect(() => componiCaption("x".repeat(2201), null, "instagram")).toThrow(/troppo lunga/);
  });
  it("rifiuta piu' di 30 hashtag su Instagram, non su Facebook", () => {
    const tag = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(() => componiCaption("ok", tag, "instagram")).toThrow(/Troppi hashtag/);
    expect(componiCaption("ok", tag, "facebook")).toContain("#t30");
  });
});

describe("pianoInstagram", () => {
  it("una immagine = contenitore con image_url e caption", () => {
    const p = pianoInstagram(post());
    expect(p).toEqual({ tipo: "image", contenitore: { image_url: IMG(0).url, caption: "Ciao\n\n#dream #brothers" } });
  });

  it("piu' immagini = carosello: figli is_carousel_item senza caption, caption sul padre", () => {
    const p = pianoInstagram(post({ media: [IMG(0), IMG(1), IMG(2)] }));
    if (p.tipo !== "carousel") throw new Error("atteso carosello");
    expect(p.figli).toEqual([0, 1, 2].map((n) => ({ image_url: IMG(n).url, is_carousel_item: "true" })));
    expect(p.contenitore).toEqual({ media_type: "CAROUSEL", caption: "Ciao\n\n#dream #brothers" });
  });

  it("un video = Reel", () => {
    const p = pianoInstagram(post({ media: [{ url: "https://cdn/v.mp4", tipo: "video" }] }));
    expect(p).toEqual({ tipo: "reel", contenitore: { media_type: "REELS", video_url: "https://cdn/v.mp4", caption: "Ciao\n\n#dream #brothers" } });
  });

  it("formato storia = STORIES senza caption", () => {
    const p = pianoInstagram(post({ format: "story" }));
    expect(p).toEqual({ tipo: "story", contenitore: { media_type: "STORIES", image_url: IMG(0).url } });
  });

  it("errori definitivi: niente asset, oltre 20 immagini, video piu' immagini", () => {
    expect(() => pianoInstagram(post({ media: [] }))).toThrow(/senza immagine/);
    expect(() => pianoInstagram(post({ media: Array.from({ length: 21 }, (_, i) => IMG(i)) }))).toThrow(/al massimo 20/);
    expect(() => pianoInstagram(post({ media: [IMG(0), { url: "https://v.mp4", tipo: "video" }] }))).toThrow(/Reel/);
  });
});

describe("pubblicaInstagram", () => {
  it("immagine singola: /media → status → /media_publish → permalink", async () => {
    const { graph, chiamate } = grafoFinto((m, path) => {
      if (m === "POST" && path === "/IG/media") return { id: "C1" };
      if (m === "GET" && path === "/C1") return finito();
      if (m === "POST" && path === "/IG/media_publish") return { id: "M1" };
      if (m === "GET" && path === "/M1") return { permalink: "https://instagram.com/p/abc" };
      throw new Error(`chiamata inattesa ${m} ${path}`);
    });
    const r = await pubblicaInstagram(graph, "IG", post(), noSleep);
    expect(r).toEqual({ postId: "M1", permalink: "https://instagram.com/p/abc" });
    expect(chiamate.map((c) => `${c.metodo} ${c.path}`)).toEqual([
      "POST /IG/media", "GET /C1", "POST /IG/media_publish", "GET /M1",
    ]);
    expect(chiamate[2].params).toEqual({ creation_id: "C1" });
  });

  it("carosello: un figlio per immagine, poi il padre con children in ordine", async () => {
    let n = 0;
    const { graph, chiamate } = grafoFinto((m, path, params) => {
      if (m === "POST" && path === "/IG/media") return { id: params.is_carousel_item ? `F${n++}` : "P1" };
      if (m === "GET" && path === "/M9") return { permalink: "https://instagram.com/p/car" };
      if (m === "GET") return finito();
      if (path === "/IG/media_publish") return { id: "M9" };
      throw new Error("inattesa");
    });
    await pubblicaInstagram(graph, "IG", post({ media: [IMG(0), IMG(1)] }), noSleep);
    const padre = chiamate.find((c) => c.params.media_type === "CAROUSEL")!;
    expect(padre.params.children).toBe("F0,F1");
    expect(chiamate.find((c) => c.path === "/IG/media_publish")!.params.creation_id).toBe("P1");
  });

  it("Reel: aspetta finche' status_code e' FINISHED", async () => {
    const stati = ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"];
    const sleep = vi.fn(async () => {});
    const { graph } = grafoFinto((m, path) => {
      if (m === "POST" && path === "/IG/media") return { id: "R1" };
      if (m === "GET" && path === "/R1") return { status_code: stati.shift() };
      if (path === "/IG/media_publish") return { id: "M2" };
      return {};
    });
    const r = await pubblicaInstagram(graph, "IG", post({ media: [{ url: "https://cdn/v.mp4", tipo: "video" }] }), { sleep, intervalloMs: 1 });
    expect(r.postId).toBe("M2");
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("contenitore in ERROR: non pubblica e spiega perche'", async () => {
    const { graph, chiamate } = grafoFinto((m, path) => {
      if (m === "POST" && path === "/IG/media") return { id: "C1" };
      if (m === "GET") return { status_code: "ERROR", status: "Error: aspect ratio not supported" };
      return {};
    });
    await expect(pubblicaInstagram(graph, "IG", post(), noSleep)).rejects.toThrow(/aspect ratio/);
    expect(chiamate.some((c) => c.path === "/IG/media_publish")).toBe(false);
  });

  it("video ancora in elaborazione dopo i tentativi: errore non definitivo", async () => {
    const { graph } = grafoFinto(() => ({ status_code: "IN_PROGRESS", id: "R1" }));
    const e = await attendiContenitore(graph, "R1", { ...noSleep, tentativi: 3 }).catch((x) => x);
    expect(e).toBeInstanceOf(ErrorePubblicazione);
    expect(e.definitivo).toBe(false);
  });

  it("rete caduta proprio su media_publish: esito incerto, definitivo (niente doppioni)", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (m === "POST" && path === "/IG/media") return { id: "C1" };
      if (m === "GET") return finito();
      if (path === "/IG/media_publish") throw new TypeError("fetch failed");
      return {};
    });
    const e = await pubblicaInstagram(graph, "IG", post(), noSleep).catch((x) => x);
    expect(e.message).toMatch(/Esito incerto/);
    expect(e.definitivo).toBe(true);
  });

  it("permalink non disponibile: il post resta pubblicato", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (m === "POST" && path === "/IG/media") return { id: "C1" };
      if (m === "GET" && path === "/C1") return finito();
      if (path === "/IG/media_publish") return { id: "M1" };
      throw new ErrorePubblicazione("boom");
    });
    expect(await pubblicaInstagram(graph, "IG", post(), noSleep)).toEqual({ postId: "M1", permalink: null });
  });
});

describe("pubblicaFacebook", () => {
  const fb = (over: Partial<PostDaPubblicare> = {}) => post({ platform: "facebook", ...over });

  it("solo testo → /feed con message", async () => {
    const { graph, chiamate } = grafoFinto((m, path) =>
      path === "/PAGE/feed" ? { id: "PAGE_1" } : { permalink_url: "https://facebook.com/PAGE_1" });
    const r = await pubblicaFacebook(graph, "PAGE", fb({ media: [] }));
    expect(chiamate[0]).toEqual({ metodo: "POST", path: "/PAGE/feed", params: { message: "Ciao\n\n#dream #brothers" } });
    expect(r).toEqual({ postId: "PAGE_1", permalink: "https://facebook.com/PAGE_1" });
  });

  it("una foto → /photos con url e message, id = post_id", async () => {
    const { graph, chiamate } = grafoFinto((m, path) =>
      path === "/PAGE/photos" ? { id: "PHOTO", post_id: "PAGE_2" } : { permalink_url: "https://fb/2" });
    const r = await pubblicaFacebook(graph, "PAGE", fb());
    expect(chiamate[0].params).toEqual({ url: IMG(0).url, message: "Ciao\n\n#dream #brothers" });
    expect(r.postId).toBe("PAGE_2");
  });

  it("piu' foto → caricate non pubblicate, poi un solo /feed con attached_media", async () => {
    let n = 0;
    const { graph, chiamate } = grafoFinto((m, path) => {
      if (path === "/PAGE/photos") return { id: `PH${n++}` };
      if (path === "/PAGE/feed") return { id: "PAGE_3" };
      return {};
    });
    await pubblicaFacebook(graph, "PAGE", fb({ media: [IMG(0), IMG(1)] }));
    expect(chiamate.filter((c) => c.path === "/PAGE/photos").every((c) => c.params.published === "false")).toBe(true);
    const feed = chiamate.find((c) => c.path === "/PAGE/feed")!;
    expect(feed.params["attached_media[0]"]).toBe(JSON.stringify({ media_fbid: "PH0" }));
    expect(feed.params["attached_media[1]"]).toBe(JSON.stringify({ media_fbid: "PH1" }));
  });
});

describe("controllaToken", () => {
  it("segnala i permessi mancanti e il token non di Pagina", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (path === "/debug_token") return { data: { is_valid: true, type: "USER", scopes: ["instagram_basic", "pages_read_engagement"], expires_at: 0 } };
      return { name: "DreamBrothers", instagram_business_account: { id: "IG1", username: "dreambrothers" } };
    });
    const s = await controllaToken(graph, TOKEN, "PAGE");
    expect(s.permessiMancanti).toEqual(["instagram_content_publish", "pages_manage_posts"]);
    expect(s.problemi.join(" ")).toMatch(/tipo USER/);
    expect(s.scadeIl).toBeNull();
    expect(s.igUsername).toBe("dreambrothers");
  });

  it("token di Pagina completo: nessun problema, pageId dal token", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (path === "/debug_token") return { data: { is_valid: true, type: "PAGE", profile_id: "PAGE9", expires_at: 0,
        scopes: ["instagram_basic", "instagram_content_publish", "pages_manage_posts", "pages_read_engagement", "pages_show_list"] } };
      if (path === "/PAGE9") return { name: "DreamBrothers", instagram_business_account: { id: "IG1" } };
      throw new Error(path);
    });
    const s = await controllaToken(graph, TOKEN, null);
    expect(s.problemi).toEqual([]);
    expect(s.pageId).toBe("PAGE9");
    expect(s.igUserId).toBe("IG1");
  });

  it("debug_token rifiutato: controlla lo stesso la Pagina e chiede il token d'app", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (path === "/debug_token") throw new ErrorePubblicazione("Meta 100: must be app token");
      return { name: "DreamBrothers", instagram_business_account: { id: "IG1", username: "dreambrothers" } };
    });
    const s = await controllaToken(graph, TOKEN, "PAGE");
    expect(s.valido).toBe(true);
    expect(s.igUsername).toBe("dreambrothers");
    expect(s.problemi.join(" ")).toMatch(/META_APP_ID/);
  });

  it("usa il client col token d'app per debug_token quando c'e'", async () => {
    const pagina = grafoFinto(() => ({ name: "DB", instagram_business_account: { id: "IG1" } }));
    const app = grafoFinto(() => ({ data: { is_valid: true, type: "PAGE", scopes: ["instagram_basic", "instagram_content_publish", "pages_manage_posts", "pages_read_engagement"] } }));
    const s = await controllaToken(pagina.graph, TOKEN, "PAGE", { graphDebug: app.graph });
    expect(app.chiamate.map((c) => c.path)).toEqual(["/debug_token"]);
    expect(pagina.chiamate.map((c) => c.path)).toEqual(["/PAGE"]);
    expect(s.problemi).toEqual([]);
  });

  it("Pagina senza Instagram collegato", async () => {
    const { graph } = grafoFinto((m, path) => path === "/debug_token"
      ? { data: { is_valid: true, type: "PAGE", scopes: ["instagram_basic", "instagram_content_publish", "pages_manage_posts", "pages_read_engagement"] } }
      : { name: "Pagina nuova" });
    const s = await controllaToken(graph, TOKEN, "P");
    expect(s.problemi.join(" ")).toMatch(/non ha un account Instagram/);
  });
});

describe("asset e link firmati", () => {
  it("legge tutte le forme della colonna assets", () => {
    expect(leggiAsset(null)).toEqual([]);
    expect(leggiAsset("data:image/png;base64,AAAA")).toEqual([{ src: "data:image/png;base64,AAAA", tipo: "image" }]);
    expect(leggiAsset(JSON.stringify(["https://a/1.png", "https://a/v.mp4"]))).toEqual([
      { src: "https://a/1.png", tipo: "image" }, { src: "https://a/v.mp4", tipo: "video" },
    ]);
    expect(leggiAsset(JSON.stringify([{ url: "https://a/x", type: "video" }, { src: "data:image/jpeg;base64,BB" }, { nota: "x" }]))).toEqual([
      { src: "https://a/x", tipo: "video" }, { src: "data:image/jpeg;base64,BB", tipo: "image" },
    ]);
  });

  it("immagini sempre dal nostro endpoint (JPEG), video https diretti", () => {
    process.env.PUBLIC_BASE_URL = "https://hub.test";
    process.env.CARE_WEBHOOK_SECRET = "s3cret";
    const m = mediaPerMeta(7, [{ src: "data:image/png;base64,AA", tipo: "image" }, { src: "https://cdn/v.mp4", tipo: "video" }], 1000);
    expect(m[0].url).toMatch(/^https:\/\/hub\.test\/api\/social\/media\/7\/0\?exp=\d+&sig=[0-9a-f]{32}$/);
    expect(m[1]).toEqual({ url: "https://cdn/v.mp4", tipo: "video" });
  });

  it("la firma vale solo per quella bozza, quell'asset e prima della scadenza", () => {
    process.env.PUBLIC_BASE_URL = "https://hub.test";
    process.env.CARE_WEBHOOK_SECRET = "s3cret";
    const u = new URL(linkMedia(7, 0, 1000));
    const exp = u.searchParams.get("exp")!;
    const sig = u.searchParams.get("sig")!;
    expect(verificaLinkMedia(7, 0, exp, sig, 2000)).toBe(true);
    expect(verificaLinkMedia(8, 0, exp, sig, 2000)).toBe(false);
    expect(verificaLinkMedia(7, 1, exp, sig, 2000)).toBe(false);
    expect(verificaLinkMedia(7, 0, exp, "0".repeat(32), 2000)).toBe(false);
    expect(verificaLinkMedia(7, 0, exp, sig, Number(exp) + 1)).toBe(false);
  });
});

// ─── Scheduler con DB e Graph API finti ──────────────────────────────────────

function dbFinto(bozze: BozzaInCoda[], pubblica: DepsCiclo["pubblica"], ora = new Date("2026-12-01T10:00:00Z")) {
  const stato = new Map(bozze.map((b) => [b.id, { ...b, pubblicata: null as null | { postId: string; permalink: string | null }, errore: null as string | null, prenotata: false }]));
  const deps: DepsCiclo = {
    now: () => ora,
    inCoda: async () => Array.from(stato.values()).filter((b) => !b.pubblicata).map((b) => ({ ...b })),
    prenota: async (id) => {
      const b = stato.get(id)!;
      if (b.prenotata || b.pubblicata) return false;
      b.prenotata = true;
      return true;
    },
    pubblica,
    segnaPubblicata: async (id, e) => { const b = stato.get(id)!; b.pubblicata = e; b.prenotata = false; },
    segnaErrore: async (id, msg, t) => { const b = stato.get(id)!; b.errore = msg; b.publishAttempts = t; b.prenotata = false; b.publishLastAttemptAt = ora; },
  };
  return { deps, stato };
}

const inCoda = (id: number, over: Partial<BozzaInCoda> = {}): BozzaInCoda => ({
  id, platform: "instagram", publishAttempts: 0, publishLastAttemptAt: null, publishingStartedAt: null, ...over,
});

describe("cicloPubblicazione", () => {
  it("pubblica le bozze in coda e salva id e permalink", async () => {
    const { deps, stato } = dbFinto([inCoda(1), inCoda(2, { platform: "facebook" })],
      async (id) => ({ postId: `P${id}`, permalink: `https://link/${id}` }));
    const r = await cicloPubblicazione(deps);
    expect(r.pubblicate).toEqual([1, 2]);
    expect(stato.get(1)!.pubblicata).toEqual({ postId: "P1", permalink: "https://link/1" });
  });

  it("errore temporaneo: resta in coda con l'errore leggibile e un tentativo in piu'", async () => {
    const { deps, stato } = dbFinto([inCoda(1)], async () => { throw new ErrorePubblicazione("Meta 2: servizio non disponibile"); });
    const r = await cicloPubblicazione(deps);
    expect(r.fallite).toEqual([1]);
    expect(stato.get(1)!.publishAttempts).toBe(1);
    expect(stato.get(1)!.errore).toBe("Meta 2: servizio non disponibile");
    expect(stato.get(1)!.pubblicata).toBeNull();
  });

  it("al massimo 3 tentativi, con attesa crescente fra uno e l'altro", async () => {
    const pubblica = vi.fn(async () => { throw new ErrorePubblicazione("giu'"); });
    let ora = new Date("2026-12-01T10:00:00Z");
    const { deps, stato } = dbFinto([inCoda(1)], pubblica);
    deps.now = () => ora;
    deps.segnaErrore = async (id, msg, t) => { const b = stato.get(id)!; b.errore = msg; b.publishAttempts = t; b.publishLastAttemptAt = ora; b.prenotata = false; };

    await cicloPubblicazione(deps);                       // tentativo 1
    ora = new Date(ora.getTime() + 5 * 60_000);
    await cicloPubblicazione(deps);                       // troppo presto: saltata
    expect(pubblica).toHaveBeenCalledTimes(1);
    ora = new Date(ora.getTime() + ATTESA_TRA_TENTATIVI_MS);
    await cicloPubblicazione(deps);                       // tentativo 2
    ora = new Date(ora.getTime() + 2 * ATTESA_TRA_TENTATIVI_MS);
    await cicloPubblicazione(deps);                       // tentativo 3
    ora = new Date(ora.getTime() + 10 * ATTESA_TRA_TENTATIVI_MS);
    const r = await cicloPubblicazione(deps);             // fermo: niente quarto tentativo
    expect(pubblica).toHaveBeenCalledTimes(MAX_TENTATIVI);
    expect(r.saltate).toEqual([1]);
    expect(stato.get(1)!.errore).toMatch(/fermata dopo 3 tentativi/);
  });

  it("errore definitivo (permesso mancante): si ferma subito", async () => {
    const pubblica = vi.fn(async () => { throw new ErrorePubblicazione("Permesso mancante", true); });
    const { deps, stato } = dbFinto([inCoda(1)], pubblica);
    await cicloPubblicazione(deps);
    expect(stato.get(1)!.publishAttempts).toBe(MAX_TENTATIVI);
    await cicloPubblicazione(deps);
    expect(pubblica).toHaveBeenCalledTimes(1);
  });

  it("bozza gia' prenotata da un altro giro: non la pubblica due volte", async () => {
    const pubblica = vi.fn(async () => ({ postId: "X", permalink: null }));
    const { deps } = dbFinto([inCoda(1)], pubblica);
    deps.prenota = async () => false;
    const r = await cicloPubblicazione(deps);
    expect(pubblica).not.toHaveBeenCalled();
    expect(r.saltate).toEqual([1]);
  });

  it("pubblicazione interrotta da un riavvio: non riprova, chiede di controllare il profilo", async () => {
    const pubblica = vi.fn(async () => ({ postId: "X", permalink: null }));
    const ora = new Date("2026-12-01T10:00:00Z");
    const { deps, stato } = dbFinto([
      inCoda(1, { publishingStartedAt: new Date(ora.getTime() - 20 * 60_000) }),
      inCoda(2, { publishingStartedAt: new Date(ora.getTime() - 60_000) }),
    ], pubblica, ora);
    const r = await cicloPubblicazione(deps);
    expect(pubblica).not.toHaveBeenCalled();
    expect(r.fallite).toEqual([1]);
    expect(r.saltate).toEqual([2]); // in corso adesso: si lascia stare
    expect(stato.get(1)!.errore).toMatch(/controlla il profilo/);
    expect(stato.get(1)!.publishAttempts).toBe(MAX_TENTATIVI);
  });

  it("end-to-end con Graph API finta: la bozza Instagram arriva a pubblicata", async () => {
    const { graph } = grafoFinto((m, path) => {
      if (path === "/IG/media") return { id: "C1" };
      if (path === "/C1") return finito();
      if (path === "/IG/media_publish") return { id: "M1" };
      if (path === "/M1") return { permalink: "https://instagram.com/p/ok" };
      return {};
    });
    const { deps, stato } = dbFinto([inCoda(1)], (id) => pubblicaInstagram(graph, "IG", post(), noSleep));
    await cicloPubblicazione(deps);
    expect(stato.get(1)!.pubblicata).toEqual({ postId: "M1", permalink: "https://instagram.com/p/ok" });
  });
});

describe("conversione per Instagram (solo JPEG)", () => {
  it("un PNG da data URI diventa un JPEG entro 1440 px", async () => {
    const { scaricaAsset, inJpeg } = await import("./socialPublishStore");
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 2000, height: 2500, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 0.5 } } }).png().toBuffer();
    const { buf, mime } = await scaricaAsset(`data:image/png;base64,${png.toString("base64")}`);
    expect(mime).toBe("image/png");
    const jpg = await inJpeg(buf);
    const meta = await sharp(jpg).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(1440);
    expect(meta.height).toBeLessThanOrEqual(1800);
    expect(meta.hasAlpha).toBe(false);
  });
});
