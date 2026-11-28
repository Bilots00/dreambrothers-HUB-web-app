#!/usr/bin/env node
/**
 * Trasforma il token breve del Graph API Explorer nel token di PAGINA a lunga
 * durata che serve all'Hub per pubblicare su Instagram e Facebook.
 *
 * Si lancia sul PC di Andrea, mai sul server. Stampa il token nel terminale:
 * va incollato nelle variabili Railway e basta (niente chat, niente Notion).
 *
 *   $env:META_APP_ID="..."; $env:META_APP_SECRET="..."; $env:META_USER_TOKEN="..."
 *   node scripts/meta-page-token.mjs
 *
 * Passi (doc Meta: facebook-login/guides/access-tokens/get-long-lived):
 *  1. token utente breve  → token utente lungo (~60 giorni), con app id + secret
 *  2. /me/accounts con il token lungo → un token per ogni Pagina, che non scade
 *  3. /debug_token sul token di Pagina → controllo dei permessi
 */

const V = process.env.META_GRAPH_VERSION || "v23.0";
const G = `https://graph.facebook.com/${V}`;
const { META_APP_ID: appId, META_APP_SECRET: secret, META_USER_TOKEN: breve } = process.env;
const RICHIESTI = ["instagram_basic", "instagram_content_publish", "pages_manage_posts", "pages_read_engagement"];

if (!appId || !secret || !breve) {
  console.error("Servono tre variabili: META_APP_ID, META_APP_SECRET, META_USER_TOKEN (vedi docs/social-autopublish.md).");
  process.exit(1);
}

async function get(path, params) {
  const r = await fetch(`${G}${path}?${new URLSearchParams(params)}`);
  const j = await r.json();
  if (j.error) throw new Error(`Meta ${j.error.code}: ${j.error.message}`);
  return j;
}

try {
  const lungo = await get("/oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: breve,
  });
  const pagine = await get("/me/accounts", {
    access_token: lungo.access_token, fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50",
  });
  if (!pagine.data?.length) {
    console.error("Nessuna Pagina trovata: il profilo con cui hai fatto login non ha ruoli su nessuna Pagina, o non le hai spuntate nel login.");
    process.exit(1);
  }
  for (const p of pagine.data) {
    const dbg = await get("/debug_token", { input_token: p.access_token, access_token: `${appId}|${secret}` });
    const scopes = new Set(dbg.data?.scopes ?? []);
    const mancano = RICHIESTI.filter((s) => !scopes.has(s));
    const scade = dbg.data?.expires_at ? new Date(dbg.data.expires_at * 1000).toLocaleString("it-IT") : "mai";
    console.log("\n────────────────────────────────────────");
    console.log(`Pagina:            ${p.name}`);
    console.log(`META_PAGE_ID       ${p.id}`);
    console.log(`Instagram:         ${p.instagram_business_account ? "@" + (p.instagram_business_account.username ?? "?") : "NON COLLEGATO"}`);
    if (p.instagram_business_account) console.log(`META_IG_USER_ID    ${p.instagram_business_account.id}`);
    console.log(`Scade:             ${scade}`);
    console.log(`Permessi mancanti: ${mancano.length ? mancano.join(", ") : "nessuno"}`);
    console.log(`META_PAGE_ACCESS_TOKEN`);
    console.log(p.access_token);
  }
  console.log("\nCopia i valori della Pagina DreamBrothers nelle variabili Railway, poi chiudi questo terminale.");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
