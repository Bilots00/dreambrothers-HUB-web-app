"""Musical profile of an audio file: key (Krumhansl), tempo, brightness, dynamics.
usage: python -I profile_music.py file [file ...]
"""
import subprocess, sys
import numpy as np
from scipy import signal

SR = 22050
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


for path in sys.argv[1:]:
    x = decode(path)
    n = 4096; hop = 2048
    f, t, Z = signal.stft(x, fs=SR, nperseg=n, noverlap=n - hop)
    M = np.abs(Z)
    # chroma
    midi = 69 + 12 * np.log2(np.maximum(f, 1) / 440)
    pc = np.mod(np.round(midi), 12).astype(int)
    valid = (f > 60) & (f < 2000)
    chroma = np.array([M[valid & (pc == k)].sum() for k in range(12)])
    chroma /= chroma.sum()
    scores = []
    for k in range(12):
        scores.append((np.corrcoef(chroma, np.roll(MAJ, k))[0, 1], NAMES[k] + ' major'))
        scores.append((np.corrcoef(chroma, np.roll(MIN, k))[0, 1], NAMES[k] + ' minor'))
    scores.sort(reverse=True)
    # brightness
    spec = M.mean(1)
    centroid = (f * spec).sum() / spec.sum()
    # tempo from onset envelope autocorrelation
    flux = np.maximum(0, np.diff(np.log1p(M), axis=1)).sum(0)
    flux -= flux.mean()
    fr = SR / hop
    ac = np.correlate(flux, flux, 'full')[len(flux) - 1:]
    lags = np.arange(len(ac)) / fr
    m = (lags > 60 / 160) & (lags < 60 / 45)
    bpm = 60 / lags[m][np.argmax(ac[m])]
    onset_rate = (signal.find_peaks(flux, height=flux.std() * 1.5, distance=int(fr * 0.12))[0].size) / (len(x) / SR)
    # dynamics
    rms = np.sqrt(signal.convolve(x ** 2, np.ones(SR) / SR, 'valid')[::SR // 2])
    db = 20 * np.log10(rms + 1e-9)
    print(f'\n### {path.split("/")[-1]}  ({len(x)/SR:.0f}s)')
    print(f'  key guess: {scores[0][1]} (r={scores[0][0]:.2f}), next {scores[1][1]} (r={scores[1][0]:.2f})')
    print(f'  chroma: ' + ' '.join(f'{NAMES[k]}:{chroma[k]*100:.0f}' for k in range(12)))
    print(f'  tempo ~{bpm:.0f} BPM, onsets/s {onset_rate:.2f}')
    print(f'  spectral centroid {centroid:.0f} Hz, loudness range p10..p90 {np.percentile(db,10):.1f}..{np.percentile(db,90):.1f} dBFS')
