// AIポケットファミリー: 家族の登録と「元気だよ」の合図（サーバー側）
// action:
//   "hello"  … アプリを開いた合図（最後に開いた時刻・呼び名・ペット・何日で知らせるか）
//   "code"   … 家族を登録するための6けたの番号を作る（30分だけ有効）
//   "status" … 登録している家族の人数と、友だち追加のリンク
//   "unlink" … 登録している家族を全部消す
// 端末は {id, secret}（端末の中で作った合言葉）で確かめる。記録置き場やLINEの準備がないときは configured:false。
import crypto from "node:crypto";
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";
import { storeReady, redis, ensureDevice, loadDevice, saveDevice } from "../lib/store.js";
import { lineReady } from "../lib/line.js";

const PET_KINDS = new Set(["猫", "犬", "鳥", "うさぎ", "魚", "ペット"]);
const QUIET_CHOICES = new Set([0, 1, 2, 3, 5, 7]); // 0 = 知らせない

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  if (!fromOurPage(req)) return reply(res, 403, { error: "forbidden" });
  if (rateLimited("family:" + clientIp(req), 20)) return reply(res, 429, { error: "busy" });
  if (!storeReady() || !lineReady()) return reply(res, 200, { configured: false });

  const body = readBody(req);
  const action = body?.action;
  try {
    const dev = action === "hello" ? await ensureDevice(body?.id, body?.secret) : await loadDevice(body?.id, body?.secret);
    if (!dev) return reply(res, 403, { error: "device" });

    if (action === "hello") {
      dev.lastSeen = Date.now();
      dev.name = cleanText(body?.name, 12).replace(/[<>\[\]{}]/g, "");
      dev.pets = Array.isArray(body?.pets)
        ? body.pets.slice(0, 10).map((x) => ({ kind: PET_KINDS.has(x?.kind) ? x.kind : "ペット", name: cleanText(x?.name, 12).replace(/[<>\[\]{}]/g, "") }))
        : [];
      const q = Number(body?.quietDays);
      if (QUIET_CHOICES.has(q)) dev.quietDays = q;
      await saveDevice(body.id, dev);
      await redis("DEL", "alerted:" + body.id); // 開いたので、次にまた知らせられるように
      // 「しばらく開いていない」を見つけやすくするため、最後に開いた時刻の順に並べておく
      await redis("ZADD", "seen", String(dev.lastSeen), body.id);
      return reply(res, 200, { configured: true, family: dev.family.length });
    }
    if (action === "code") {
      // 1台につき使える番号は1つだけ（前の番号は消す）。ほかの端末の番号とは重ならないようにする
      const old = await redis("GET", "devcode:" + body.id);
      if (old) await redis("DEL", "code:" + old);
      let code = "";
      for (let i = 0; i < 8 && !code; i++) {
        const c = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
        if (await redis("SET", "code:" + c, body.id, "NX", "EX", "1800")) code = c;
      }
      if (!code) return reply(res, 502, { error: "store" });
      await redis("SET", "devcode:" + body.id, code, "EX", "1800");
      return reply(res, 200, { configured: true, code, addUrl: process.env.PF_LINE_ADD_URL || "" });
    }
    if (action === "status") {
      return reply(res, 200, { configured: true, family: dev.family.length, addUrl: process.env.PF_LINE_ADD_URL || "", quietDays: dev.quietDays ?? 3 });
    }
    if (action === "unlink") {
      await redis("DEL", "fam:" + body.id);
      return reply(res, 200, { configured: true, family: 0 });
    }
    return reply(res, 400, { error: "bad_request" });
  } catch (err) {
    console.error("family", err?.message);
    return reply(res, 502, { error: "store" });
  }
}
