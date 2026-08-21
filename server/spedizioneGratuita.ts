/**
 * Spedizione gratuita in tutto il mondo — presidio automatico.
 *
 * IL PROBLEMA CHE RISOLVE
 * Lo store promette spedizione gratuita ovunque, ma i prodotti Printify non
 * rispettavano la promessa: al checkout uscivano 4,10 € anche in Italia
 * (visto da Andrea il 21/08/2026 sul Leo, 37,90 + 4,10 = 42,00).
 *
 * PERCHE' SUCCEDE
 * La scorta dei prodotti Printify vive su una location di fulfillment ("Printify")
 * che NON sta nel profilo di consegna principale, ma in un profilo creato
 * dall'app, con tariffe a scaglioni (4.79 → 17.84 USD). Shopify quota la
 * spedizione dal profilo che contiene la location della scorta, quindi il capo
 * paga quelle tariffe qualunque cosa dica il profilo generale.
 *
 * ⚠️ LA STRADA CHE SEMBRA GIUSTA E NON LO E'
 * Spostare le varianti sul profilo generale (quello gratis) NON funziona: la
 * location "Printify" e' di un fulfillment service e Shopify si rifiuta di
 * aggiungerla a un altro profilo — senza errore, in silenzio. Il risultato e'
 * un prodotto che risulta "sold out" allo storefront pur essendo attivo
 * nell'admin. Provato sul Leo il 21/08, e ripristinato subito.
 *
 * LA STRADA GIUSTA
 * Lasciare i capi dove sono e AZZERARE le tariffe del loro profilo. Il costo
 * vero della spedizione e' gia' dentro il listino (29,90 / 37,90 lo assorbono,
 * vedi `prezzoApparel` in printify.ts): farlo pagare di nuovo al cliente
 * sarebbe contarlo due volte, oltre che rompere la promessa.
 *
 * Gira dopo ogni pubblicazione, ed e' idempotente: se e' gia' tutto a zero non
 * scrive niente. Serve perche' Printify puo' ricreare o risincronizzare le
 * tariffe quando aggiunge prodotti o cambia fornitore.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

type Metodo = { id: string; rateProvider?: { price?: { amount: string; currencyCode: string } } };
type Zona = { zone: { id: string; name: string }; methodDefinitions: { edges: { node: Metodo }[] } };

function credenziali(): { shop: string; token: string } | null {
  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return null;
  return { shop, token };
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const c = credenziali();
  if (!c) throw new Error("Mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN nelle variabili Railway.");
  const res = await fetch(`https://${c.shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": c.token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const testo = await res.text();
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${testo.slice(0, 300)}`);
  const j = JSON.parse(testo);
  if (j.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(j.errors).slice(0, 300)}`);
  return j.data as T;
}

/** I profili di consegna su cui stanno davvero le varianti di questo prodotto. */
async function profiliDelProdotto(productId: string): Promise<string[]> {
  const d = await gql<{ product: { variants: { edges: { node: { deliveryProfile: { id: string } | null } }[] } } | null }>(
    `query($id: ID!) { product(id: $id) { variants(first: 100) { edges { node {
      deliveryProfile { id } } } } } }`,
    { id: productId },
  );
  if (!d.product) return [];
  const ids = d.product.variants.edges.map(e => e.node.deliveryProfile?.id).filter(Boolean) as string[];
  return Array.from(new Set(ids));
}

/**
 * Porta a zero ogni tariffa di un profilo. Ritorna quante ne ha cambiate.
 *
 * Le zone si paginano perche' i profili degli app di stampa hanno un paese per
 * zona: sul profilo Printify sono oltre sessanta, ciascuna con dodici scaglioni
 * di peso. Si scrive a blocchi di zone per non superare il costo massimo di una
 * singola mutation.
 */
