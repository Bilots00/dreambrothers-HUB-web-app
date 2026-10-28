"""Temporal gate for an audio file: opening silence, dead gaps, tail, clipping.
usage: python -I gate.py file.mp3  -> exits 1 if a check fails"""
import subprocess, sys
import numpy as np
SR = 22050
x = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',sys.argv[1],'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True).stdout, dtype=np.float32)
win = SR // 4
rms = np.array([np.sqrt(np.mean(x[i:i+win]**2)) for i in range(0, len(x)-win, win)])
db = 20*np.log10(rms+1e-9)
thr = -45
first = np.argmax(db > thr) * 0.25
gaps, run = [], 0
for v in db:
    if v <= thr: run += 1
    else:
        if run: gaps.append(run*0.25)
        run = 0
inner_gap = max([g for g in gaps] or [0])
tail = run*0.25
clip = float(np.mean(np.abs(x) > 0.99))
fails = []
if first > 1.0: fails.append(f'opening silence {first:.2f}s')
if inner_gap > 1.5: fails.append(f'dead gap {inner_gap:.2f}s')
if clip > 1e-4: fails.append(f'clipping {clip*100:.3f}%')
print(f'opening {first:.2f}s | longest inner gap {inner_gap:.2f}s | tail silence {tail:.2f}s | clipped {clip*100:.4f}% | level min..max {db.min():.1f}..{db.max():.1f} dBFS')
print('GATE', 'RED: ' + '; '.join(fails) if fails else 'GREEN')
sys.exit(1 if fails else 0)
