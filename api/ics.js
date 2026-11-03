// AIポケットファミリー: 予定・お薬の時間を、スマホのカレンダーに入れるためのファイル（.ics）を作る（iPhone 向け）
// アプリを閉じていても、スマホのカレンダーがお知らせしてくれるようになる。
// 中身は、画面から受け取った「日付・時刻・短い題名」だけ。サーバーには何も残さない。
import { rateLimited, clientIp, cleanText, validDate } from "../lib/shared.js";

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
const pad = (n) => String(n).padStart(2, "0");
// 日本時間の日時 → UTC の書き方（20261105T010000Z）
function jstToUtc(date, time) {
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh - 9, mm));
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + "T" + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + "00Z";
}
function nextDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate());
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.statusCode = 405; return res.end(); }
  if (rateLimited("ics:" + clientIp(req), 20)) { res.statusCode = 429; return res.end(); }
  const q = new URL(req.url, "http://x").searchParams;
  const title = cleanText(q.get("t"), 30) || "予定";
  const date = q.get("d") || "";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(q.get("h") || "") ? q.get("h") : "";
  const daily = q.get("r") === "daily";
  if (!validDate(date) || (daily && !time)) { res.statusCode = 400; return res.end(); }

  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const uid = Math.random().toString(36).slice(2) + Date.now().toString(36) + "@pocket-family";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Pocket Family//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + now, "SUMMARY:" + esc(title), "DESCRIPTION:" + esc("AIポケットファミリーより")];
  if (time) {
    const [hh, mm] = time.split(":").map(Number);
    const end = pad((hh + (mm + 30 >= 60 ? 1 : 0)) % 24) + ":" + pad((mm + 30) % 60);
    lines.push("DTSTART:" + jstToUtc(date, time), "DTEND:" + jstToUtc(date, hh === 23 && mm >= 30 ? "23:59" : end));
  } else {
    lines.push("DTSTART;VALUE=DATE:" + date.replace(/-/g, ""), "DTEND;VALUE=DATE:" + nextDay(date));
  }
  if (daily) lines.push("RRULE:FREQ=DAILY");
  // お知らせ：時間のある予定は30分前と、その時間。お薬はその時間。日にちだけの予定は、その日の朝9時
  const alarm = (trigger) => lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(title), "TRIGGER:" + trigger, "END:VALARM");
  if (daily) alarm("PT0M");
  else if (time) { alarm("-PT30M"); alarm("PT0M"); }
  else alarm("PT9H");
  lines.push("END:VEVENT", "END:VCALENDAR");

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="pocket-family.ics"');
  res.setHeader("Cache-Control", "no-store");
  res.end(lines.join("\r\n") + "\r\n");
}
