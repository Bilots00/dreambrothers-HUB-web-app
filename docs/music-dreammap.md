# Music Studio → Dream Map

Come le tracce e gli effetti del **Music Studio** (web app, `/music/studio` e `/music/libreria`) arrivano nell'app **Dream Map** (repo `Bilots00/focuslock-mobile`).

## In breve

1. In Libreria, Andrea apre il menu di un brano e sceglie **Pubblica su Dream Map**.
2. Sceglie dove compare: scrigni, focus/viaggio, episodi, effetti del gioco.
3. Per gli scrigni sceglie anche il livello: bronzo, argento, oro o leggendario. Sono gli stessi di `SCR_TIER` in `scrigni.js`.
4. Il server mette il brano nel **manifest pubblico**. L'app lo legge come legge già gli sfondi.

L'audio sta nel database della web app. Il servizio è lo stesso che risponde già a `/api/focuslock/*`, quindi non c'è un bucket esterno e non c'è niente in più da pagare.

## Lato web app (fatto)

### Il manifest

`GET https://meta-ai-media-buyer-production.up.railway.app/api/focuslock/music/manifest`

- Non serve autenticazione. Il path è sotto `/api/focuslock/`, quindi passa da `NATIVE.publicApi`.
- `Cache-Control: public, max-age=300`. Risponde con un `ETag` e accetta `If-None-Match`, a cui risponde `304`.

```json
{
  "schema": 1,
  "version": 1761700000000,
  "license": "Audio generato proceduralmente da DreamBrothers Music Studio. Proprieta' di Andrea Bilotta / DreamBrothers. Nessun campione di terzi.",
  "items": [
    {
      "id": "dbm-42",
      "kind": "track",
      "title": "Amber Tides",
      "purpose": "focus",
      "sfxType": null,
      "mood": "dreamy",
      "key": "F",
      "bpm": 68,
      "durationSec": 282.55,
      "loop": { "startSec": 0.125, "lengthSec": 282.35 },
      "url": "https://…/api/focuslock/music/42.mp3",
      "bytes": 4520000,
      "mime": "audio/mpeg",
      "uses": ["focus", "mystery_box"],
      "rarity": "oro",
      "publishedAt": "2026-10-28T08:12:00.000Z",
      "loudnessLufs": -18
    }
  ]
}
```

Come leggere i campi:

- **`kind`** vale `track` per un loop ambient o una colonna per spot, oppure `sfx` per un effetto breve.
- **`purpose`** è uno di `focus`, `study`, `work`, `relax`, `meditate`, `sleep`, `ad`, `sfx`.
- **`sfxType`**, solo per gli effetti, è uno di `reward`, `level-up`, `chest-open`, `mystery-box`, `click`, `success`, `fail`, `coin`, `whoosh`.
- **`uses`** contiene uno o più fra `mystery_box`, `focus`, `episode`, `game_sfx`.
- **`rarity`** vale `bronzo`, `argento`, `oro`, `leggendario` oppure `null`. È presente solo se `uses` contiene `mystery_box`.
- **`loop`** vale `null` per effetti e spot.
- **`version`** cresce a ogni modifica: serve a capire se il manifest è cambiato.

### Il file

`GET /api/focuslock/music/<n>.mp3`

- È pubblico, ma risponde solo per i brani pubblicati: gli altri danno `404`.
- Supporta `Range`.
- `Cache-Control: public, max-age=31536000, immutable`. Il contenuto di un id non cambia mai: una nuova generazione crea un id nuovo.

### Loop senza cuciture

Ogni traccia in loop è costruita perché la regione `[loop.startSec, loop.startSec + loop.lengthSec]` si ripeta all'infinito senza salti. Sono stati usati due accorgimenti:

- **Overlap-add circolare**: la coda di riverbero della fine è già sommata all'inizio.
- **Margine prima e dopo il loop**: intorno al loop ci sono 100 ms di contenuto periodico. Così il ritardo che ogni decoder mp3 aggiunge in testa (circa 25 ms) cade dentro musica continua e non nel silenzio.

**Per suonarla serve WebAudio**, non `<audio loop>`:

```js
const src = ctx.createBufferSource();
src.buffer = await ctx.decodeAudioData(arrayBuffer);
src.loop = true;
src.loopStart = item.loop.startSec;
src.loopEnd = item.loop.startSec + item.loop.lengthSec;
src.connect(ctx.destination);
src.start(0, item.loop.startSec);
```

Un `<audio loop>` nativo ripete anche i 100 ms di margine e il ritardo del decoder: ogni giro ci sarebbe un piccolo singhiozzo.

