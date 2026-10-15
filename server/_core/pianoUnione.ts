// L'UNIONE PER BLOCCO (app 0.9.227). STESSO FILE in notion-clone-studio
// (src/components/notion/unione.ts) e nel server (meta-ai-media-buyer server/_core/pianoUnione.ts):
// se lo cambi in uno, copialo nell'altro.
//
// Prima due copie del quaderno si univano per PAGINA: vinceva la pagina modificata per ultima.
// Con Notion collegato non basta: la «To do list» e' una pagina sola da duemila blocchi, e una
// modifica arrivata da Notion veniva coperta dalla prossima riga scritta sul telefono nella stessa
// pagina. Ora:
//   - ogni blocco ha `mod`, l'ora in cui e' cambiato il SUO contenuto (timbra, a ogni modifica);
//   - ogni pagina ha `tomb`, i blocchi cancellati con l'ora (si tengono 30 giorni);
//   - per lo stesso blocco vince il `mod` piu' recente; l'ordine e i genitori vengono dalla copia con
//     la pagina modificata per ultima; i blocchi che ha solo l'altra copia si infilano dopo il loro
//     fratello di prima;
//   - `nid` (l'ID del blocco in Notion) non si perde mai: se la copia che vince non ce l'ha, lo prende
//     dall'altra.

export type BloccoU = { id: number; mod?: number | undefined; nid?: string | undefined; children?: BloccoU[] | undefined; [k: string]: unknown };
export type PaginaU = { id: string; mod?: number | undefined; blocks?: BloccoU[] | undefined; tomb?: Record<string, number> | undefined; [k: string]: unknown };
export type QuadernoU = { pages: PaginaU[]; trash?: PaginaU[]; favorites?: string[]; [k: string]: unknown };

const TRENTA_GIORNI = 30 * 24 * 3600 * 1000;
// quello che di un blocco NON e' contenuto: lo stato a schermo e i dati della sincronizzazione
const FUORI = new Set(['id', 'children', 'mod', 'nid', 'open', 'tabSel']);

/** Il contenuto di un blocco, figli esclusi: due blocchi con la stessa firma dicono la stessa cosa. */
export function firma(b: BloccoU): string {
  const o: Record<string, unknown> = {};
  Object.keys(b).sort().forEach(k => { if (!FUORI.has(k) && b[k] !== undefined) o[k] = b[k]; });
  return JSON.stringify(o);
}

function mappa(list: BloccoU[], out = new Map<number, BloccoU>()): Map<number, BloccoU> {
  for (const b of list) { out.set(b.id, b); if (b.children?.length) mappa(b.children, out); }
  return out;
}

/**
 * Dopo una modifica fatta qui: i blocchi nuovi o cambiati prendono `mod = t`, quelli spariti finiscono
 * in `tomb`. I rami non toccati (stesso oggetto di prima) non si guardano nemmeno.
 */
export function timbra(prima: BloccoU[], dopo: BloccoU[], tomb: Record<string, number> | undefined, t: number): { blocks: BloccoU[]; tomb: Record<string, number> | undefined } {
  if (prima === dopo) return { blocks: dopo, tomb };
  const vecchi = mappa(prima);
  const visti = new Set<number>();
  const giro = (list: BloccoU[]): BloccoU[] => list.map(b => {
    visti.add(b.id);
    const v = vecchi.get(b.id);
    if (v === b) { mappa(b.children ?? []).forEach((_, id) => visti.add(id)); return b; }
    const figli = b.children?.length ? giro(b.children) : b.children;
    const cambiato = !v || firma(v) !== firma(b);
    if (!cambiato && figli === b.children) return b;
    return { ...b, ...(figli !== b.children ? { children: figli } : {}), ...(cambiato ? { mod: t } : {}) };
  });
  const blocks = giro(dopo);
  let nt = tomb;
  vecchi.forEach((_, id) => { if (!visti.has(id)) { nt = { ...(nt ?? {}) }; nt[String(id)] = t; } });
  return { blocks, tomb: nt };
}

const ora = (b: { mod?: number | undefined } | undefined) => b?.mod ?? 0;