export async function azzeraTariffe(profileId: string, log: (m: string) => void = () => {}): Promise<number> {
  type Risposta = {
    deliveryProfile: {
      name: string;
      profileLocationGroups: {
        locationGroup: { id: string };
        locationGroupZones: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: { node: Zona }[] };
      }[];
    } | null;
  };

  const daSistemare: { gruppo: string; zona: string; metodi: Metodo[] }[] = [];
  let cursore: string | null = null;
  let nome = profileId;

  do {
    const d: Risposta = await gql<Risposta>(
      `query($id: ID!, $c: String) { deliveryProfile(id: $id) { name profileLocationGroups {
        locationGroup { id }
        locationGroupZones(first: 20, after: $c) {
          pageInfo { hasNextPage endCursor }
          edges { node { zone { id name } methodDefinitions(first: 30) { edges { node {
            id rateProvider { ... on DeliveryRateDefinition { price { amount currencyCode } } } } } } } }
        } } } }`,
      { id: profileId, c: cursore },
    );
    if (!d.deliveryProfile) return 0;
    nome = d.deliveryProfile.name;
    const gruppo = d.deliveryProfile.profileLocationGroups[0];
    if (!gruppo) return 0;
    for (const e of gruppo.locationGroupZones.edges) {
      const metodi = e.node.methodDefinitions.edges
        .map(m => m.node)
        .filter(m => Number(m.rateProvider?.price?.amount ?? 0) > 0);
      if (metodi.length) daSistemare.push({ gruppo: gruppo.locationGroup.id, zona: e.node.zone.id, metodi });
    }
    cursore = gruppo.locationGroupZones.pageInfo.hasNextPage ? gruppo.locationGroupZones.pageInfo.endCursor : null;
  } while (cursore);

  const totale = daSistemare.reduce((n, z) => n + z.metodi.length, 0);
  if (!totale) {
    log(`  "${nome}": gia' tutto gratuito.`);
    return 0;
  }
  log(`  "${nome}": ${totale} tariffe a pagamento su ${daSistemare.length} zone, le azzero.`);

  const BLOCCO = 10;
  for (let i = 0; i < daSistemare.length; i += BLOCCO) {
    const blocco = daSistemare.slice(i, i + BLOCCO);
    const r = await gql<{ deliveryProfileUpdate: { userErrors: { message: string }[] } }>(
      `mutation($id: ID!, $p: DeliveryProfileInput!) { deliveryProfileUpdate(id: $id, profile: $p) {
        userErrors { field message } } }`,
      {
        id: profileId,
        p: {
          locationGroupsToUpdate: [{
            id: blocco[0].gruppo,
            zonesToUpdate: blocco.map(z => ({
              id: z.zona,
              methodDefinitionsToUpdate: z.metodi.map(m => ({
                id: m.id,
                active: true,
                rateDefinition: { price: { amount: 0, currencyCode: m.rateProvider!.price!.currencyCode } },
              })),
            })),
          }],
        },
      },
    );
    const err = r.deliveryProfileUpdate.userErrors;
    if (err.length) throw new Error(`azzeramento tariffe: ${err.map(e => e.message).join("; ")}`);
  }
  return totale;
}

/**
 * Garantisce che un prodotto appena pubblicato spedisca gratis ovunque.
 *
 * Non lancia mai: una spedizione a pagamento e' un problema da sistemare, non
 * una ragione per far fallire una pubblicazione andata a buon fine. Se qualcosa
 * va storto lo dice nel log e il prodotto resta pubblicato.
 */
export async function assicuraSpedizioneGratuita(
  productId: string,
  log: (m: string) => void = () => {},
): Promise<{ profili: number; tariffeAzzerate: number } | null> {
  if (!credenziali()) {
    log("Spedizione gratuita non verificata: mancano SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN.");
    return null;
  }
  try {
    const profili = await profiliDelProdotto(productId);
    if (!profili.length) {
      log("Spedizione: nessun profilo di consegna trovato per il prodotto.");
      return null;
    }
    let tariffeAzzerate = 0;
    for (const p of profili) tariffeAzzerate += await azzeraTariffe(p, log);
    log(
      tariffeAzzerate
        ? `Spedizione gratuita ripristinata: ${tariffeAzzerate} tariffe azzerate su ${profili.length} profilo/i.`
        : `Spedizione gratuita gia' a posto (${profili.length} profilo/i controllati).`,
    );
    return { profili: profili.length, tariffeAzzerate };
  } catch (e) {
    log(`Spedizione gratuita NON verificata: ${(e as Error).message}`);
    return null;
  }
}
