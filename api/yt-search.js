// AIポケットファミリー: 好きな曲を YouTube から探す（サーバー側）
// 合いかぎは環境変数 YOUTUBE_API_KEY（作者の Google の無料枠。1日 約100回まで）。画面には出さない。
// 合いかぎがないときは「準備中」を返す。
import { fromOurPage, rateLimited, clientIp, readBody, reply, cleanText } from "../lib/shared.js";

const RATE_MAX = 6; // 1分に6回まで（同じ接続元）。無料枠を守るため
const DAILY_MAX = 80; // 1日の検索の上限（無料枠 約100回の手前で止める。サーバーごとの目安）
const cache = new Map(); // 同じ言葉の結果は使い回す
let day = "", count = 0;

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return reply(res, 405, { error: "method" });
  if (!fromOurPage(req)) return reply(res, 403, { error: "forbidden" });
  if (rateLimited("yt:" + clientIp(req), RATE_MAX)) {
    return reply(res, 429, { error: "busy", message: "ちょっと探しすぎちゃったみたい。少し休んでから、また探してね。" });
  }
  const q = cleanText(readBody(req)?.q, 60);
  if (!q) return reply(res, 400, { error: "bad_request", message: "曲の名前か、歌っている人を入れてね。" });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return reply(res, 200, { configured: false, items: [] });

  const ck = q.toLowerCase();
  if (cache.has(ck)) return reply(res, 200, { configured: true, items: cache.get(ck) });
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; count = 0; }
  if (++count > DAILY_MAX) return reply(res, 429, { error: "daily", message: "きょうは、もう探せないみたい。また明日ためしてね。" });

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet", type: "video", maxResults: "3", q,
    videoEmbeddable: "true", regionCode: "JP", relevanceLanguage: "ja", safeSearch: "strict", key,
  }).toString();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      console.error("youtube search", r.status); // 合いかぎはログに出さない
      return reply(res, 502, { error: "api", message: r.status === 403 ? "きょうは、もう探せないみたい。また明日ためしてね。" : "うまく探せなかったみたい。少ししてから、また探してね。" });
    }
    const data = await r.json();
    const items = (data.items || [])
      .map((it) => ({
        id: it?.id?.videoId,
        title: cleanText(decode(it?.snippet?.title), 80),
        channel: cleanText(decode(it?.snippet?.channelTitle), 40),
        thumb: it?.snippet?.thumbnails?.medium?.url || it?.snippet?.thumbnails?.default?.url || "",
      }))
      .filter((x) => /^[\w-]{11}$/.test(x.id || "") && x.title)
      .map((x) => ({ ...x, thumb: /^https:\/\/i\.ytimg\.com\//.test(x.thumb) ? x.thumb : "" }));
    if (cache.size > 300) cache.clear();
    cache.set(ck, items);
    return reply(res, 200, { configured: true, items });
  } catch (err) {
    console.error("youtube search failed", err?.name);
    return reply(res, 502, { error: "network", message: "うまく探せなかったみたい。少ししてから、また探してね。" });
  }
}
