// 日記のまとめの試験（裏の見張り役の確認用）。使い方：node scripts/eval/eval-diary.mjs [出力ファイル]
// 本番の /api/diary に、作り話の会話（diary-cases.json）を送り、見張り役の前（raw）と後の日記を保存する。
// 合いかぎは使わない（本番のサーバーが持っている）。試験用の端末を1つ登録して使う。
import fs from "fs";
const U = process.env.PF_URL || "https://pocket-family-eight.vercel.app";
const out = process.argv[2] || "diary-eval-result.json";
const cases = JSON.parse(fs.readFileSync(new URL("./diary-cases.json", import.meta.url), "utf8"));
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const dev = { id: hex(16), secret: hex(32) };
await fetch(U + "/api/family", { method: "POST", headers: { "Content-Type": "application/json", Origin: U }, body: JSON.stringify({ action: "hello", id: dev.id, secret: dev.secret, name: "試験", quietDays: 0, pets: [] }) });
const results = [];
for (const c of cases) {
  const messages = c.talk.map((l) => ({ role: l.startsWith("本人:") ? "user" : "assistant", content: l.replace(/^(本人|キャラ):/, "") }));
  const body = { kind: c.kind, messages, call: "はなこさん", charName: "ちゃむ", char: "chamu", polite: false, date: "2026-11-05", id: dev.id, secret: dev.secret, eval: true };
  if (c.base) body.base = c.base;
  if (c.draft) { body.draft = c.draft; body.fix = c.fix; }
  const t = Date.now();
  let r, j;
  for (let k = 0; k < 3; k++) {
    r = await fetch(U + "/api/diary", { method: "POST", headers: { "Content-Type": "application/json", Origin: U }, body: JSON.stringify(body) });
    j = await r.json().catch(() => ({}));
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 15000));
  }
  const sec = ((Date.now() - t) / 1000).toFixed(1);
  results.push({ id: c.id, note: c.note, talk: c.talk, base: c.base, fix: c.fix, status: r.status, sec, raw: j.raw, problems: j.problems, check: j.check, final: { title: j.title, body: j.body, note: j.note } });
  console.log(c.id, r.status, sec + "秒", JSON.stringify(j.check || j.message || j.error));
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  await new Promise((ok) => setTimeout(ok, 11000)); // 1分に6回までの決まりを守る
}
