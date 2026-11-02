// 手元（Mac）で試すための小さなサーバー。公開には使わない。
// 使い方: npm run dev → http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const handlers = { chat: (await import("../api/chat.js")).default, memory: (await import("../api/memory.js")).default, help: (await import("../api/help.js")).default, "yt-search": (await import("../api/yt-search.js")).default };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

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
      if (process.env.PF_MOCK) {
        // 見た目の確認用：AIを呼ばずに決まった返事を返す
        res.setHeader("Content-Type", "application/json; charset=utf-8");
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
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  })
  .listen(process.env.PORT || 3000, "127.0.0.1", () => console.log("http://localhost:" + (process.env.PORT || 3000)));
