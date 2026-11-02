// AIポケットファミリー: サーバー側の小さな記録置き場（Upstash Redis の REST）
// 合いかぎは環境変数（KV_REST_API_URL / KV_REST_API_TOKEN か UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）。
// ここに置くのは「助けて」と「しばらく開いていない」のための最小限だけ（会話や思い出は置かない）。
import crypto from "node:crypto";

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const storeReady = () => !!(URL_ && TOKEN);

export async function redis(...cmd) {
  if (!storeReady()) throw new Error("store_not_configured");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error("store_error");
  return data.result;
}

// 端末の合言葉（画面に保存した秘密）を確かめる。サーバーには、秘密そのものではなくハッシュだけ置く
export const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const validId = (v) => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
export const validSecret = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// 家族（LINEの番号）は fam:<id> の集合に、「しばらく開いていない」を知らせた印は alerted:<id> に置く。
// 端末の記録（dev:<id>）とは別にして、同時に書きこんでも消し合わないようにする。
export async function familyOf(id, d) {
  let fam = (await redis("SMEMBERS", "fam:" + id)) || [];
  if (d && Array.isArray(d.family) && d.family.length) {
    // 古い形（端末の記録の中に家族）からの引っ越し
    await redis("SADD", "fam:" + id, ...d.family);
    fam = [...new Set([...fam, ...d.family])];
    await saveDevice(id, d);
  }
  return fam;
}
export async function readDevice(id) {
  if (!validId(id)) return null;
  const raw = await redis("GET", "dev:" + id);
  if (!raw) return null;
  try { return JSON.parse(raw) || null; } catch { return null; }
}
export async function loadDevice(id, secret) {
  if (!validId(id) || !validSecret(secret)) return null;
  const d = await readDevice(id);
  if (!d || d.secretHash !== hash(secret)) return null;
  d.family = await familyOf(id, d);
  return d;
}
export async function saveDevice(id, d) {
  const { family, alerted, ...rest } = d; // 家族と印は別の置き場
  await redis("SET", "dev:" + id, JSON.stringify(rest));
}
// 端末を初めて登録する（合言葉は端末が作る。同じIDがあれば、合言葉が合うときだけ）
export async function ensureDevice(id, secret) {
  if (!validId(id) || !validSecret(secret)) return null;
  const existing = await redis("GET", "dev:" + id);
  if (existing) return loadDevice(id, secret);
  const d = { secretHash: hash(secret), family: [], name: "", pets: [], createdAt: Date.now(), lastSeen: Date.now(), quietDays: 3 };
  const ok = await redis("SET", "dev:" + id, JSON.stringify(d), "NX");
  return ok ? d : loadDevice(id, secret);
}
