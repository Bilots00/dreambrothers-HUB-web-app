# Installazione Skill Session Sync
<!-- externalId: installazione-skill-session-sync -->

## user — 2026-07-20T16:30:00Z
Verifica se le skill session-export/session-import sono installate in Claude Code,
Claude Cowork e Claude Code sul VPS, e se `/session-import` funziona dalla web app.
Installale dove mancano e fai un test.

## assistant — 2026-07-20T16:50:00Z
[audit] Skill presenti in ~/.claude/skills su Windows (condivise con Cowork), ASSENTI sul VPS.
Endpoint hub OK: GET /api/claude/sessions -> 401 (esiste), POST /api/claude/session -> 200.
Trovati 3 problemi: CARE_WEBHOOK_SECRET non in env su Windows; nessuna cartella sessions/;
spec installata (.claude/session-sync.json) diversa da quella richiesta (_index.json).

[fix] Riscritte entrambe le skill sulla spec _index.json (ultima esportata in cima,
fuzzy match sul nome, conferma titolo a fine export). Documentati i path repo reali e
il fatto che cartella `meta-ai-media-buyer` e remote `dreambrothers-HUB-web-app` sono
lo stesso repo (rinominato su GitHub, stesso HEAD ef25dfc). Installate sul VPS via scp.

[test] Giro end-to-end verificato: upsert -> sessionId 5; turno da mobile via ingest;
GET messages?since= restituisce SOLO il turno nuovo; rename via POST senza messages
-> inserted 0, nessun duplicato. L agente VPS ha risposto da solo al turno mobile
(source: agent) e ha eseguito correttamente /session-import caricando la skill.
