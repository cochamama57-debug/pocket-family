// AIポケットファミリー: 「助けて」を家族に知らせる（サーバー側）
// action:
//   "start"  … 8秒数え始める。サーバーが数えて、「いらない」が来なければ家族に送る（スマホの電源が切れても送られる）
//   "cancel" … 「いらない」。数えている途中なら止める
//   "now"    … すぐに送る
// 文章はサーバーで決まった形に組み立てる（画面から好きな文章は送らせない）。薬・住所などは入れない。
// 記録置き場やLINEの準備がないときは configured:false を返し、画面側だけで数える（どこにも送らない）。
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";
import { storeReady, redis, loadDevice } from "../lib/store.js";
import { lineReady, pushText } from "../lib/line.js";

const WAIT_MS = 8000;
const DAILY_MAX = 10; // 1台あたり1日に送れる回数
const PET_KINDS = new Set(["猫", "犬", "鳥", "うさぎ", "魚", "ペット"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function petText(pets) {
  const list = Array.isArray(pets)
    ? pets.slice(0, 10).map((x) => ({ kind: PET_KINDS.has(x?.kind) ? x.kind : "ペット", name: cleanText(x?.name, 12).replace(/[<>\[\]{}]/g, "") }))
    : [];
  return list.length ? "家に" + list.map((x) => x.kind + (x.name ? "の" + x.name : "")).join("、") + "がいます。" : "";
}
export function buildHelpText(body) {
  const name = cleanText(body?.name, 12).replace(/[<>\[\]{}]/g, "");
  const who = name ? name + "さん" : "AIポケットファミリーを使っている方";
  return "【AIポケットファミリー】" + who + "から「助けて」の合図がありました。様子を見に行くか、連絡をしてください。" + petText(body?.pets);
}

async function sendToFamily(id, dev, body) {
  if (await redis("GET", "help:sent:" + id)) return { sent: true, dup: true };
  // 二重に送らない（start と now が重なっても1回だけ）
  const lock = await redis("SET", "help:lock:" + id, "1", "NX", "EX", "20");
  if (!lock) {
    for (let i = 0; i < 10; i++) { await sleep(1000); if (await redis("GET", "help:sent:" + id)) return { sent: true, dup: true }; }
    return { sent: false, error: "server" };
  }
  const day = new Date().toISOString().slice(0, 10);
  const n = await redis("INCR", "help:count:" + id + ":" + day);
  if (n === 1) await redis("EXPIRE", "help:count:" + id + ":" + day, "90000");
  if (n > DAILY_MAX) { await redis("DEL", "help:lock:" + id); return { sent: false, error: "daily" }; }
  if (!dev.family.length) { await redis("DEL", "help:lock:" + id); return { sent: false, error: "no_family" }; }
  const text = buildHelpText({ name: dev.name || body?.name, pets: dev.pets?.length ? dev.pets : body?.pets });
  const results = await Promise.all(dev.family.map((to) => pushText(to, text)));
  const sent = results.some(Boolean);
  if (sent) await redis("SET", "help:sent:" + id, "1", "EX", "60");
  await redis("DEL", "help:lock:" + id);
  return { sent };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  if (!fromOurPage(req)) return reply(res, 403, { error: "forbidden" });
  if (rateLimited("help:" + clientIp(req), 10)) return reply(res, 429, { error: "busy" });
  const body = readBody(req);
  if (!body) return reply(res, 400, { error: "bad_request" });
  if (!storeReady() || !lineReady()) return reply(res, 200, { sent: false, configured: false });

  try {
    const dev = await loadDevice(body.id, body.secret);
    if (!dev) return reply(res, 200, { sent: false, configured: true, error: "no_family" });
    const id = body.id;
    if (body.action === "cancel") {
      await redis("SET", "help:cancel:" + id, "1", "EX", "60");
      return reply(res, 200, { cancelled: true, configured: true });
    }
    if (body.action === "now") {
      const r = await sendToFamily(id, dev, body);
      return reply(res, 200, { ...r, configured: true });
    }
    // start：サーバーで8秒数える
    await redis("DEL", "help:cancel:" + id, "help:sent:" + id, "help:lock:" + id);
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await sleep(1000);
      if (await redis("GET", "help:cancel:" + id)) return reply(res, 200, { sent: false, cancelled: true, configured: true });
      if (await redis("GET", "help:sent:" + id)) return reply(res, 200, { sent: true, configured: true });
    }
    const r = await sendToFamily(id, dev, body);
    return reply(res, 200, { ...r, configured: true });
  } catch (err) {
    console.error("help", err?.message);
    return reply(res, 502, { sent: false, configured: true, error: "server" });
  }
}