## Lato Dream Map (da fare, nel repo focuslock-mobile)

Oggi è tutto locale:

- gli scrigni sbloccano solo `SCR_SUONI=['storm','river','forest']` (`www/js/scrigni.js:26`);
- i suoni di focus sono asset dentro l'APK (`www/js/sounds.js`);
- il `SoundService` nativo suona **solo** `public/audio/nature/<id>.mp3` (`SoundService.java:141`).

Per usare il manifest servono questi cambi.

### 1. Il catalogo

Crea un nuovo `www/js/musica-server.js`, sul modello degli sfondi (`scores.js:1325-1350`):

- `GET /api/focuslock/music/manifest` via `NATIVE.publicApi`, con fallback a `fetch(FL_BACKEND + …)`;
- cache in `localStorage fl_music_manifest = {day, version, items}`, letto una volta al giorno;
- se l'app è offline usa la copia vecchia.

### 2. I file offline

Ogni mp3 sbloccato o scelto va scaricato una volta sola e tenuto in cache. Le strade sono due:

- **Web (più semplice):** Cache Storage, con `caches.open('fl-music-v1')` e `cache.add(item.url)`. Il service worker `sw.js` non deve cancellare la cache `fl-music-v1` quando cambia `CACHE`.
- **Nativo:** un metodo `NATIVE.soundDownload({id, url})` che salva in `getFilesDir()/music/<id>.mp3`.

### 3. Il player di focus

La strada consigliata è **suonare i brani del server in WebAudio** dentro la WebView, con il codice del loop scritto sopra.

- Mettili nella lista di `sounds.js` come gruppo "DreamBrothers", con `id = item.id`.
- Fai deviare `sndPlay` (sounds.js:168) quando `id` comincia con `dbm-`.
- **Limite:** WebAudio si ferma quando la WebView va in background. Per la musica a schermo spento serve il nativo: `SoundService` deve accettare un percorso file (`soundPlay({id, path, loopStartMs, loopEndMs})`) e usare ExoPlayer con `ClippingMediaSource` più `LoopingMediaSource` sulla regione di loop. MediaPlayer `setLooping` non conosce `loopStart`.

### 4. Gli scrigni

In `scrContenuto` (scrigni.js:83), se il manifest ha brani con `uses` che contiene `mystery_box` e la stessa `rarity` del tier dello scrigno, uno di quelli non ancora sbloccati diventa il premio `suono`.

- Lo sblocco si salva in `fl_scrigni` come oggi: `suono: 'dbm-42'`.
- `scrSuonoChiuso(id)` (scrigni.js:67) deve considerare chiusi anche i `dbm-*` con `uses` che contiene `mystery_box`, finché non sono sbloccati.

### 5. Gli effetti

I brani con `uses` che contiene `game_sfx` possono sostituire i jingle sintetizzati di `musica.js`. La corrispondenza è:

| `sfxType` | jingle di `musica.js` |
| --- | --- |
| `coin` | `moneta` |
| `success` | `giusta` |
| `fail` | `sbagliata` |
| `chest-open` | `scrigno` |
| `level-up` | `livello` |
| `click` | `tic` |
| `reward` | `missione` |

In pratica: precarica in un `AudioBuffer`, e in `muJingle(name)` usa il buffer se c'è, altrimenti il sintetizzato. Gli mp3 hanno circa 25 ms di ritardo del decoder in testa: per un tocco è impercettibile.

### 6. Gli episodi

In `content/episodi.json` aggiungi a un episodio una chiave facoltativa `"musica": "dbm-42"`. `episodi.js` la suona in loop, a volume basso, mentre l'episodio è aperto.

## Controlli di qualità (prima di salvare, sul server)

Un brano che non li passa non entra in libreria: dopo 3 semi diversi viene segnato come "scartato dal controllo".

- **Loudness** -18 LUFS per l'ambient, -14 per gli spot, -16 per gli effetti, con tolleranza ±1.
- **True peak** sotto -1 dBTP. Il tetto è -1,5.
- **Silenzio**: niente silenzio in apertura (più di 1 s per l'ambient, più di 30 ms per un effetto) e niente buchi morti (più di 1,5 s sotto -45 dBFS).
- **Giunzione del loop**: salto RMS sotto 3 dB, salto di campione sotto 25 volte il tipico.

I test in `server/music/dsp.test.ts` fanno diventare rosso ogni controllo su un caso rotto noto. La verifica indipendente sull'mp3 decodificato, con ffmpeg e numpy, è in `music/checks/verify_mp3.py`.
