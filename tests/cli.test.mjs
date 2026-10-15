// Kiểm thử lớp kết nối REST + các lệnh scripts/backup.mjs, scripts/restore.mjs với máy chủ GIẢ giao diện Supabase (trong tiến trình).
// KHÔNG phải kiểm thử Supabase thật: chỉ chứng minh URL/phân trang/tiêu đề xác thực/mã thoát/ghi tệp/dọn bản cũ đúng.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { TABLES } from '../scripts/backup-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
let pass = 0, fail = 0; const fails = [];
async function test(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { fail++; fails.push(n); console.log('  ✘', n, '->', e.message); } }
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const truthy = (v, m = 'not truthy') => { if (!v) throw new Error(m); };

const KEY = 'service-key-giu-bi-mat-xyz', PASS = 'cum-mat-khau-cli-12345';
function mkServer(port, { tables = {}, users = [], files = new Map() } = {}) {
  for (const t of TABLES) tables[t] = tables[t] || [];
  const log = [];
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname; const chunks = []; for await (const c of req) chunks.push(c); const raw = Buffer.concat(chunks);
    log.push({ m: req.method, p, auth: req.headers.apikey === KEY && req.headers.authorization === 'Bearer ' + KEY });
    if (req.headers.apikey !== KEY || req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"message":"Invalid API key"}'); }
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    let m;
    if ((m = p.match(/^\/rest\/v1\/([a-z_]+)$/)) && req.method === 'GET') { const rows = tables[m[1]]; if (!rows) return json(404, { message: 'no table' }); return json(200, rows.slice(Number(u.searchParams.get('offset')), Number(u.searchParams.get('offset')) + Number(u.searchParams.get('limit')))); }
    if (p === '/rest/v1/rpc/restore_load') { const b = JSON.parse(raw); if (b.p_first && tables[b.p_table].length) return json(400, { code: 'P0001', message: 'RESTORE_TABLE_NOT_EMPTY' }); tables[b.p_table].push(...b.p_rows); return json(200, b.p_rows.length); }
    if (p === '/rest/v1/rpc/restore_fix_sequences') return json(200, 3);
    if (p === '/auth/v1/admin/users' && req.method === 'GET') { const per = Number(u.searchParams.get('per_page')), pg = Number(u.searchParams.get('page')); return json(200, { users: users.slice((pg - 1) * per, pg * per) }); }
    if (p === '/auth/v1/admin/users' && req.method === 'POST') { const b = JSON.parse(raw); users.push({ id: b.id, email: b.email, user_metadata: b.user_metadata }); return json(200, { id: b.id }); }
    if (p === '/storage/v1/object/list/media') { const b = JSON.parse(raw), pre = b.prefix ? b.prefix + '/' : '', seen = new Map(); for (const f of files.keys()) { if (!f.startsWith(pre)) continue; const rest = f.slice(pre.length), i = rest.indexOf('/'); seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0); } return json(200, [...seen].map(([name, folder]) => ({ name, id: folder ? null : 'id-' + name })).slice(b.offset, b.offset + b.limit)); }
    if ((m = p.match(/^\/storage\/v1\/object\/media\/(.+)$/))) { const path = decodeURIComponent(m[1]); if (req.method === 'GET') { if (!files.has(path)) return json(404, { message: 'nf' }); res.writeHead(200); return res.end(files.get(path)); } if (req.method === 'POST') { files.set(path, raw); return json(200, { Key: path }); } }
    json(404, { message: 'mock: ' + p });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, tables, users, files, log, url: `http://127.0.0.1:${port}`, close: () => new Promise((x) => srv.close(x)) })));
}
const sh = (script, args, env) => new Promise((resolve) => {   // bất đồng bộ: máy chủ giả chạy cùng tiến trình nên KHÔNG được chặn vòng lặp sự kiện
  const p = spawn(process.execPath, [join(root, 'scripts', script), ...args], { env: { PATH: process.env.PATH, ...env }, cwd: root }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (code) => resolve({ code, out }));
});

const U1 = '11111111-1111-1111-1111-111111111111';
const SRC = await mkServer(8841, { tables: { products: [{ id: 1, sku: 'BI-MAT-SKU-1', price: 100 }, { id: 2, sku: 'XM-2', price: 200 }], staff: [{ user_id: U1, role: 'super_admin', display_name: 'SA', active: true }], orders: Array.from({ length: 1500 }, (_, i) => ({ id: 'o' + String(i).padStart(5, '0'), code: 'DH-' + i, total: i })) },
  users: [{ id: U1, email: 'sa@x.vn', user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }], files: new Map([['products/1/a.webp', randomBytes(3000)], ['site/logo.webp', randomBytes(500)], ['content/x/y.png', randomBytes(2000)]]) });
const DIR = mkdtempSync(join(tmpdir(), 'bk-')), srcEnv = { SUPABASE_URL: SRC.url, SUPABASE_SERVICE_ROLE_KEY: KEY, BACKUP_PASSPHRASE: PASS, BACKUP_DIR: DIR };
let FILE;

