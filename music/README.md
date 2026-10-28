# music/

- `origin-cloud-drift/` — il generatore originale di "Cloud Drift" (sessione Dreamland del 24/10/2026), da cui e' portato `server/music/engine.ts`, piu' gli script Python di analisi e l'anteprima mp3 che Andrea ha scelto. E' il riferimento: `python -I origin-cloud-drift/profile_music.py <mp3>` confronta tonalita', tempo e luminosita'.
- `checks/verify_mp3.py` — verifica indipendente (ffmpeg + numpy) di un mp3 del Music Studio: LUFS e true peak con `ebur128`, silenzi, giunzione del loop. `python -I checks/verify_mp3.py file.mp3 <loopStartSec> <loopSec>`.
- `try-render.ts` — render locale senza server: `node --import tsx music/try-render.ts relax 150 64` (scopo, durata, seme, [mood], [tipo sfx]).
- `stress.ts` — 20 render con semi diversi, stampa quelli che non passano i cancelli.
