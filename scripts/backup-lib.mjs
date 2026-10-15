// Lõi sao lưu / khôi phục — KHÔNG phụ thuộc cách kết nối (REST thật hay Postgres thử nghiệm): làm việc qua đối tượng "transport".
// Chỉ dùng module có sẵn của Node. Định dạng 1 tệp .bak (tuỳ chọn mã hoá AES-256-GCM): bảng dữ liệu + danh sách tài khoản + ảnh trong Storage + manifest kiểm tra toàn vẹn.
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

// Thứ tự nạp (bảng cha trước bảng con). KHỚP danh sách trong db/migrations/011_backup_restore.sql.
export const TABLES = ["staff", "role_permissions", "site_settings", "shipping_rules", "categories", "category_translations", "brands", "brand_translations",
  "attribute_defs", "products", "product_translations", "product_images", "post_categories", "post_category_translations", "content_items", "content_translations",
  "menus", "home_blocks", "redirects", "orders", "order_items", "order_status_history", "order_notes", "quote_requests", "quote_request_items", "quote_activities",
  "contact_requests", "audit_logs"];
export const ORDER = { staff: "user_id", role_permissions: "role,perm", site_settings: "key", category_translations: "category_id,lang", brand_translations: "brand_id,lang",
  product_translations: "product_id,lang", post_category_translations: "post_category_id,lang", content_translations: "item_id,lang" };
export const orderOf = (t) => ORDER[t] || "id";
// Cột tham chiếu tới tài khoản đăng nhập (auth.users) — cần đổi mã khi tài khoản được tạo lại với mã khác.
export const USER_REFS = { staff: ["user_id"], orders: ["assigned_to"], quote_requests: ["assigned_to"], order_status_history: ["actor"], order_notes: ["author"], quote_activities: ["actor"], audit_logs: ["actor"] };
const SELF_REF = { categories: "parent_id", menus: "parent_id" };
const PAGE = 1000, CHUNK = 500, MAGIC = Buffer.from("ECOMBAK1\n"), ENC_MAGIC = Buffer.from("ECOMENC1");

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
export const fingerprint = (rows) => sha256(rows.map(stable).sort().join("\n"));

// ---------- đóng gói / mã hoá ----------
export function pack(entries) {   // entries: [{name, data:Buffer}]
  const parts = [MAGIC];
  for (const e of entries) { parts.push(Buffer.from(JSON.stringify({ name: e.name, size: e.data.length }) + "\n"), e.data, Buffer.from("\n")); }
  return Buffer.concat(parts);
}
export function unpack(buf) {
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("BAD_FORMAT: không phải tệp sao lưu hợp lệ");
  const out = []; let pos = MAGIC.length;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos); if (nl < 0) throw new Error("BAD_FORMAT: tệp bị cắt cụt");
    let h; try { h = JSON.parse(buf.subarray(pos, nl).toString("utf8")); } catch { throw new Error("BAD_FORMAT: tiêu đề hỏng"); }
    const start = nl + 1, end = start + h.size;
    if (!Number.isInteger(h.size) || h.size < 0 || end + 1 > buf.length || buf[end] !== 10) throw new Error("BAD_FORMAT: tệp bị cắt cụt hoặc hỏng");
    out.push({ name: h.name, data: Buffer.from(buf.subarray(start, end)) }); pos = end + 1;
  }
  return out;
}
export function encrypt(buf, passphrase) {
  if (!passphrase || passphrase.length < 12) throw new Error("Cụm mật khẩu sao lưu phải từ 12 ký tự.");
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv), ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([ENC_MAGIC, salt, iv, c.getAuthTag(), ct]);
}
export const isEncrypted = (buf) => buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
export function decrypt(buf, passphrase) {
  if (!isEncrypted(buf)) throw new Error("BAD_FORMAT: không phải tệp đã mã hoá");
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52), ct = buf.subarray(52);
  try { const d = createDecipheriv("aes-256-gcm", scryptSync(passphrase || "", salt, 32), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); }
  catch { throw new Error("DECRYPT_FAILED: sai cụm mật khẩu hoặc tệp đã bị sửa/hỏng"); }
}

