// AIポケットファミリー: しばらくアプリを開いていない人の家族に知らせる（毎日の見回り）
// Vercel の定時実行（vercel.json）から呼ばれる。合言葉 CRON_SECRET がないと動かない。
// 決めた日数（端末ごと。0は知らせない）を過ぎても開いていなければ、登録した家族に一度だけ知らせる。
import { reply } from "../lib/shared.js";
import { storeReady, redis } from "../lib/store.js";
import { lineReady, pushText } from "../lib/line.js";
import { petText } from "./help.js";

const DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers["authorization"] !== "Bearer " + secret) return reply(res, 401, { error: "unauthorized" });
  if (!storeReady() || !lineReady()) return reply(res, 200, { configured: false });
  // デモ用：?minutes=N で「N分開いていない」を見る（合言葉が必要なので、ふつうの人は使えない）
  const url = new URL(req.url, "http://x");
  const demoMin = Number(url.searchParams.get("minutes"));
  const now = Date.now();
  const cutoff = demoMin > 0 ? now - demoMin * 60 * 1000 : now - 1 * DAY;
  let notified = 0;
  try {
    const ids = (await redis("ZRANGEBYSCORE", "seen", "0", String(cutoff), "LIMIT", "0", "200")) || [];
    for (const id of ids) {
      const raw = await redis("GET", "dev:" + id);
      const dev = raw ? JSON.parse(raw) : null;
      if (!dev || dev.alerted || !dev.family?.length) continue;
      const days = Number(dev.quietDays ?? 3);
      if (!(days > 0) && !(demoMin > 0)) continue;
      const limit = demoMin > 0 ? demoMin * 60 * 1000 : days * DAY;
      if (now - dev.lastSeen < limit) continue;
      const who = dev.name ? dev.name + "さん" : "ご家族";
      const span = demoMin > 0 ? demoMin + "分" : days + "日";
      const text = "【AIポケットファミリー】" + who + "が、" + span + "のあいだアプリを開いていません。念のため、連絡をしてみてください。" + petText(dev.pets);
      await Promise.all(dev.family.map((to) => pushText(to, text)));
      dev.alerted = true;
      await redis("SET", "dev:" + id, JSON.stringify(dev));
      notified++;
    }
    return reply(res, 200, { ok: true, notified });
  } catch (err) {
    console.error("cron-quiet", err?.message);
    return reply(res, 502, { error: "server" });
  }
}
