// AIポケットファミリー: キャラの声（サーバー側）
// Fish Audio で、キャラの返事を声にする。合いかぎは環境変数 FISH_API_KEY（画面には出さない）。
// 声の種類は FISH_VOICE_CHAMU / FISH_VOICE_COLON（Fish Audio の声のID）。
// 合いかぎがないとき・使えないときは 204 を返し、画面側はスマホの読み上げ声で代わりに話す。
// 決まり：薬・住所・電話番号などが入った文は、外の声サービスに送らない（スマホの読み上げにまかせる）。
import { fromOurPage, rateLimited, clientIp, readBody, cleanText } from "../lib/shared.js";
import { dailyGate } from "../lib/store.js";
import { createHash } from "crypto";

// 声えらびの見本づくり（一時的・11/7）：作者の録音をお手本にして話す（Fish の references は MessagePack で送る決まり）。
// 決めた1つの録音（ハッシュが一致するもの）だけ受け付ける。録音そのものはリポジトリに入れない
const TRIAL_REF_SHA = "c433a9bf58ac24e826d1e0f43bc751c7c581fe77fd5da8a0d486ce0c3044a910";
function mp(v) {
  if (v === null || v === undefined) return Buffer.from([0xc0]);
  if (typeof v === "boolean") return Buffer.from([v ? 0xc3 : 0xc2]);
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 0 && v < 0x100000000) { const b = Buffer.alloc(5); b[0] = 0xce; b.writeUInt32BE(v, 1); return b; }
    const b = Buffer.alloc(9); b[0] = 0xcb; b.writeDoubleBE(v, 1); return b;
  }
  if (typeof v === "string") { const d = Buffer.from(v, "utf8"); const h = Buffer.alloc(5); h[0] = 0xdb; h.writeUInt32BE(d.length, 1); return Buffer.concat([h, d]); }
  if (Buffer.isBuffer(v)) { const h = Buffer.alloc(5); h[0] = 0xc6; h.writeUInt32BE(v.length, 1); return Buffer.concat([h, v]); }
  if (Array.isArray(v)) { const h = Buffer.alloc(5); h[0] = 0xdd; h.writeUInt32BE(v.length, 1); return Buffer.concat([h, ...v.map(mp)]); }
  const ks = Object.keys(v).filter((k) => v[k] !== undefined); const h = Buffer.alloc(5); h[0] = 0xdf; h.writeUInt32BE(ks.length, 1);
  return Buffer.concat([h, ...ks.flatMap((k) => [mp(k), mp(v[k])])]);
}
const DEVICE_DAILY = 1000; // 1台あたり1日に読み上げる回数の上限

const MODEL = process.env.PF_VOICE_MODEL || "s2.1-pro-free";
const RATE_MAX = 40; // 1分に40回まで（同じ接続元。本の読み上げで続けて使うため）
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
  // ちゃむ＝Fish Official「じん Jin」（落ち着いたおじさんの声）を画面で1.68倍に高くする（見本2c・作者 11/7「アニメ声すぎる・ぼーっとした感じに」）。
  // 前は「颯太 Sota」を1.26倍（11/6）、その前は FISH_VOICE_CHAMU（しおり）
  const CHAMU_VOICE = "d738c70d206149e69f8e3b6fc8af9d96";
  // 声えらびの見本づくり（一時的。作者 11/7「アニメ声すぎる・ぼーっとした感じに」。決まったら外す）。Fish Official の声だけ
  const TRIAL = new Set(["c496c7d0e93640a59a0befd78b47f39e", "d738c70d206149e69f8e3b6fc8af9d96", "59a78821a8924989b70d2a63d588e8eb", "297a6fd278df47c3b9da9bfdf55ac89a", "bf5634e34ee5489991fe687ad0d202c5", "b2d9d8db057042688a5e318b8f405bc2"]);
  const trial = typeof body?.trial === "string" && TRIAL.has(body.trial) ? body.trial : "";
  const trialSpeed = trial && typeof body?.trialSpeed === "number" ? Math.max(0.5, Math.min(1.2, body.trialSpeed)) : 0;
  const voice = trial || (char === "chamu" ? CHAMU_VOICE : process.env.FISH_VOICE_COLON);
  // ちゃむは、明るい話し方に（Fish S2 の話し方の札。言葉としては読まれない。見本2・作者 11/6「話し方が暗い」）
  // （11/7 じんにしてからは、話し方の札は付けない＝ぼーっとした感じのまま）
  const style = "";
  if (!key || !voice) return noVoice(res);
  // 登録した端末だけ。1日の回数の上限つき（だめなときは、画面がスマホの読み上げで代わりに話す）
  const gate = await dailyGate("voice", body?.id, body?.secret, DEVICE_DAILY);
  if (!gate.ok) return noVoice(res);

  // 一時的：お手本の録音（決めた1つだけ）
  let refAudio = null;
  if (typeof body?.trialRef === "string" && body.trialRef.length < 1500000) {
    const b = Buffer.from(body.trialRef, "base64");
    if (createHash("sha256").update(b).digest("hex") === TRIAL_REF_SHA) refAudio = b;
  }
  try {
    const r = refAudio ? await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/msgpack", model: MODEL },
      body: mp({ text, references: [{ audio: refAudio, text: cleanText(body?.trialRefText, 200) || "" }], format: "mp3", mp3_bitrate: 64, latency: "balanced", language: "ja", prosody: { speed: trialSpeed || 0.8 } }),
      signal: AbortSignal.timeout(20000),
    }) : await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", model: MODEL },
      // 声を高くして子どもらしくする（画面で速く再生して高くするので、ここではそのぶんゆっくり話させる）。ちゃむ＝1.26倍（そうた・見本A・作者 11/6）。話す速さは、おっとりした食いしん坊らしく、ゆっくりに（0.794→0.73→0.67、作者 11/6）、コロン＝1.25倍
      body: JSON.stringify({ text: style + text, reference_id: voice, format: "mp3", mp3_bitrate: 64, latency: "balanced", language: "ja", prosody: { speed: trialSpeed || (char === "chamu" ? 0.5 : 0.8) } }),
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
