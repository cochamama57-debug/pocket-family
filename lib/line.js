// AIポケットファミリー: LINE公式アカウント（Messaging API）
// 合いかぎは環境変数 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET（画面には出さない）。
import crypto from "node:crypto";

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const SECRET = process.env.LINE_CHANNEL_SECRET || "";

export const lineReady = () => !!(TOKEN && SECRET);

// LINEから届いた知らせが本物か確かめる
export function verifySignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  const mac = crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64");
  const a = Buffer.from(mac), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 送れたら true。失敗・時間切れは false（例外は投げない）。
// retryKey：同じ合言葉で2回送っても、LINEが1回分しか届けない（409＝もう届いている）
async function call(path, body, retryKey) {
  try {
    const headers = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
    if (retryKey) headers["X-Line-Retry-Key"] = retryKey;
    const r = await fetch((process.env.LINE_API_BASE || "https://api.line.me/v2/bot/") + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 409 && retryKey) return true;
    if (!r.ok) console.error("line api", path, r.status); // 合いかぎ・中身はログに出さない
    return r.ok;
  } catch (err) {
    console.error("line api", path, err?.name || "error");
    return false;
  }
}

// まとめて送る（1回で最大5つ。吹き出しがいくつでも、数えるのは1通）
export const pushMessages = (to, messages, retryKey) => call("message/push", { to, messages: messages.slice(0, 5) }, retryKey);
export const sticker = (packageId, stickerId) => ({ type: "sticker", packageId: String(packageId), stickerId: String(stickerId) });
export const pushText = (to, text, retryKey) => call("message/push", { to, messages: [{ type: "text", text: String(text).slice(0, 1000) }] }, retryKey);
export const replyText = (replyToken, text) => call("message/reply", { replyToken, messages: [{ type: "text", text: String(text).slice(0, 1000) }] });
