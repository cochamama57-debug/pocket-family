// AIポケットファミリー: 「助けて」を家族に知らせる（サーバー側）
// いまは準備中。LINE公式アカウントの準備ができたら、ここから送る。
// 送る文章には、薬・住所などは入れない（画面側で組み立てる文章は、名前とペットだけ）。
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  if (!fromOurPage(req)) return reply(res, 403, { error: "forbidden" });
  if (rateLimited("help:" + clientIp(req), 5)) return reply(res, 429, { error: "busy" });
  const body = readBody(req);
  const message = cleanText(body?.message, 300);
  if (!message) return reply(res, 400, { error: "bad_request" });
  // TODO（11/4）: LINE公式アカウントから、登録した家族へ送る
  return reply(res, 200, { sent: false, configured: false });
}