// ---------- đọc toàn bộ bảng ----------
async function selectAll(T, table) {
  const out = [];
  for (let off = 0; ; off += PAGE) { const rows = await T.select(table, off, PAGE); out.push(...rows); if (rows.length < PAGE) break; }
  return out;
}
async function listStorage(T, prefix = "") {
  const files = [];
  for (const e of await T.storageList(prefix)) { const p = prefix ? `${prefix}/${e.name}` : e.name; if (e.isFolder) files.push(...(await listStorage(T, p))); else files.push(p); }
  return files;
}
const mime = (p) => ({ webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" }[p.split(".").pop().toLowerCase()] || "application/octet-stream");

// Quan hệ cha-con dùng để phát hiện bản chụp KHÔNG nhất quán (sao lưu đọc từng bảng một; nếu có đơn mới xen vào giữa, bảng con có thể có dòng mà bảng cha chưa có).
const FKS = [["order_items", "order_id", "orders"], ["order_status_history", "order_id", "orders"], ["order_notes", "order_id", "orders"], ["quote_request_items", "quote_id", "quote_requests"], ["quote_activities", "quote_id", "quote_requests"],
  ["product_translations", "product_id", "products"], ["product_images", "product_id", "products"], ["category_translations", "category_id", "categories"], ["brand_translations", "brand_id", "brands"],
  ["post_category_translations", "post_category_id", "post_categories"], ["content_translations", "item_id", "content_items"]];
export function checkSnapshot(data) {
  const bad = [];
  for (const [ct, cc, pt] of FKS) { const ids = new Set(data[pt].map((r) => r.id)), n = data[ct].filter((r) => r[cc] != null && !ids.has(r[cc])).length; if (n) bad.push(`${ct}.${cc}: ${n} dòng mồ côi`); }
  if (bad.length) throw new Error("INCONSISTENT_SNAPSHOT: dữ liệu thay đổi trong lúc sao lưu (" + bad.join("; ") + ")");
}
export async function backupStable(T, opts = {}, { attempts = 3, delayMs = 5000 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await backupAll(T, opts); }
    catch (e) {
      if (!/INCONSISTENT_SNAPSHOT/.test(e.message)) throw e;
      last = e; if (opts.log) opts.log(`  ${e.message.split(" (")[0]} — thử lại (${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

// ================= SAO LƯU =================
export async function backupAll(T, { log = () => {}, source = "" } = {}) {
  const entries = [], manifest = { format: "ecom-backup", version: 1, taken_at: new Date().toISOString(), source, tables: {}, storage: { files: [] }, auth_users: { count: 0 }, entries: {} };
  const snap = {};
  for (const t of TABLES) {
    const rows = await selectAll(T, t), data = Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n")); snap[t] = rows;
    entries.push({ name: `tables/${t}.ndjson`, data }); manifest.tables[t] = { rows: rows.length, fingerprint: fingerprint(rows) }; log(`  bảng ${t}: ${rows.length} dòng`);
  }
  checkSnapshot(snap);
  const users = (await T.listUsers()).map((u) => ({ id: u.id, email: u.email, created_at: u.created_at || null, last_sign_in_at: u.last_sign_in_at || null, user_metadata: u.user_metadata || {} }));
  entries.push({ name: "auth_users.json", data: Buffer.from(JSON.stringify(users)) }); manifest.auth_users.count = users.length; log(`  tài khoản đăng nhập: ${users.length} (KHÔNG gồm mật khẩu)`);
  for (const p of await listStorage(T)) { const data = await T.storageGet(p); entries.push({ name: `storage/${p}`, data }); manifest.storage.files.push({ path: p, size: data.length, sha256: sha256(data) }); }
  log(`  ảnh/tệp trong Storage: ${manifest.storage.files.length}`);
  for (const e of entries) manifest.entries[e.name] = sha256(e.data);
  const buf = pack([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 1)) }, ...entries]);
  return { buf, manifest };
}

// ---------- đọc & kiểm tra tệp sao lưu (CHƯA ghi gì vào đích) ----------
export function readBackup(buf, passphrase) {
  const plain = isEncrypted(buf) ? decrypt(buf, passphrase) : buf, entries = unpack(plain), map = new Map(entries.map((e) => [e.name, e.data]));
  const mf = map.get("manifest.json"); if (!mf) throw new Error("BAD_FORMAT: thiếu manifest");
  const manifest = JSON.parse(mf.toString("utf8"));
  if (manifest.format !== "ecom-backup" || manifest.version !== 1) throw new Error("BAD_FORMAT: phiên bản sao lưu không hỗ trợ");
  const problems = [];
  for (const [name, h] of Object.entries(manifest.entries)) { const d = map.get(name); if (!d) problems.push(`thiếu ${name}`); else if (sha256(d) !== h) problems.push(`hỏng ${name}`); }
  for (const t of TABLES) { if (!manifest.tables[t]) problems.push(`manifest thiếu bảng ${t}`); }
  if (problems.length) throw new Error("INTEGRITY_FAILED: " + problems.join("; "));
  const tables = {}; for (const t of TABLES) { const txt = map.get(`tables/${t}.ndjson`).toString("utf8"); tables[t] = txt ? txt.split("\n").map((l) => JSON.parse(l)) : []; if (tables[t].length !== manifest.tables[t].rows) throw new Error(`INTEGRITY_FAILED: số dòng bảng ${t} không khớp manifest`); }
  return { manifest, tables, users: JSON.parse(map.get("auth_users.json").toString("utf8")), storage: new Map(manifest.storage.files.map((f) => [f.path, map.get(`storage/${f.path}`)])) };
}
export function assertDifferentTarget(manifest, targetUrl) {   // chống khôi phục nhầm vào chính dự án nguồn
  if (manifest.source && targetUrl && new URL(targetUrl).host === new URL(manifest.source).host) throw new Error("SAME_PROJECT: đích trùng dự án nguồn — hãy khôi phục vào dự án MỚI (hoặc truyền allowSameProject nếu bạn hiểu rủi ro).");
}

// ---------- tiện ích khôi phục ----------
function orderParentsFirst(table, rows) {
  const col = SELF_REF[table]; if (!col) return rows;
  const byId = new Map(rows.map((r) => [r.id, r])), depth = (r, seen = new Set()) => { let d = 0, cur = r; while (cur && cur[col] != null && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur[col]); d++; } return d; };
  return [...rows].sort((a, b) => depth(a) - depth(b));
}
export function remapRows(table, rows, idMap) {
  const cols = USER_REFS[table]; if (!cols || !idMap.size) return rows;
  return rows.map((r) => { const c = { ...r }; for (const k of cols) if (c[k] != null && idMap.has(c[k])) c[k] = idMap.get(c[k]); return c; });
}
function tempPassword() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; for (;;) { let p = ""; for (const b of randomBytes(32)) { if (b < 256 - (256 % A.length)) p += A[b % A.length]; if (p.length === 16) break; } if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && p.length === 16) return p; } }

// ================= KHÔI PHỤC =================
export async function restoreAll(T, buf, { passphrase, log = () => {}, dryRun = false, targetUrl = "", allowSameProject = false } = {}) {
  const bk = readBackup(buf, passphrase), { manifest } = bk;
  if (!allowSameProject) assertDifferentTarget(manifest, targetUrl);
  const report = { ok: false, dryRun, backup_taken_at: manifest.taken_at, tables: [], users: { created: 0, matched: 0, remapped: 0 }, credentials: [], storage: { restored: 0, verified: 0 }, problems: [] };
  if (dryRun) { for (const t of TABLES) report.tables.push({ table: t, backup: bk.tables[t].length }); report.storage.restored = bk.storage.size; report.ok = true; return report; }

  // 1) tài khoản đăng nhập (staff tham chiếu tới chúng)
  const existing = new Map((await T.listUsers()).map((u) => [(u.email || "").toLowerCase(), u])), idMap = new Map();
  for (const u of bk.users) {
    const hit = existing.get((u.email || "").toLowerCase());
    if (hit) { report.users.matched++; if (hit.id !== u.id) idMap.set(u.id, hit.id); continue; }
    const pwd = tempPassword(), made = await T.createUser({ id: u.id, email: u.email, password: pwd, email_confirm: true, user_metadata: { ...(u.user_metadata || {}), must_change_password: true } });
    report.users.created++; report.credentials.push({ email: u.email, temp_password: pwd }); if (made.id !== u.id) { idMap.set(u.id, made.id); report.users.remapped++; }
  }
  log(`  tài khoản: tạo ${report.users.created}, khớp sẵn ${report.users.matched}, đổi mã ${idMap.size}`);

  // 2) kiểm tra đích TRƯỚC khi ghi bảng nào (hoặc xác nhận bảng đã khôi phục giống hệt = chạy lại an toàn)
  const plan = {};
  for (const t of TABLES) {
    const rows = remapRows(t, bk.tables[t], idMap), cur = await selectAll(T, t);
    if (cur.length === 0) plan[t] = { action: "load", rows };
    else if (cur.length === rows.length && fingerprint(cur) === fingerprint(rows)) plan[t] = { action: "skip", rows };
    else throw new Error(`TARGET_NOT_EMPTY: bảng ${t} ở đích đã có ${cur.length} dòng khác với bản sao lưu — hãy khôi phục vào dự án TRỐNG (chỉ chạy migration 001–011, KHÔNG chạy các file seed).`);
  }
  // 3) nạp theo thứ tự cha → con
  for (const t of TABLES) {
    const p = plan[t]; if (p.action === "skip") { log(`  bảng ${t}: đã khôi phục trước đó, bỏ qua`); continue; }
    const rows = orderParentsFirst(t, p.rows);
    for (let i = 0; i < rows.length; i += CHUNK) await T.rpc("restore_load", { p_table: t, p_rows: rows.slice(i, i + CHUNK), p_first: i === 0 });
    log(`  bảng ${t}: nạp ${rows.length} dòng`);
  }
  await T.rpc("restore_fix_sequences", {});

  // 4) ảnh/tệp Storage
  for (const [path, data] of bk.storage) { await T.storagePut(path, data, mime(path)); report.storage.restored++; }

  // 5) KIỂM TRA SAU KHÔI PHỤC: đọc lại từ đích, so từng bảng và từng tệp
  for (const t of TABLES) {
    const cur = await selectAll(T, t), want = plan[t].rows, match = cur.length === want.length && fingerprint(cur) === fingerprint(want);
    report.tables.push({ table: t, backup: want.length, restored: cur.length, match }); if (!match) report.problems.push(`bảng ${t}: ${cur.length}/${want.length} dòng, nội dung ${cur.length === want.length ? "KHÁC" : "thiếu"}`);
  }
  for (const f of manifest.storage.files) {
    try { const d = await T.storageGet(f.path); if (sha256(d) === f.sha256) report.storage.verified++; else report.problems.push(`tệp ${f.path}: nội dung khác`); } catch { report.problems.push(`tệp ${f.path}: không đọc được`); }
  }
  report.ok = report.problems.length === 0; return report;
}
