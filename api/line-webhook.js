// AIポケットファミリー: LINE公式アカウントに届いた知らせ（サーバー側）
// 家族が友だち追加したら案内を返し、6けたの番号が送られてきたら、その家族を端末に登録する。
// LINEの署名を確かめて、本物の知らせだけを受け付ける。
import { reply } from "../lib/shared.js";
import { storeReady, redis, readDevice } from "../lib/store.js";
import { honor } from "./help.js";

const MAX_WRONG = 5; // 1時間に、まちがった番号を送れる回数（当てずっぽうを防ぐ）
import { lineReady, verifySignature, replyText } from "../lib/line.js";

async function rawBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 200_000) break;
  }
  return raw;
}

const HOW_TO = "AIポケットファミリーです。友だち追加ありがとうございます。\nご家族のアプリに出ている「6けたの番号」を、このトークに送ってください。登録すると、「助けて」の合図や、しばらくアプリを開いていないときに、ここでお知らせします。";

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  const raw = typeof req.body === "string" ? req.body : await rawBody(req);
  if (!lineReady() || !storeReady()) return reply(res, 200, { ok: true });
  if (!verifySignature(raw, req.headers["x-line-signature"])) return reply(res, 401, { error: "signature" });

  let body;
  try { body = JSON.parse(raw); } catch { return reply(res, 400, { error: "bad_request" }); }
  for (const ev of Array.isArray(body?.events) ? body.events : []) {
    try {
      const userId = ev?.source?.type === "user" ? ev.source.userId : null;
      if (!userId) continue;
      if (ev.type === "follow") { await replyText(ev.replyToken, HOW_TO); continue; }
      if (ev.type !== "message" || ev.message?.type !== "text") continue;
      const text = String(ev.message.text || "").replace(/[\s０-９]/g, (c) => (/\s/.test(c) ? "" : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
      if (!/^\d{6}$/.test(text)) { await replyText(ev.replyToken, HOW_TO); continue; }
      const tryKey = "codetry:" + userId;
      const wrong = Number(await redis("GET", tryKey)) || 0;
      if (wrong >= MAX_WRONG) { await replyText(ev.replyToken, "番号のまちがいが続いたので、しばらく受け付けを止めています。1時間ほどたってから、もう一度送ってください。"); continue; }
      const devId = await redis("GETDEL", "code:" + text); // 取り出すと同時に消す（同じ番号は1回だけ）
      if (!devId) {
        const n = await redis("INCR", tryKey);
        if (n === 1) await redis("EXPIRE", tryKey, "3600");
        await replyText(ev.replyToken, "その番号は見つかりませんでした。番号は30分で使えなくなります。アプリで新しい番号を出して、もう一度送ってください。");
        continue;
      }
      await redis("DEL", "devcode:" + devId);
      const dev = await readDevice(devId);
      if (!dev) continue;
      const count = Number(await redis("SCARD", "fam:" + devId)) || 0;
      if (count >= 5 && !(await redis("SISMEMBER", "fam:" + devId, userId))) {
        await replyText(ev.replyToken, "登録できる家族は5人までです。アプリの「登録した家族を消す」で消してから、もう一度お願いします。");
        continue;
      }
      await redis("SADD", "fam:" + devId, userId);
      await redis("ZADD", "seen", String(dev.lastSeen || Date.now()), devId); // 見回りの対象に入れる
      const who = dev.name ? honor(dev.name) : "ご家族";
      await replyText(ev.replyToken, "登録しました。" + who + "から「助けて」の合図があったときや、しばらくアプリを開いていないときに、ここでお知らせします。");
    } catch (err) {
      console.error("webhook event", err?.message);
    }
  }
  return reply(res, 200, { ok: true });
}
