"""歌詞の行ごとの歌い出しの時刻（songs.json の motion.lines）を測る。
曲を聞き取り（faster-whisper）、聞き取った文字と本物の歌詞をひらがなにそろえて並べ合わせる。
使い方: python3 scripts/lyrics-timing.py <曲のid>   例: python3 scripts/lyrics-timing.py naitemo
必要なもの: faster-whisper、pykakasi"""
import sys, json, re, pykakasi
from faster_whisper import WhisperModel
SONGS = "public/songs/songs.json"
K = pykakasi.kakasi()
def hira(t): return "".join(x["hira"] for x in K.convert(t))
def clean(t): return re.sub(r"[\s|、。,.!?！？（）()\-~〜…・'\"]", "", t)
def listen(sg):
    m = WhisperModel("small", device="cpu", compute_type="int8")
    prompt = sg["lyrics"].replace("|", "").replace("\n", "、")[:400]
    segs, _ = m.transcribe("public/" + sg["file"], language="ja", word_timestamps=True, initial_prompt=prompt,
                           vad_filter=False, condition_on_previous_text=False, beam_size=5)
    return [{"w": [[w.start, w.end, w.word] for w in s.words]} for s in segs]
def main(sid):
    d = json.load(open(SONGS))
    sg = [s for s in d if s["id"] == sid][0]
    lines = [l for l in sg["lyrics"].split("\n") if l.strip()]
    # 歌詞：1文字ずつ、何行目かの印をつける
    L, Lline = [], []
    for i, l in enumerate(lines):
        for ch in hira(clean(l)): L.append(ch); Lline.append(i)
    # 聞き取り：1文字ずつ時刻をつける
    A, At = [], []
    for seg in listen(sg):
        for s, e, w in seg["w"]:
            h = hira(clean(w))
            for k, ch in enumerate(h): A.append(ch); At.append(s + (e - s) * k / max(1, len(h)))
    n, m = len(L), len(A)
    # 並べ合わせ（Needleman-Wunsch）
    G = -1
    S = [[0] * (m + 1) for _ in range(n + 1)]; P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): S[i][0] = i * G; P[i][0] = 1
    for j in range(1, m + 1): S[0][j] = 0; P[0][j] = 2   # 聞き取りの頭の余分はただ
    for i in range(1, n + 1):
        Li = L[i - 1]; Si, Sp = S[i], S[i - 1]; Pi = P[i]
        for j in range(1, m + 1):
            a = Sp[j - 1] + (2 if Li == A[j - 1] else -1); b = Sp[j] + G; c = Si[j - 1] + G
            if a >= b and a >= c: Si[j] = a; Pi[j] = 0
            elif b >= c: Si[j] = b; Pi[j] = 1
            else: Si[j] = c; Pi[j] = 2
    j = max(range(m + 1), key=lambda j: S[n][j]); i = n
    match = {}
    while i > 0 and j > 0:
        p = P[i][j]
        if p == 0:
            if L[i - 1] == A[j - 1]: match[i - 1] = At[j - 1]
            i -= 1; j -= 1
        elif p == 1: i -= 1
        else: j -= 1
    # 行の歌い出し＝その行の最初の方で一致した文字の時刻（ずれた分だけ戻す）
    starts, info = [], []
    pos = 0
    for li in range(len(lines)):
        idx = [k for k in range(len(L)) if Lline[k] == li]
        t = None; cnt = sum(1 for k in idx if k in match)
        for off, k in enumerate(idx[:6]):
            if k in match: t = match[k] - off * 0.25; break
        starts.append(t); info.append(f"{cnt}/{len(idx)}")
    # 見つからない行は前後から補う
    for li, t in enumerate(starts):
        if t is None:
            prv = next((starts[k] for k in range(li - 1, -1, -1) if starts[k] is not None), 0)
            nxt = next((starts[k] for k in range(li + 1, len(starts)) if starts[k] is not None), prv + 6)
            starts[li] = (prv + nxt) / 2
    for li in range(1, len(starts)):
        if starts[li] < starts[li - 1]: starts[li] = starts[li - 1]
    for l, t, f in zip(lines, starts, info): print(f"{t:6.1f}  {f:>6}  {l}")
    return [round(t, 2) for t in starts]
if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1])))
