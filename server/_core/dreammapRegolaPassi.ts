/*
 * UN PASSO FA AVANZARE (DreamMap app 0.9.390, BUG-122, Andrea 25/11/2026).
 *
 * Il passo di domani di un negozio online era "Guarda quali prodotti hanno venduto di più nell'ultimo mese", priorità alta, 45 minuti.
 * Andrea: "Non ci vogliono 45 minuti. Guardare quali prodotti hanno venduto di più lo legge l'intelligenza artificiale collegata al
 * business in 2 secondi, mentre l'utente dorme. Non siamo nel 2010. Devi trovare la via di minore resistenza, togliere decisioni
 * all'utente, fare passi concreti. Quello è un micro step, non un passo da 45 minuti da prenotare nel calendario il giorno prima".
 *
 * Una regola sola, in un posto solo: la usano la chat dell'agente personale e il lavoratore sul VPS (REGOLE_SCRITTURA, dreammapChat.ts),
 * le revisioni e il perché del passo di domani (dreammapConversa.ts), lo strumento aggiorna_roadmap (dreammapAgentTools.ts) e la roadmap
 * scritta dall'AI dell'utente con il ponte (scrivi_roadmap, dreammapPonte.ts). Lo controlla dreammapRegolaPassi.test.ts.
 */
export const REGOLA_PASSO_AVANZA = [
  "UN PASSO FA AVANZARE (app 0.9.390, Andrea: \"Guardare quali prodotti hanno venduto di più lo legge l'intelligenza artificiale in 2 secondi, mentre l'utente dorme: non è un passo da 45 minuti da prenotare il giorno prima. Togli decisioni all'utente e fai passi concreti\").",
  "Un passo della roadmap, una tappa o il passo di domani è un'azione che fa avanzare: produrre, costruire, lanciare, pubblicare, vendere, contattare.",
  "Raccogliere dati, leggere numeri, guardare le statistiche, cercare informazioni, studiare i concorrenti e riassumere NON sono passi: quel lavoro lo fai tu (cerchi sul web, apri il sito, fai il conto) e il risultato lo scrivi dentro al passo vero che lo usa. Quando il dato sta in un posto che vede solo lui (le vendite del suo negozio, il suo conto in banca), diventa al massimo mezza riga dentro al passo vero.",
  "Un passo non comincia mai con guarda, controlla, analizza, leggi, cerca, trova, studia, verifica, confronta, rivedi, elenca, informati.",
  "Togli le decisioni: quando la scelta segue da un dato (il prodotto che vende di più, il canale che porta più clienti), il passo dice già cosa fare con quel dato.",
  "NO \"Guarda quali prodotti hanno venduto di più nell'ultimo mese (45 minuti)\"; SÌ \"Metti in prima pagina il prodotto che ha venduto di più nell'ultimo mese: la classifica te la dà il negozio in un secondo (15 minuti)\".",
  "NO \"Analizza tre concorrenti (60 minuti)\"; SÌ \"Scrivi la pagina dell'offerta con il prezzo a 29 euro, sotto i tre concorrenti che ho guardato io (40 minuti)\".",
  "NO \"Cerca un fornitore\"; SÌ \"Scrivi ai due fornitori che ti ho indicato e chiedi un campione (15 minuti)\".",
  "NO \"Controlla dove i clienti abbandonano il carrello\"; SÌ \"Togli dal carrello il passaggio in più dove si fermano i clienti (20 minuti)\".",
  "IL TEMPO DI UN PASSO è quello che quel compito richiede davvero a una persona normale, mai un blocco fisso: un messaggio o una telefonata da 5 a 15 minuti, una scheda prodotto 30, un video corto da girare e pubblicare da 30 a 45, una pagina di vendita da 60 a 90. Mai 45 minuti di serie. Se un passo dura meno di 5 minuti non è un passo: uniscilo al passo vero che viene dopo.",
].join(" ");

/** La stessa regola in breve, per le descrizioni degli strumenti (aggiorna_roadmap, scrivi_roadmap). */
export const REGOLA_PASSO_AVANZA_BREVE =
  "Ogni tappa è un'azione che fa avanzare (produrre, costruire, lanciare, pubblicare, vendere, contattare), mai raccolta di dati: guardare numeri, cercare informazioni, studiare concorrenti e riassumere li fa l'AI, e il risultato va dentro alla tappa vera che lo usa (no \"Guarda quali prodotti hanno venduto di più\", sì \"Metti in prima pagina il prodotto che ha venduto di più nell'ultimo mese\"). I minuti sono quelli che il compito richiede davvero (un messaggio 10, una scheda prodotto 30), mai 45 di serie.";

/** I verbi di sola raccolta dati con cui un passo non comincia mai. */
export const VERBI_RACCOLTA = /^(guarda|guardare|controlla|controllare|analizza|analizzare|leggi|leggere|cerca|cercare|trova|trovare|studia|studiare|verifica|verificare|confronta|confrontare|rivedi|rivedere|elenca|elencare|informati|informarsi|osserva|osservare|esamina|esaminare|raccogli|raccogliere|riassumi|riassumere)\b/i;
/** Un passo che e' solo raccolta di dati? (per i controlli e per i test) */
export function passoSoloRaccolta(t: string): boolean { return VERBI_RACCOLTA.test(String(t || "").trim()); }
