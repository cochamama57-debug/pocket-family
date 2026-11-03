// AIポケットファミリー: 「助けて」を家族に知らせる（サーバー側）
// action:
//   "start"  … 8秒数え始める。サーバーが数えて、「いらない」が来なければ家族に送る（スマホの電源が切れても送られる）
//   "cancel" … 「いらない」。数えている途中なら止める
//   "now"    … すぐに送る
// 文章はサーバーで決まった形に組み立てる（画面から好きな文章は送らせない）。薬・住所などは入れない。
// 記録置き場やLINEの準備がないときは configured:false を返し、画面側だけで数える（どこにも送らない）。
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";
import { storeReady, redis, loadDevice } from "../lib/store.js";
import crypto from "node:crypto";
import { lineReady, pushMessages, sticker } from "../lib/line.js";

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
// 名前に「さん」をつける（もう「さん」「ちゃん」などが付いていれば、そのまま）
export const honor = (name) => (/(さん|ちゃん|くん|君|様|さま)$/.test(name) ? name : name + "さん");
export function buildHelpText(body) {
  const name = cleanText(body?.name, 12).replace(/[<>\[\]{}]/g, "");
  const pets = petText(body?.pets);
  return "⚠️「助けて」の合図がありました‼️\n"
    + (name ? honor(name) + "からです。\n" : "")
    + "様子を見に行くか、連絡をしてください📲"
    + (pets ? "\n\n🐾 " + pets : "")
    + "\n\n（AIポケットファミリーより）";
}

// attempt：1回の「助けて」ごとの合言葉。「いらない」は同じ合言葉のときだけ効く（前の回の「いらない」が残っていても、新しい回を止めない）
const attemptOf = (body) => (typeof body?.attempt === "string" && /^[A-Za-z0-9]{6,40}$/.test(body.attempt) ? body.attempt : "");
async function isCancelled(id, attempt) {
  const c = await redis("GET", "help:cancel:" + id);
  return !!c && (!attempt || c === attempt);
}
async function wasSent(id, attempt) {
  const v = await redis("GET", "help:sent:" + id);
  return !!v && (!attempt || v === attempt);
}
async function sendToFamily(id, dev, body) {
  const attempt = attemptOf(body);
  if (await wasSent(id, attempt)) return { sent: true, dup: true };
  // 二重に送らない（start と now が重なっても1回だけ）
  const lock = await redis("SET", "help:lock:" + id, "1", "NX", "EX", "20");
  if (!lock) {
    for (let i = 0; i < 10; i++) { await sleep(1000); if (await wasSent(id, attempt)) return { sent: true, dup: true }; }
    return { sent: false, error: "server" };
  }
  // 送る直前にもう一度「いらない」を確かめる
  if (await isCancelled(id, attempt)) { await redis("DEL", "help:lock:" + id); return { sent: false, cancelled: true }; }
  const day = new Date().toISOString().slice(0, 10);
  const n = await redis("INCR", "help:count:" + id + ":" + day);
  if (n === 1) await redis("EXPIRE", "help:count:" + id + ":" + day, "90000");
  if (n > DAILY_MAX) { await redis("DEL", "help:lock:" + id); return { sent: false, error: "daily" }; }
  if (!dev.family.length) { await redis("DEL", "help:lock:" + id); return { sent: false, error: "no_family" }; }
  const text = buildHelpText({ name: dev.name || body?.name, pets: dev.pets?.length ? dev.pets : body?.pets });
  // 作者が選んだ順番：あわてるサリーのスタンプ → 文章 → 「よろしくお願いします」のスタンプ（LINEが用意したスタンプ）
  const messages = [sticker(11537, 52002756), { type: "text", text: text.slice(0, 1000) }, sticker(8515, 16581248)];
  // スタンプで失敗しても、文章だけは届ける。合言葉（retry key）を同じにして、二重に届かないようにする
  const results = await Promise.all(dev.family.map(async (to) => {
    const key = crypto.randomUUID();
    return (await pushMessages(to, messages, key)) || pushMessages(to, [messages[1]], key);
  }));
  const sent = results.some(Boolean);
  if (sent) await redis("SET", "help:sent:" + id, attempt || "1", "EX", "60");
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
    const attempt = attemptOf(body);
    if (body.action === "cancel") {
      await redis("SET", "help:cancel:" + id, attempt || "1", "EX", "60");
      // 「いらない」が間に合わず、もう送っていたら、そう伝える
      const already = await wasSent(id, attempt);
      return reply(res, 200, { cancelled: !already, sent: already, configured: true });
    }
    if (body.action === "now") {
      const r = await sendToFamily(id, dev, body);
      return reply(res, 200, { ...r, configured: true });
    }
    // start：サーバーで8秒数える（前の回の印は消さない。合言葉で見分ける）
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
      await sleep(1000);
      if (await isCancelled(id, attempt)) return reply(res, 200, { sent: false, cancelled: true, configured: true });
      if (await wasSent(id, attempt)) return reply(res, 200, { sent: true, configured: true });
    }
    const r = await sendToFamily(id, dev, body);
    return reply(res, 200, { ...r, configured: true });
  } catch (err) {
    console.error("help", err?.message);
    return reply(res, 502, { sent: false, configured: true, error: "server" });
  }
}
