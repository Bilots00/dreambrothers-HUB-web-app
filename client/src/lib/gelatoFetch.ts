const CLOUDFLARE_WORKER_URL = "https://gelato-backend.andrea-bilotta00.workers.dev";

// Chiave per le rotte amministrative del worker (creazione prodotti, upload,
// debug). Il worker la pretende solo se ha ADMIN_SECRET impostato, quindi
// senza questa variabile tutto continua a funzionare come prima.
// NOTA: essendo codice di browser, questa chiave e' leggibile da chi apre gli
// strumenti per sviluppatori. Alza l'asticella (non basta piu' conoscere l'URL)
// ma la difesa definitiva e' far passare queste chiamate dal server della web
// app invece che dal browser.
export const WORKER_KEY: string = (import.meta as any).env?.VITE_WORKER_KEY || "";
export const workerAuthHeaders = (): Record<string, string> =>
  WORKER_KEY ? { "x-db-key": WORKER_KEY } : {};

export async function workerFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${CLOUDFLARE_WORKER_URL}${cleanPath}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...workerAuthHeaders(), ...init.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} – ${text}`);
  }
  return res.json() as Promise<T>;
}

export const getTemplate = (templateId: string) =>
  workerFetch(`/gelato-get-template?templateId=${encodeURIComponent(templateId)}`);

export const bulkCreate = (payload: any) =>
  workerFetch(`/gelato-bulk-create`, { method: "POST", body: JSON.stringify(payload) });