console.log('\n[1] Lệnh sao lưu');
await test('thiếu cấu hình / thiếu cụm mật khẩu → báo lỗi rõ ràng, mã thoát 1, không tạo tệp', async () => {
  const a = await sh('backup.mjs', [], {}); eq(a.code, 1); truthy(/SUPABASE_URL/.test(a.out));
  const b = await sh('backup.mjs', [], { ...srcEnv, BACKUP_PASSPHRASE: '' }); eq(b.code, 1); truthy(/BACKUP_PASSPHRASE/.test(b.out)); eq(readdirSync(DIR).length, 0);
});
await test('sao lưu qua REST: phân trang đủ 1500 dòng (>1000/trang), gửi khoá service_role ở mọi lệnh, tạo 1 tệp .bak.enc, không in khoá/cụm mật khẩu', async () => {
  const r = await sh('backup.mjs', [], srcEnv); eq(r.code, 0, r.out); truthy(r.out.includes('bảng orders: 1500 dòng'), r.out);
  truthy(!r.out.includes(KEY) && !r.out.includes(PASS), 'lộ bí mật ra màn hình'); truthy(SRC.log.every((l) => l.auth), 'có lệnh không gửi khoá');
  const files = readdirSync(DIR); eq(files.length, 1); truthy(/^ecom-backup-\d{8}-\d{6}\.bak\.enc$/.test(files[0])); FILE = join(DIR, files[0]);
  const bytes = readFileSync(FILE); truthy(!bytes.includes(Buffer.from('BI-MAT-SKU-1')) && !bytes.includes(Buffer.from('sa@x.vn')), 'tệp mã hoá lộ dữ liệu');
});
await test('dọn bản cũ: chỉ giữ BACKUP_KEEP bản gần nhất', async () => {
  for (const n of ['20200101-000000', '20200102-000000', '20200103-000000']) writeFileSync(join(DIR, `ecom-backup-${n}.bak.enc`), 'cu');
  const r = await sh('backup.mjs', [], { ...srcEnv, BACKUP_KEEP: '2' }); eq(r.code, 0, r.out); const left = readdirSync(DIR); eq(left.length, 2); truthy(!left.some((f) => f.includes('2020')), 'giữ nhầm bản cũ');
  FILE = join(DIR, left.sort().slice(-1)[0]);
});

console.log('\n[2] Lệnh khôi phục');
await test('--dry-run: kiểm tra tệp hợp lệ, không cần kết nối đích; sai cụm mật khẩu bị từ chối', async () => {
  const ok = await sh('restore.mjs', [FILE, '--dry-run'], { BACKUP_PASSPHRASE: PASS }); eq(ok.code, 0, ok.out); truthy(/HỢP LỆ/.test(ok.out) && /orders\s+1500/.test(ok.out), ok.out);
  const bad = await sh('restore.mjs', [FILE, '--dry-run'], { BACKUP_PASSPHRASE: 'sai-cum-mat-khau-xxxx' }); eq(bad.code, 1); truthy(/DECRYPT_FAILED/.test(bad.out));
});
const DST = await mkServer(8842, {}), dstEnv = { TARGET_SUPABASE_URL: DST.url, TARGET_SERVICE_ROLE_KEY: KEY, BACKUP_PASSPHRASE: PASS };
await test('khôi phục vào dự án trống: thành công, bảng/tài khoản/tệp khớp nguồn, in mật khẩu tạm, không in khoá/cụm mật khẩu', async () => {
  const r = await sh('restore.mjs', [FILE], dstEnv); eq(r.code, 0, r.out); truthy(r.out.includes('KHÔI PHỤC THÀNH CÔNG'), r.out); truthy(/sa@x\.vn\s+[A-Za-z0-9]{16}/.test(r.out), 'thiếu mật khẩu tạm');
  truthy(!r.out.includes(KEY) && !r.out.includes(PASS)); eq(DST.tables.orders.length, 1500); eq(DST.tables.products.map((p) => p.sku), ['BI-MAT-SKU-1', 'XM-2']);
  eq(DST.users.map((u) => u.email), ['sa@x.vn']); eq(DST.users[0].user_metadata.must_change_password, true);
  for (const [p, b] of SRC.files) truthy(DST.files.get(p) && DST.files.get(p).equals(b), 'tệp khác: ' + p);
});
await test('chạy lại vào cùng đích → vẫn thành công, không nạp trùng dòng nào', async () => {
  const n = DST.tables.orders.length, r = await sh('restore.mjs', [FILE], dstEnv); eq(r.code, 0, r.out); eq(DST.tables.orders.length, n); eq(DST.users.length, 1);
});
await test('đích trùng dự án nguồn → từ chối (SAME_PROJECT); đích có dữ liệu khác → từ chối (TARGET_NOT_EMPTY) và không ghi gì', async () => {
  const same = await sh('restore.mjs', [FILE], { ...dstEnv, TARGET_SUPABASE_URL: SRC.url }); eq(same.code, 1); truthy(/SAME_PROJECT/.test(same.out));
  const D2 = await mkServer(8843, { tables: { products: [{ id: 99, sku: 'LA', price: 1 }] } });
  const r = await sh('restore.mjs', [FILE], { ...dstEnv, TARGET_SUPABASE_URL: D2.url }); eq(r.code, 1); truthy(/TARGET_NOT_EMPTY: bảng products/.test(r.out), r.out); eq(D2.tables.orders.length, 0, 'đã ghi dở'); await D2.close();
});
await test('thiếu cấu hình đích / sai khoá → lỗi rõ ràng, mã thoát 1', async () => {
  eq((await sh('restore.mjs', [FILE], { BACKUP_PASSPHRASE: PASS })).code, 1);
  const r = await sh('restore.mjs', [FILE], { ...dstEnv, TARGET_SERVICE_ROLE_KEY: 'khoa-sai' }); eq(r.code, 1); truthy(/401/.test(r.out), r.out);
});

await SRC.close(); await DST.close(); rmSync(DIR, { recursive: true, force: true });
console.log(`\n==== ${pass} đạt, ${fail} lỗi ====`);
if (fail) { console.log('Lỗi:', fails.join(' | ')); process.exit(1); }
