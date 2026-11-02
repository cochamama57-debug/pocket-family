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

async function call(path, body) {
  const r = await fetch((process.env.LINE_API_BASE || "https://api.line.me/v2/bot/") + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) console.error("line api", path, r.status); // 合いかぎ・中身はログに出さない
  return r.ok;
}

export const pushText = (to, text) => call("message/push", { to, messages: [{ type: "text", text: String(text).slice(0, 1000) }] });
export const replyText = (replyToken, text) => call("message/reply", { replyToken, messages: [{ type: "text", text: String(text).slice(0, 1000) }] });
