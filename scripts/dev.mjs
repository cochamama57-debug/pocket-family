// 手元（Mac）で試すための小さなサーバー。公開には使わない。
// 使い方: npm run dev → http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const handlers = { chat: (await import("../api/chat.js")).default, memory: (await import("../api/memory.js")).default, help: (await import("../api/help.js")).default, "yt-search": (await import("../api/yt-search.js")).default, voice: (await import("../api/voice.js")).default,
  family: (await import("../api/family.js")).default, "line-webhook": (await import("../api/line-webhook.js")).default, "cron-quiet": (await import("../api/cron-quiet.js")).default, drawing: (await import("../api/drawing.js")).default };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".json": "application/json", ".webmanifest": "application/manifest+json" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const apiName = url.pathname.startsWith("/api/") ? url.pathname.slice(5) : null;
    if (apiName && handlers[apiName]) {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) { res.statusCode = 413; return res.end(); }
      }
      req.body = raw;
      const realFamily = process.env.PF_FAMILY_REAL && ["family", "help", "line-webhook", "cron-quiet"].includes(apiName);
      if (process.env.PF_MOCK && apiName === "drawing") return handlers[apiName](req, res); // 絵は、関数の中の試し用の絵を返す
      if (process.env.PF_MOCK && !realFamily) {
        // 見た目の確認用：AIを呼ばずに決まった返事を返す
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        if (apiName === "voice") { res.statusCode = 204; return res.end(); }
        if (apiName === "family") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ configured: false })); }
        const mock = apiName === "yt-search" ? { configured: true, items: [{ id: "Jh53iS0Kwng", title: "【Healing water】水の歌", channel: "nekomori - 音弧の森音楽舎", thumb: "" }, { id: "M7lc1UVf-VE", title: "テスト動画", channel: "YouTube", thumb: "" }] } : apiName === "help" ? { sent: false, configured: false } : apiName === "memory"
          ? { notes: ["雨の日は家でのんびりすごす", "水の歌が好き"], habits: ["「のんびりいこうね」が合言葉"] }
          : { reply: "そっかぁ、きょうは雨だったんだね。おうちでゆっくりできた？", song: (JSON.parse(raw || "{}").songs || [])[0]?.id,
            walk: raw.includes("散歩") ? true : undefined,
            help: raw.includes("倒れた") ? "now" : raw.includes("たすけて") ? "ask" : undefined,
            plan: raw.includes("歯医者") ? { date: "2026-11-03", time: "10:00", text: "歯医者" } : undefined };
        return setTimeout(() => res.end(JSON.stringify(mock)), 800);
      }
      return handlers[apiName](req, res);
    }
    const file = path.normalize(path.join(root, url.pathname === "/" ? "index.html" : url.pathname));
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    try {
      const data = await readFile(file);
      res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
      res.setHeader("Accept-Ranges", "bytes");
      // 曲の途中へ飛べるように（本番の Vercel と同じく、範囲の取り出しに答える）
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
        if (start > end || start >= data.length) { res.statusCode = 416; res.setHeader("Content-Range", "bytes */" + data.length); return res.end(); }
        res.statusCode = 206;
        res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + data.length);
        return res.end(data.subarray(start, end + 1));
      }
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  })
  .listen(process.env.PORT || 3000, "127.0.0.1", () => console.log("http://localhost:" + (process.env.PORT || 3000)));
