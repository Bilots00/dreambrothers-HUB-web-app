"""Verifica indipendente di un mp3 del Music Studio, con ffmpeg + numpy (non usa il codice TS).
usage: python -I verify_mp3.py file.mp3 [loopStartSec loopSec]
- loudness integrata e true peak: filtro ebur128 di ffmpeg
- buchi di silenzio: come gate.py
- giunzione: suona la regione di loop due volte di fila (come un player con loopStart/loopEnd)
Exit 1 se un controllo fallisce."""
import subprocess, sys, re
import numpy as np
SR = 44100
path = sys.argv[1]
loop = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else None
x = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout, dtype=np.float32)
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r)[-1]); TP = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r)[-1])
fails = []
win = SR // 4
db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i:i+win]**2)) for i in range(0, len(x) - win, win)]) + 1e-9)
quiet = db <= -45
first = int(np.argmax(~quiet)) * 0.25
gaps, run = [], 0
for q in quiet[int(first / 0.25):]:
    if q: run += 1
    else:
        if run: gaps.append(run * 0.25)
        run = 0
gap = max(gaps or [0])
print(f'{path.split("/")[-1]}: {len(x)/SR:.2f}s  I={I:.1f} LUFS  TP={TP:.2f} dBTP  apertura={first:.2f}s  buco max={gap:.2f}s  livello {db.min():.1f}..{db.max():.1f} dBFS')
if TP > -1.0: fails.append(f'true peak {TP}')
if first > 1.0: fails.append(f'apertura {first}')
if gap > 1.5: fails.append(f'buco {gap}')
if loop:
    a, n = int(round(loop[0] * SR)), int(round(loop[1] * SR))
    y = x[a:a+n]; z = np.concatenate([y, y]); w = int(0.1 * SR)
    rms = 20 * np.log10(np.array([np.sqrt(np.mean(z[k:k+w]**2)) for k in range(n - 10*w, n + 10*w, w)]) + 1e-9)
    step = float(np.max(np.abs(np.diff(rms))))
    jump = abs(float(z[n]) - float(z[n-1])) / (np.median(np.abs(np.diff(z[n-SR:n+SR]))) + 1e-9)
    print(f'  giunzione: salto RMS {step:.1f} dB, salto campione {jump:.1f}x tipico')
    if step >= 3.0 or jump >= 25: fails.append('giunzione')
print('VERDE' if not fails else 'ROSSO: ' + ', '.join(fails))
sys.exit(1 if fails else 0)
