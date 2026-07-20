/**
 * Brain client — collega l'agente di ricerca prodotto al DreamBrothers Brain.
 *
 * Il generatore di picks (e chiunque debba ragionare "come il brand") prende da qui il
 * contesto brand. Ordine delle fonti:
 *   1) LIVE dal Brain via MCP HTTP  (env BRAIN_MCP_URL → il server VPS del Brain, 6 tool)
 *   2) override salvato in settings  (market_brand_context, editabile)
 *   3) BRAND_DNA embedded             (estratto REALE dal Brain: Meccanismo Unico + USP + avatar)
 * Non si blocca mai: se il live fallisce, cade sul DNA embedded.
 */

// ── DNA reale del brand (fonte: Brain — brand-identity.md, meccanismo-unico.md) ──
export const BRAND_DNA = `DREAMBROTHERS — DNA DI BRAND (fonte: company Brain)
MISSIONE: non vende poster; arma un movimento di dreamers e anticonformisti perché diventino l'EROE della propria storia. Costruire la più grande community di sognatori.
CATEGORIA: Wall Art + Streetwear (DREAM HOME "eleva il tuo spazio" + DREAM YOU/DREAM OUTFIT "vesti la tua visione").
USP (one-liner): "L'unico brand al mondo che unisce il potere dell'arte da parete all'abbigliamento per riprogrammare la mente verso il successo." Eyebrow: ©2026 Wall Art + Streetwear. Headline home: "Shop by Dream".
MECCANISMO UNICO — 3 pilastri: AMBIENTE + IDENTITÀ + AZIONE. Vendiamo i primi due (wall art = ambiente che tiene a fuoco la mente a casa; abbigliamento = identità/armatura fuori); l'AZIONE la mette il cliente. Problema latente: l'INCOERENZA tra ciò che vedi in camera e ciò che proietti fuori. Perché nessuno copia: i fashion brand temono che i quadri inquinino l'immagine, i wall-art brand temono la logistica taglie.
BASE SCIENTIFICA (permesso razionale, mai hook a freddo): Enclothed Cognition (Adam & Galinsky 2012); le auto-affermazioni attivano la corteccia prefrontale ventromediale.
REGOLA DI INTEGRITÀ (non negoziabile): MAI false claims / promesse magiche. Un poster non "ti cambia la vita": è un PROMEMORIA IDENTITARIO quotidiano (vision board). Frame = costanza, non miracoli.
AVATAR: (1) Money Game — uomo 18-30 money-mindset/grinta; (2) Aurora — donna 22-32 "la Sognatrice in Divenire" (Meta/Pinterest); (3) Sognatrice Sensibile — donna 20-40, rifugio/Neverland (da cliente reale Brittney).
LEVE: unicità > raro; anti-mediocrità ("for souls who refuse average"); appartenenza dreamer; identity cue; personalizzazione = leva con più entusiasmo/passaparola. Motto: SIC PARVIS MAGNA.
MANIFESTO HOME: nessuna formula magica — allinea AMBIENTE, IDENTITÀ e AZIONE e agire diventa l'unica scelta possibile.
FALLBACK GOAL (backend, minore brand-fit ma domanda reale): regalo a una persona cara; commemorare un momento (city/star map, soundwave). Restano secondari, MAI l'hero.`;

// ── Live fetch via Brain MCP HTTP (best-effort; attivo solo se BRAIN_MCP_URL è settato) ──
async function brainRead(baseUrl: string, path: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(process.env.BRAIN_MCP_SECRET ? { "x-brain-secret": process.env.BRAIN_MCP_SECRET } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "brain_read", arguments: { path } } }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const text = await r.text();
    // supporta risposta JSON o SSE (event-stream)
    const jsonLine = text.includes("data:") ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("") : text;
    const body = JSON.parse(jsonLine);
    const content = body?.result?.content;
    if (Array.isArray(content)) return content.map((c: any) => c?.text ?? "").join("\n").trim() || null;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Contesto brand da usare nel ragionamento dell'agente. `override` = eventuale market_brand_context salvato. */
export async function getBrandContext(override?: string): Promise<string> {
  const url = process.env.BRAIN_MCP_URL;
  if (url) {
    const [id, um] = await Promise.all([
      brainRead(url, "areas/business/brand-identity.md"),
      brainRead(url, "concepts/meccanismo-unico.md"),
    ]);
    const live = [id, um].filter(Boolean).join("\n\n").trim();
    if (live.length > 200) return live.slice(0, 8000);
  }
  if (override && override.trim().length > 200) return override.trim();
  return BRAND_DNA;
}
