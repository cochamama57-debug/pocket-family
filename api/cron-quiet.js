// AIポケットファミリー: しばらくアプリを開いていない人の家族に知らせる（毎日の見回り）
// Vercel の定時実行（vercel.json）から呼ばれる。合言葉 CRON_SECRET がないと動かない。
// 決めた日数（端末ごと。0は知らせない）を過ぎても開いていなければ、登録した家族に一度だけ知らせる。
import { reply } from "../lib/shared.js";
import crypto from "node:crypto";
import { storeReady, redis, readDevice, familyOf } from "../lib/store.js";
import { lineReady, pushText } from "../lib/line.js";
import { petText, honor } from "./help.js";

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
  let notified = 0, checked = 0;
  const ids = (await redis("ZRANGEBYSCORE", "seen", "0", String(cutoff), "LIMIT", "0", "500").catch(() => null)) || [];
  for (const id of ids) {
    // 1台ずつ。1台で失敗しても、ほかの人の見回りは続ける
    try {
      checked++;
      const dev = await readDevice(id);
      const family = dev ? await familyOf(id, dev) : [];
      const days = Number(dev?.quietDays ?? 3);
      // 見回りの名簿から外す：記録がない／家族がいない／知らせない設定（アプリを開けば、また名簿に入る）
      if (!dev || !family.length || (!(days > 0) && !(demoMin > 0))) { await redis("ZREM", "seen", id); continue; }
      if (await redis("GET", "alerted:" + id)) { await redis("ZREM", "seen", id); continue; }
      const limit = demoMin > 0 ? demoMin * 60 * 1000 : days * DAY;
      if (now - (dev.lastSeen || 0) < limit) continue;
      const who = dev.name ? honor(dev.name) : "ご家族";
      const span = demoMin > 0 ? demoMin + "分" : days + "日";
      const pets = petText(dev.pets);
      const text = "📱" + who + "が、" + span + "のあいだアプリを開いていません。\n念のため、連絡をしてみてください📲"
        + (pets ? "\n\n🐾 " + pets : "") + "\n\n（AIポケットファミリーより）";
      const key = () => crypto.randomUUID();
      const results = await Promise.all(family.map((to) => pushText(to, text, key())));
      if (results.some(Boolean)) {
        // 知らせた印。アプリを開くと消える（次の「しばらく」でまた知らせる）
        await redis("SET", "alerted:" + id, "1");
        await redis("ZREM", "seen", id);
        notified++;
      }
    } catch (err) {
      console.error("cron-quiet device", err?.message);
    }
  }
  return reply(res, 200, { ok: true, notified, checked });
}
