"""Analyze audio files: amplitude-modulation spectrum + repetition structure.

usage: python -I analyze_tracks.py file1.mp3 [file2 ...]
- AM spectrum: envelope of 4 frequency bands, FFT of envelope in 16 s windows,
  averaged; peak prominence in 1-40 Hz vs smooth 1/f fit.
- Repetition: per-second log-mel-ish band energies + chroma-like, then for each
  12 s window, best correlation with any non-overlapping window elsewhere.
"""
import subprocess, sys
import numpy as np
from scipy import signal

SR = 22050


def decode(path, sr=SR, max_s=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', path, '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-']
    if max_s:
        cmd[3:3] = ['-t', str(max_s)]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    return x


def am_spectrum(mono, sr=SR):
    bands = [(60, 250), (250, 1000), (1000, 3000), (3000, 8000)]
    env_sr = 200
    out = {}
    for lo, hi in bands:
        sos = signal.butter(4, [lo, hi], btype='band', fs=sr, output='sos')
        b = signal.sosfiltfilt(sos, mono)
        env = np.abs(signal.hilbert(b)) if len(b) < 2_000_000 else np.abs(b)
        sos2 = signal.butter(4, 80, fs=sr, output='sos')
        env = signal.sosfiltfilt(sos2, env)
        env = signal.resample_poly(env, env_sr, sr)
        f, p = signal.welch(env - env.mean(), fs=env_sr, nperseg=env_sr * 16)
        out[(lo, hi)] = (f, p)
    return out


def peaks_report(f, p):
    m = (f >= 0.5) & (f <= 40)
    ff, pp = f[m], p[m]
    lp = np.log10(pp + 1e-20)
    # smooth baseline (1/f-ish) via wide median filter in log domain
    base = signal.medfilt(lp, 81)
    prom = lp - base
    idx = signal.find_peaks(prom, height=0.35, distance=8)[0]
    top = sorted(idx, key=lambda i: -prom[i])[:6]
    return [(round(float(ff[i]), 2), round(float(prom[i]) * 10, 1)) for i in sorted(top)]  # Hz, dB above baseline


def frame_features(mono, sr=SR, hop_s=1.0):
    hop = int(sr * hop_s)
    n = len(mono) // hop
    edges = np.geomspace(60, 10000, 25)
    feats = []
    win = np.hanning(hop)
    freqs = np.fft.rfftfreq(hop, 1 / sr)
    bins = [((freqs >= edges[i]) & (freqs < edges[i + 1])) for i in range(len(edges) - 1)]
    # chroma
    midi = 69 + 12 * np.log2(np.maximum(freqs, 1) / 440)
    pc = np.mod(np.round(midi), 12).astype(int)
    valid = (freqs > 80) & (freqs < 4000)
    for k in range(n):
        seg = mono[k * hop:(k + 1) * hop] * win
        mag = np.abs(np.fft.rfft(seg))
        e = np.array([mag[b].sum() for b in bins])
        ch = np.bincount(pc[valid], weights=mag[valid], minlength=12)
        feats.append(np.concatenate([np.log10(e + 1e-6), ch / (ch.sum() + 1e-9) * 4]))
    F = np.array(feats)
    F = (F - F.mean(0)) / (F.std(0) + 1e-6)
    return F


def repetition(F, w=12):
    n = len(F)
    W = np.array([F[i:i + w].ravel() for i in range(0, n - w)])
    W = (W - W.mean(1, keepdims=True)) / (W.std(1, keepdims=True) + 1e-6)
    S = (W @ W.T) / W.shape[1]
    best, lag = [], []
    for i in range(len(S)):
        row = S[i].copy()
        row[max(0, i - w * 2):i + w * 2] = -1
        j = int(np.argmax(row))
        best.append(row[j]); lag.append(abs(j - i))
    best = np.array(best); lag = np.array(lag)
    return best, lag


for path in sys.argv[1:]:
    x = decode(path)
    mono = x.mean(1)
    dur = len(mono) / SR
    print(f'\n### {path.split("/")[-1]}  duration {dur/60:.1f} min')
    # AM spectrum on first 4 minutes (stationary enough), also middle 4 minutes
    for label, a in [('0-4 min', 0), ('mid 4 min', int(len(mono) / 2))]:
        seg = mono[a:a + SR * 240]
        spec = am_spectrum(seg)
        print(f'  AM peaks ({label}) [Hz, dB above 1/f baseline]:')
        for band, (f, p) in spec.items():
            print(f'    band {band[0]}-{band[1]} Hz: {peaks_report(f, p)}')
    # stereo: modulation phase difference between channels at the top peak? (binaural-ish check)
    corr = np.corrcoef(x[:SR * 60, 0], x[:SR * 60, 1])[0, 1]
    print(f'  L/R correlation (1st minute): {corr:.3f}')
    # repetition
    F = frame_features(mono[:SR * min(int(dur), 3600)])
    best, lag = repetition(F)
    hi = best > 0.85
    print(f'  repetition: windows with a near-identical 12 s match elsewhere: {hi.mean()*100:.0f}%  (r>0.85)')
    if hi.any():
        lags = lag[hi]
        h, e = np.histogram(lags, bins=np.arange(0, len(F) + 30, 30))
        topl = np.argsort(h)[::-1][:5]
        print('  most common jump distances (s):', [(int(e[i]), int(h[i])) for i in topl if h[i] > 0])
    print(f'  median best match r={np.median(best):.2f}')
