// 手元（Mac）で試すための小さなサーバー。公開には使わない。
// 使い方: npm run dev → http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../api/chat.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/chat") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) { res.statusCode = 413; return res.end(); }
      }
      req.body = raw;
      if (process.env.PF_MOCK) {
        // 見た目の確認用：AIを呼ばずに決まった返事を返す
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return setTimeout(() => res.end(JSON.stringify({ reply: "そっかぁ、きょうは雨だったんだね。おうちでゆっくりできた？" })), 800);
      }
      return handler(req, res);
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
  .listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
