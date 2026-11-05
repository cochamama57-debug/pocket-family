// 見張り役の試験：わざと間違いを1つ混ぜた日記（bad）と、正しい日記（clean）を見せて、
// 間違いを見つけられるか・正しい日記をまちがって直さないかを数える。使い方：node scripts/eval/eval-check.mjs [出力ファイル]
import fs from "fs";
const U = process.env.PF_URL || "https://pocket-family-eight.vercel.app";
const out = process.argv[2] || "check-eval-result.json";
const cases = JSON.parse(fs.readFileSync(new URL("./diary-cases.json", import.meta.url), "utf8"));
const planted = JSON.parse(fs.readFileSync(new URL("./diary-planted.json", import.meta.url), "utf8"));
const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
let dev, used = 0;
async function newDev() { dev = { id: hex(16), secret: hex(32) }; used = 0; await fetch(U + "/api/family", { method: "POST", headers: { "Content-Type": "application/json", Origin: U }, body: JSON.stringify({ action: "hello", id: dev.id, secret: dev.secret, name: "試験", quietDays: 0, pets: [] }) }); }
await newDev();
const results = [];
for (const p of planted) {
  const c = cases.find((x) => x.id === p.id);
  const messages = c.talk.map((l) => ({ role: l.startsWith("本人:") ? "user" : "assistant", content: l.replace(/^(本人|キャラ):/, "") }));
  for (const which of ["clean", "bad"]) {
    if (used >= 18) await newDev();
    const body = { kind: c.kind, messages, call: "はなこさん", charName: "ちゃむ", char: "chamu", polite: false, date: "2026-11-05", id: dev.id, secret: dev.secret, eval: true, evalDiary: { title: p.title, body: p[which], note: "" } };
    if (c.base) body.base = c.base;
    if (c.draft) { body.draft = c.draft; body.fix = c.fix; }
    let r, j;
    for (let k = 0; k < 3; k++) { r = await fetch(U + "/api/diary", { method: "POST", headers: { "Content-Type": "application/json", Origin: U }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); if (r.status !== 429) break; await new Promise((ok) => setTimeout(ok, 15000)); }
    used++;
    const found = (j.problems || []).length;
    const removed = which === "bad" ? !String(j.body || "").includes(p.planted) : null;
    const changed = which === "clean" ? j.body !== p.clean : null;
    results.push({ id: p.id, which, type: p.type, planted: p.planted, status: r.status, skipped: j.skipped, found, problems: j.problems, removed, changed, before: p[which], after: j.body });
    console.log(p.id, which, r.status, "見つけた:" + found, which === "bad" ? "混ぜた言葉を消せた:" + removed : "正しい日記を変えた:" + changed);
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    await new Promise((ok) => setTimeout(ok, 11000));
  }
}
const bad = results.filter((r) => r.which === "bad"), clean = results.filter((r) => r.which === "clean");
console.log("\n間違いを見つけた:", bad.filter((r) => r.found > 0).length + "/" + bad.length, "／ 混ぜた言葉を消せた:", bad.filter((r) => r.removed).length + "/" + bad.length);
console.log("正しい日記でまちがって知らせた:", clean.filter((r) => r.found > 0).length + "/" + clean.length, "／ 正しい日記を変えた:", clean.filter((r) => r.changed).length + "/" + clean.length);
