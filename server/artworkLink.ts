/**
 * Link firmati agli artwork, per farli scaricare a Printify.
 *
 * Il file di stampa pesa decine di MB: spedirlo a Printify in base64 dentro il
 * POST fa scattare un 413 ("The POST data is too large"). L'upload per URL non
 * ha quel limite, ma la repo dell'agente è privata e `raw.githubusercontent`
 * non è raggiungibile da fuori.
 *
 * Quindi la web app espone l'artwork su un indirizzo pubblico ma **firmato e a
 * scadenza**: nessuno può indovinare l'URL di un design non pubblicato, e il
 * link smette di funzionare da solo dopo un'ora.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DURATA_MS = 60 * 60 * 1000; // un'ora: Printify scarica subito, non serve di più

function chiave(): string {
  const k = process.env.CARE_WEBHOOK_SECRET || process.env.JWT_SECRET;
  if (!k) {
    throw new Error(
      "Manca CARE_WEBHOOK_SECRET (o JWT_SECRET) nelle variabili Railway: " +
        "senza non posso firmare il link che Printify usa per scaricare l'artwork.",
    );
  }
  return k;
}

function firma(data: string, file: string, scadenza: number): string {
  return createHmac("sha256", chiave()).update(`${data}/${file}/${scadenza}`).digest("hex").slice(0, 32);
}

/**
 * L'indirizzo pubblico dell'app.
 *
 * Su Railway `RAILWAY_PUBLIC_DOMAIN` c'è già senza configurare niente; le altre
 * due servono se un giorno l'app cambia casa.
 */
export function basePubblica(): string | null {
  const esplicito = process.env.PUBLIC_BASE_URL || process.env.SOCIAL_BASE_URL;
  if (esplicito) return esplicito.replace(/\/+$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  return railway ? `https://${railway}` : null;
}

/** L'URL da dare a Printify, oppure null se non sappiamo come ci si raggiunge. */
export function linkArtwork(data: string, file: string): string | null {
  const base = basePubblica();
  if (!base) return null;
  const scadenza = Date.now() + DURATA_MS;
  const sig = firma(data, file, scadenza);
  return `${base}/api/artwork/${encodeURIComponent(data)}/${encodeURIComponent(file)}?exp=${scadenza}&sig=${sig}`;
}

/** Il link è valido? Confronto a tempo costante, così la firma non si indovina a tentativi. */
export function verificaLink(data: string, file: string, exp: string, sig: string): boolean {
  const scadenza = Number(exp);
  if (!Number.isFinite(scadenza) || scadenza < Date.now()) return false;
  const atteso = firma(data, file, scadenza);
  const a = Buffer.from(atteso);
  const b = Buffer.from(String(sig || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