type Posto = { padre: number | null; prima: number | null };
function posti(list: BloccoU[], padre: number | null, out = new Map<number, Posto>()): Map<number, Posto> {
  list.forEach((b, i) => { out.set(b.id, { padre, prima: i ? list[i - 1]!.id : null }); if (b.children?.length) posti(b.children, b.id, out); });
  return out;
}

/** Due copie della stessa pagina diventano una, blocco per blocco. */
export function unisciPagina(a: PaginaU, b: PaginaU, adesso = Date.now()): PaginaU {
  const base = ora(b) > ora(a) ? b : a;
  const altra = base === a ? b : a;
  const tomb: Record<string, number> = {};
  [a.tomb, b.tomb].forEach(tb => Object.entries(tb ?? {}).forEach(([id, t]) => { if (adesso - t < TRENTA_GIORNI && (tomb[id] ?? 0) < t) tomb[id] = t; }));
  const mb = mappa(base.blocks ?? []);
  const ma = mappa(altra.blocks ?? []);
  const viva = (x: BloccoU) => { const t = tomb[String(x.id)]; return t === undefined || ora(x) > t; };
  const messi = new Set<number>();
  // la struttura della base, con il contenuto piu' recente di ogni blocco
  const giro = (list: BloccoU[]): BloccoU[] => {
    const out: BloccoU[] = [];
    for (const x of list) {
      if (messi.has(x.id)) continue;
      const y = ma.get(x.id);
      let v: BloccoU = y && ora(y) > ora(x) ? { ...y, children: x.children } : x;
      if (!viva(v)) continue;
      if (!v.nid && y?.nid) v = { ...v, nid: y.nid };
      messi.add(v.id);
      const figli = v.children?.length ? giro(v.children) : v.children;
      out.push(figli !== v.children ? { ...v, children: figli } : v);
    }
    return out;
  };
  let blocks = giro(base.blocks ?? []);
  // i blocchi che conosce solo l'altra copia (nuovi di la'), con i loro figli
  const pa = posti(altra.blocks ?? [], null);
  const copia = (x: BloccoU): BloccoU | null => {
    if (messi.has(x.id) || mb.has(x.id) || !viva(x)) return null;
    messi.add(x.id);
    const figli = (x.children ?? []).map(copia).filter((c): c is BloccoU => !!c);
    return x.children ? { ...x, children: figli } : { ...x };
  };
  const inserisci = (list: BloccoU[], padre: number | null, nb: BloccoU, dopoId: number | null): { list: BloccoU[]; ok: boolean } => {
    if (padre === null) {
      const i = dopoId === null ? -1 : list.findIndex(z => z.id === dopoId);
      if (dopoId !== null && i < 0) return { list, ok: false };
      const l = [...list]; l.splice(i + 1, 0, nb); return { list: l, ok: true };
    }
    let ok = false;
    const l = list.map(z => {
      if (ok) return z;
      if (z.id === padre) {
        const r = inserisci(z.children ?? [], null, nb, dopoId);
        if (!r.ok) { const c = [...(z.children ?? [])]; c.push(nb); ok = true; return { ...z, children: c }; }
        ok = true; return { ...z, children: r.list };
      }
      if (z.children?.length) { const r = inserisci(z.children, padre, nb, dopoId); if (r.ok) { ok = true; return { ...z, children: r.list }; } }
      return z;
    });
    return { list: ok ? l : list, ok };
  };
  const visita = (list: BloccoU[]) => {
    for (const x of list) {
      if (!mb.has(x.id) && !messi.has(x.id)) {
        const nb = copia(x);
        if (nb) {
          const p = pa.get(x.id) ?? { padre: null, prima: null };
          let r = inserisci(blocks, p.padre, nb, p.prima);
          if (!r.ok && p.padre !== null) r = inserisci(blocks, p.padre, nb, null);
          blocks = r.ok ? r.list : [...blocks, nb];
        }
        continue; // i figli sono gia' andati con lui
      }
      if (x.children?.length) visita(x.children);
    }
  };
  visita(altra.blocks ?? []);
  const out: PaginaU = { ...base, blocks, mod: Math.max(ora(a), ora(b)) };
  if (Object.keys(tomb).length) out.tomb = tomb; else delete out.tomb;
  // le impostazioni di Notion della pagina (a quale pagina e' agganciata) non si perdono
  if (!out['notion'] && altra['notion']) { out['notion'] = altra['notion']; out['notionAt'] = altra['notionAt']; }
  return out;
}

