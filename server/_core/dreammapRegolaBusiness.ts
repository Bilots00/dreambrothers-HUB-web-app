/*
 * I SOGNI DI BUSINESS: PROMOTE, DELIVER, BUILD (DreamMap app 0.9.402, BUG-255, Andrea 28/11/2026).
 *
 * Andrea: per i sogni, gli obiettivi e i progetti di business la roadmap segue il 4-4-4 di Alex Hormozi per chi parte da zero:
 * prima Promote (far sapere che esisti, validare l'interesse), poi Deliver (dare ai clienti quello che hai promesso), poi Build
 * (sistemi, procedure, l'offerta migliorata con i feedback veri). Le quattro ore per parte non sono obbligatorie: chi ne dedica meno
 * arriva dopo, e l'arrivo previsto lo mostra. Il contesto conta: Promote, Deliver, Build vale per validare un'idea da zero; quando
 * l'attivita' e' gia' avviata non si spinge il marketing se la consegna non funziona ("un ottimo marketing fa fallire piu' in fretta
 * un cattivo prodotto"). Quando si crea la roadmap l'agente chiede l'obiettivo: soldi in fretta oppure un brand solido a lungo
 * termine, con audience e community, e le tappe si strutturano in base alla risposta.
 *
 * Una regola sola, in un posto solo, come REGOLA_PASSO_AVANZA (dreammapRegolaPassi.ts): la usano la chat dell'agente personale e il
 * lavoratore sul VPS (REGOLE_SCRITTURA, dreammapChat.ts), le revisioni che propongono il percorso nuovo (dreammapConversa.ts), lo
 * strumento aggiorna_roadmap (dreammapAgentTools.ts) e la roadmap scritta dall'AI dell'utente con il ponte (scrivi_roadmap,
 * dreammapPonte.ts). Nell'app le missioni di serie dei sogni di business seguono lo stesso ordine (www/js/sentiero.js e
 * www/content/sentiero.json). Lo controlla dreammapRegolaBusiness.test.ts.
 */
export const DOMANDA_OBIETTIVO_BUSINESS =
  "Vuoi fare soldi in fretta, oppure costruire un brand solido che duri nel tempo, con un pubblico e una community?";

export const REGOLA_ROADMAP_BUSINESS = [
  "I SOGNI DI BUSINESS: PROMOTE, DELIVER, BUILD (app 0.9.402, Andrea). Quando il sogno, l'obiettivo o il progetto è un business (un negozio online, un'attività, un servizio, un prodotto da vendere, i contenuti di cui vivere), la roadmap segue il 4-4-4 di Alex Hormozi per chi parte da zero, in quest'ordine.",
  "1) PROMOTE, farsi conoscere: far sapere che esisti e validare l'interesse prima di costruire (scrivere a chi potrebbe comprare, pubblicare il prodotto con il prezzo, fare le telefonate, chiedere il sì, chiudere la prima vendita).",
  "2) DELIVER, consegnare: dare ai primi clienti quello che hai promesso, bene e in tempo, e chiedere a loro cosa migliorare.",
  "3) BUILD, costruire: i sistemi, le procedure scritte, gli strumenti, e l'offerta migliorata con i feedback veri dei clienti, non con quelli immaginati.",
  "LE ORE NON SONO OBBLIGATORIE: Hormozi ne mette quattro per parte, ma chi ha meno tempo tiene lo stesso ordine con meno ore e arriva dopo. L'arrivo previsto dell'app lo mostra da solo: non allunghi le giornate per farci stare dodici ore e non nascondi il ritardo.",
  "IL CONTESTO CONTA. Promote, Deliver, Build serve a validare un'idea da zero. Se l'attività è già avviata (ha già clienti o vendite), prima si sistema la consegna e solo dopo si spinge il marketing, perché un ottimo marketing fa fallire più in fretta un cattivo prodotto: le prime tappe fanno funzionare la consegna (i reclami più frequenti, i ritardi, i resi, le recensioni), poi vengono quelle che portano clienti nuovi, poi i sistemi.",
  "L'OBIETTIVO SI CHIEDE PRIMA DI SCRIVERE LE TAPPE. Quando costruisci la prima roadmap di un business, o la rifai da capo, fra le domande c'è anche questa, se la risposta non la sai già: \"" + DOMANDA_OBIETTIVO_BUSINESS + "\". Con i soldi in fretta le tappe puntano alla prima vendita il prima possibile: un'offerta sola, la vendita diretta (messaggi, telefonate, inserzioni), una consegna semplice. Con il brand duraturo le tappe costruiscono il pubblico: contenuti pubblicati con costanza, una community, una lista di contatti, l'identità del marchio, e le vendite crescono dopo. Se risponde tutte e due, prima la vendita che paga le spese, poi il brand. La risposta la tieni a mente e non la richiedi a ogni ricalcolo.",
].join(" ");

/** La stessa regola in breve, per le descrizioni degli strumenti (aggiorna_roadmap, scrivi_roadmap). */
export const REGOLA_ROADMAP_BUSINESS_BREVE =
  "Per un sogno di business l'ordine delle tappe è Promote, Deliver, Build (Alex Hormozi): prima far sapere che esisti e validare l'interesse, poi consegnare ai clienti quello che hai promesso, poi costruire sistemi e migliorare l'offerta con i feedback veri. Se l'attività è già avviata, prima si sistema la consegna e poi si spinge il marketing. Le ore per parte non sono obbligatorie: con meno ore si arriva dopo. Prima di scriverla, se non lo sai, chiedi l'obiettivo: \"" + DOMANDA_OBIETTIVO_BUSINESS + "\"";
