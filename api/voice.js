// AIポケットファミリー: キャラの声（サーバー側）
// Fish Audio で、キャラの返事を声にする。合いかぎは環境変数 FISH_API_KEY（画面には出さない）。
// コロンの声は FISH_VOICE_COLON（Fish Audio の声のID）。ちゃむは作者の録音をお手本にして話す（下の CHAMU_REF_TEXT）。
// 合いかぎがないとき・使えないときは 204 を返し、画面側はスマホの読み上げ声で代わりに話す。
// 決まり：薬・住所・電話番号などが入った文は、外の声サービスに送らない（スマホの読み上げにまかせる）。
import { fromOurPage, rateLimited, clientIp, readBody, cleanText } from "../lib/shared.js";
import { dailyGate } from "../lib/store.js";
import { readFileSync } from "fs";

// ちゃむの声＝作者の録音を「お手本」にして話す（11/7・見本K）。
// 録音は private/ にあり、リポジトリには入れない（.gitignore）。Vercel には vercel.json の includeFiles で一緒に送る。
// Fish Audio は、お手本の録音を本文に入れるとき MessagePack で送る決まり（JSON は不可）。
const CHAMU_REF_TEXT = "作者、おかえりなさい。今日はどんな一日だった？ぼく、おなかすいちゃったよ。"; // 録音で話した文
let chamuRef; // 読み込みは1回だけ。読めないときは null（いつもの声にもどる）
function chamuRefAudio() {
  if (chamuRef === undefined) {
    try { chamuRef = readFileSync(new URL("../private/chamu_voice_ref.wav", import.meta.url)); } catch { chamuRef = null; }
  }
  return chamuRef;
}
// 小さな MessagePack の作り方（部品を足さずに済む）。null・真偽・数・文字・バイト列・配列・物だけ
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
  // ちゃむ＝作者の録音をお手本に（11/7）。録音が読めないときの予備は Fish Official「颯太 Sota」
  // （前は、じん 1.68倍（11/7 朝）、そうた 1.26倍（11/6）、しおり（〜11/5））
  const ref = char === "chamu" ? chamuRefAudio() : null;
  const voice = char === "chamu" ? "c496c7d0e93640a59a0befd78b47f39e" : process.env.FISH_VOICE_COLON;
  if (!key || !voice) return noVoice(res);
  // 登録した端末だけ。1日の回数の上限つき（だめなときは、画面がスマホの読み上げで代わりに話す）
  const gate = await dailyGate("voice", body?.id, body?.secret, DEVICE_DAILY);
  if (!gate.ok) return noVoice(res);

  try {
    // ちゃむ：画面で1.12倍に高くして再生する。話す速さは 1.15（実際は約1.29倍）。11/7夜 作者「もう少し速く」で 1.05→1.15
    const r = ref ? await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/msgpack", model: MODEL },
      body: mp({ text, references: [{ audio: ref, text: CHAMU_REF_TEXT }], format: "mp3", mp3_bitrate: 64, latency: "balanced", language: "ja", prosody: { speed: 1.15 } }),
      signal: AbortSignal.timeout(20000),
    }) : await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", model: MODEL },
      // 声を高くして子どもらしくする（画面で速く再生して高くするので、ここではそのぶんゆっくり話させる）。ちゃむ＝1.26倍（そうた・見本A・作者 11/6）。話す速さは、おっとりした食いしん坊らしく、ゆっくりに（0.794→0.73→0.67、作者 11/6）、コロン＝1.25倍
      body: JSON.stringify({ text, reference_id: voice, format: "mp3", mp3_bitrate: 64, latency: "balanced", language: "ja", prosody: { speed: char === "chamu" ? 1.0 : 0.8 } }),
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
