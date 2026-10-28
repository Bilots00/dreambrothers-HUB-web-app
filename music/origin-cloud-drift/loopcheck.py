"""Check a loop junction: overlap-add playback (next copy at L) vs naive cut-loop.
Metric: sample-level jump at the junction + RMS step between 100 ms windows."""
import subprocess, sys
import numpy as np
SR = 44100
path, L = sys.argv[1], float(sys.argv[2])
x = np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True).stdout, dtype=np.float32)
# mp3 decoders add the same delay to every copy; find it from the onset of the first event
n = int(L * SR)
def junction(y, j):
    w = int(0.1 * SR)
    r = [np.sqrt(np.mean(y[k:k+w]**2)) for k in range(j - 10*w, j + 10*w, w)]
    db = 20*np.log10(np.array(r) + 1e-9)
    jump = abs(float(y[j]) - float(y[j-1]))
    typical = np.median(np.abs(np.diff(y[j-SR:j+SR])))
    return max(abs(np.diff(db))), jump / (typical + 1e-9)
ola = np.zeros(2*n + len(x)); ola[:len(x)] += x; ola[n:n+len(x)] += x
naive = np.concatenate([x[:n], x[:n]])
d1, j1 = junction(ola, n); d2, j2 = junction(naive, n)
print(f'overlap-add : max RMS step {d1:.1f} dB, sample jump {j1:.1f}x typical')
print(f'naive loop  : max RMS step {d2:.1f} dB, sample jump {j2:.1f}x typical')
ok = d1 < 3.0 and j1 < 25
print('JUNCTION', 'GREEN' if ok else 'RED')
sys.exit(0 if ok else 1)
