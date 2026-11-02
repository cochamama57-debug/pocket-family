"""曲の速さ（bpm）・最初の拍の位置・盛り上がり（energy/level）を測り、songs.json の motion に入れる値を出す。
使い方: python3 scripts/analyze-song.py public/songs/xxx.mp3
必要なもの: numpy、imageio-ffmpeg（ffmpeg を使うため）"""
import json, subprocess, sys
import numpy as np, imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 11025

def load(path):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

def onset(x, hop):
    n = len(x) // hop
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (256, 256)), 512)[::hop][:n]
    S = np.log1p(np.abs(np.fft.rfft(frames * np.hanning(512), axis=1)) * 10)
    fl = np.concatenate([[0], np.maximum(0, np.diff(S, axis=0)).sum(1)])
    return np.maximum(fl - np.convolve(fl, np.ones(64) / 64, "same"), 0)

def grid_score(fl, fps, bpm, ph):
    period = fps * 60 / bpm
    idx = np.round(ph + np.arange(0, len(fl) / period) * period).astype(int)
    idx = idx[idx < len(fl)]
    return np.max([fl[np.clip(idx + d, 0, len(fl) - 1)] for d in (-2, -1, 0, 1, 2)], axis=0).mean()

def best(fl, fps, bpms, phases):
    top = None
    for bpm in bpms:
        period = fps * 60 / bpm
        for ph in np.linspace(0, period, phases, endpoint=False):
            s = grid_score(fl, fps, bpm, ph)
            if top is None or s > top[0]:
                top = (s, bpm, ph / fps)
    return top

def main(path):
    x = load(path)
    hop = 64; fps = SR / hop
    fl = onset(x, hop)
    _, b0, _ = best(fl, fps, np.arange(60, 170, 0.1), 16)
    _, bpm, off = best(fl, fps, np.arange(b0 - 0.3, b0 + 0.3, 0.01), 64)
    # 盛り上がり：約0.49秒ごとの音の大きさ（0〜9）
    per = 21 * 256; step = per / SR
    m = len(x) // per
    rms = np.sqrt((x[: m * per].reshape(m, per) ** 2).mean(1))
    e = np.clip(np.round(rms / (np.percentile(rms, 95) + 1e-9) * 9), 0, 9).astype(int)
    # 場面：前後4秒をならして、曲の中での順位（0＝いちばん静か、9＝いちばん盛り上がる）
    k = 17
    s = np.convolve(np.pad(e.astype(float), (k // 2, k // 2), mode="edge"), np.ones(k) / k, "valid")
    ranks = s.argsort().argsort() / max(1, len(s) - 1)
    print(json.dumps({"bpm": round(float(bpm), 2), "offset": round(float(off), 3), "step": round(step, 5),
                      "energy": "".join(map(str, e)), "level": "".join(str(min(9, int(r * 10))) for r in ranks)}, ensure_ascii=False))

if __name__ == "__main__":
    main(sys.argv[1])