/**
 * Le due copie del quaderno diventano una. `qui` decide l'ordine delle pagine e le impostazioni.
 * Se una delle due copie viene da un'app di prima (senza `uv: 2`), le pagine si uniscono ancora
 * intere: senza le ore dei blocchi e i cancellati, l'unione per blocco farebbe tornare le righe tolte.
 */
export function unisciQuaderni<S extends QuadernoU>(qui: S, la: S, adesso = Date.now()): S {
  const perBlocco = qui['uv'] === 2 && la['uv'] === 2;
  const tutte = new Map<string, PaginaU>();
  const cestino = new Map<string, PaginaU>();
  [...(qui.trash ?? []), ...(la.trash ?? [])].forEach(p => { const x = cestino.get(p.id); if (!x || ora(p) > ora(x)) cestino.set(p.id, p); });
  [...qui.pages, ...la.pages].forEach(p => {
    const x = tutte.get(p.id);
    if (!x) { tutte.set(p.id, p); return; }
    if (perBlocco) tutte.set(p.id, unisciPagina(x, p, adesso));
    else if (ora(p) > ora(x)) tutte.set(p.id, p);
  });
  // una pagina buttata dopo l'ultima modifica resta nel cestino
  cestino.forEach((p, id) => { const v = tutte.get(id); if (v && ora(p) >= ora(v)) tutte.delete(id); else if (v) cestino.delete(id); });
  // 0.9.226: l'ordine delle pagine (trascinate nella barra) e i preferiti (anche quelli tolti) sono
  // quelli della copia che li ha cambiati per ultima
  const n = (x: unknown) => Number(x) || 0;
  const prima = n(la['ordineAt']) > n(qui['ordineAt']) ? [la, qui] : [qui, la];
  const ordine = [...prima[0]!.pages.map(p => p.id), ...prima[1]!.pages.map(p => p.id)].filter((id, i, a) => a.indexOf(id) === i && tutte.has(id));
  const fav = n(la['favAt']) > n(qui['favAt']) ? la.favorites ?? [] : n(qui['favAt']) > n(la['favAt']) ? qui.favorites ?? [] : [...(qui.favorites ?? []), ...(la.favorites ?? [])];
  const pref = fav.filter((id, i, a) => a.indexOf(id) === i && tutte.has(id));
  // 0.9.271: le righe mandate al caveau dal sito (sul computer il caveau non c'e': sta nell'app). Si uniscono per
  // id da tutte e due le copie; quelle che l'app ha gia' messo nel caveau (caveauDati: id -> ora) non tornano.
  const dati: Record<string, number> = {};
  [qui, la].forEach(q => Object.entries((q['caveauDati'] as Record<string, number> | undefined) ?? {}).forEach(([id, t]) => { if (adesso - t < TRENTA_GIORNI && (dati[id] ?? 0) < t) dati[id] = t; }));
  const inArrivo = new Map<string, { id: string; t: string; at: number }>();
  [qui, la].forEach(q => ((q['caveauIn'] as { id: string; t: string; at: number }[] | undefined) ?? []).forEach(x => { if (x && x.id && !dati[x.id] && adesso - (x.at || 0) < TRENTA_GIORNI) inArrivo.set(x.id, x); }));
  const caveau = { caveauIn: Array.from(inArrivo.values()), caveauDati: dati };
  return { ...qui, ...caveau, pages: ordine.map(id => tutte.get(id)!), trash: Array.from(cestino.values()), favorites: pref, ordineAt: Math.max(n(qui['ordineAt']), n(la['ordineAt'])), favAt: Math.max(n(qui['favAt']), n(la['favAt'])), uv: perBlocco ? 2 : qui['uv'] } as S;
}
