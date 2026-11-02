// AIポケットファミリー: 「助けて」を家族に知らせる（サーバー側）
// いまは準備中。LINE公式アカウントの準備ができたら、ここから送る。
// 文章はサーバーで決まった形に組み立てる（画面から好きな文章は送らせない）。薬・住所などは入れない。
// TODO（11/4）: 家族を登録したときに作る「この端末の合言葉」を確かめる／1日の上限をサーバーの記録置き場で数える
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";

const PET_KINDS = new Set(["猫", "犬", "鳥", "うさぎ", "魚", "ペット"]);

export function buildHelpText(body) {
  const name = cleanText(body?.name, 12).replace(/[<>\[\]{}]/g, "");
  const pets = Array.isArray(body?.pets)
    ? body.pets.slice(0, 10)
        .map((x) => ({ kind: PET_KINDS.has(x?.kind) ? x.kind : "ペット", name: cleanText(x?.name, 12).replace(/[<>\[\]{}]/g, "") }))
    : [];
  const who = name ? name + "さん" : "AIポケットファミリーを使っている方";
  const petText = pets.length ? "家に" + pets.map((x) => x.kind + (x.name ? "の" + x.name : "")).join("、") + "がいます。" : "";
  return "【AIポケットファミリー】" + who + "から「助けて」の合図がありました。様子を見に行くか、連絡をしてください。" + petText;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  if (!fromOurPage(req)) return reply(res, 403, { error: "forbidden" });
  if (rateLimited("help:" + clientIp(req), 5)) return reply(res, 429, { error: "busy" });
  const body = readBody(req);
  if (!body) return reply(res, 400, { error: "bad_request" });
  const text = buildHelpText(body);
  void text; // 11/4 に LINE へ送る
  return reply(res, 200, { sent: false, configured: false });
}
