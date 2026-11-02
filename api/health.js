// AIポケットファミリー: つながりの確認（中身や合いかぎは返さない。準備ができているかだけ）
import { reply } from "../lib/shared.js";
import { storeReady, redis } from "../lib/store.js";
import { lineReady } from "../lib/line.js";

export default async function handler(req, res) {
  let store = storeReady() ? "set" : "missing";
  if (store === "set") {
    try { store = (await redis("PING")) === "PONG" ? "ok" : "error"; } catch { store = "error"; }
  }
  return reply(res, 200, { store, line: lineReady() ? "set" : "missing", youtube: process.env.YOUTUBE_API_KEY ? "set" : "missing", voice: process.env.FISH_API_KEY ? "set" : "missing" });
}
