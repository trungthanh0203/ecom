#!/usr/bin/env node
// Khôi phục từ tệp sao lưu vào một dự án Supabase TRỐNG (đã chạy migration 001-011, KHÔNG chạy seed).
//   node scripts/restore.mjs <tệp.bak.enc> --dry-run        # chỉ kiểm tra tệp (giải mã + toàn vẹn), không cần kết nối đích
//   node scripts/restore.mjs <tệp.bak.enc>                  # khôi phục thật
// Cần: BACKUP_PASSPHRASE; khi khôi phục thật: TARGET_SUPABASE_URL, TARGET_SERVICE_ROLE_KEY (tên khác hẳn biến sao lưu để không nhầm dự án).
// Mã thoát: 0 = thành công và đã đối chiếu khớp; 1 = lỗi hoặc có chỗ không khớp. (Không dùng process.exit() — xem ghi chú trong backup.mjs.)
import { readFileSync } from "node:fs";
import { restoreAll } from "./backup-lib.mjs";
import { restTransport } from "./transport-rest.mjs";

async function main() {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith("--")), dry = args.includes("--dry-run");
  if (!file) throw new Error("cách dùng: node scripts/restore.mjs <tệp sao lưu> [--dry-run] [--allow-same-project]");
  const { TARGET_SUPABASE_URL: url, TARGET_SERVICE_ROLE_KEY: key, BACKUP_PASSPHRASE: pass } = process.env;
  if (!dry && (!url || !key)) throw new Error("thiếu TARGET_SUPABASE_URL hoặc TARGET_SERVICE_ROLE_KEY");
  const r = await restoreAll(dry ? null : restTransport({ url, key }), readFileSync(file), { passphrase: pass, dryRun: dry, targetUrl: url, allowSameProject: args.includes("--allow-same-project"), log: console.log });
  console.log(`\nBản sao lưu lúc ${r.backup_taken_at}`);
  for (const t of r.tables) console.log(`  ${t.match === false ? "✘" : "✔"} ${t.table.padEnd(28)} ${String(t.backup).padStart(6)} dòng${r.dryRun ? "" : ` → khôi phục ${t.restored}`}`);
  if (r.dryRun) { console.log(`  Storage: ${r.storage.restored} tệp\nTệp sao lưu HỢP LỆ (đã kiểm toàn vẹn). Chưa ghi gì vào đâu cả.`); return; }
  console.log(`  Storage: ${r.storage.restored} tệp tải lên, ${r.storage.verified} đã đối chiếu nội dung`);
  if (r.credentials.length) { console.log("\nTài khoản nhân viên được TẠO LẠI — mật khẩu tạm (chỉ hiện lúc này, nhân viên sẽ bị bắt đổi ở lần đăng nhập đầu):"); for (const c of r.credentials) console.log(`  ${c.email}  ${c.temp_password}`); }
  if (r.problems.length) { console.log("\nKHÔNG KHỚP:"); for (const p of r.problems) console.log("  - " + p); process.exitCode = 1; return; }
  console.log("\nKHÔI PHỤC THÀNH CÔNG — mọi bảng và tệp đã được đối chiếu với bản sao lưu.");
}
main().catch((e) => { console.error("LỖI: " + e.message); process.exitCode = 1; });
