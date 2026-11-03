// AIポケットファミリー: キャラの声（サーバー側）
// Fish Audio で、キャラの返事を声にする。合いかぎは環境変数 FISH_API_KEY（画面には出さない）。
// 声の種類は FISH_VOICE_CHAMU / FISH_VOICE_COLON（Fish Audio の声のID）。
// 合いかぎがないとき・使えないときは 204 を返し、画面側はスマホの読み上げ声で代わりに話す。
// 決まり：薬・住所・電話番号などが入った文は、外の声サービスに送らない（スマホの読み上げにまかせる）。
import { fromOurPage, rateLimited, clientIp, readBody, cleanText } from "../lib/shared.js";
import { dailyGate } from "../lib/store.js";
const DEVICE_DAILY = 400; // 1台あたり1日に読み上げる回数の上限

const MODEL = process.env.PF_VOICE_MODEL || "s2.1-pro-free";
const RATE_MAX = 20; // 1分に20回まで（同じ接続元）
const MAX_CHARS = 200;
const PRIVATE = /薬|くすり|クスリ|病院|住所|番地|電話|\d{2,4}-\d{2,4}-\d{3,4}|〒/;

function noVoice(res, status = 204) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return noVoice(res, 405);
  if (!fromOurPage(req)) return noVoice(res, 403);
  if (rateLimited("voice:" + clientIp(req), RATE_MAX)) return noVoice(res, 429);
  const body = readBody(req);
  const text = cleanText(body?.text, MAX_CHARS);
  const char = body?.char === "chamu" ? "chamu" : "colon";
  if (!text || PRIVATE.test(text)) return noVoice(res);

  const key = process.env.FISH_API_KEY;
  const voice = char === "chamu" ? process.env.FISH_VOICE_CHAMU : process.env.FISH_VOICE_COLON;
  if (!key || !voice) return noVoice(res);
  // 登録した端末だけ。1日の回数の上限つき（だめなときは、画面がスマホの読み上げで代わりに話す）
  const gate = await dailyGate("voice", body?.id, body?.secret, DEVICE_DAILY);
  if (!gate.ok) return noVoice(res);

  try {
    const r = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", model: MODEL },
      // 声を高くして子どもらしくする（画面で速く再生して高くするので、ここではそのぶんゆっくり話させる）
      body: JSON.stringify({ text, reference_id: voice, format: "mp3", mp3_bitrate: 64, latency: "balanced", language: "ja", prosody: { speed: 0.8 } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.error("fish tts", r.status); // 合いかぎはログに出さない
      return noVoice(res);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.end(buf);
  } catch (err) {
    console.error("fish tts failed", err?.name);
    return noVoice(res);
  }
}
