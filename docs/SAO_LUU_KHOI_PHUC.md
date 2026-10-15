# Sổ tay sao lưu & khôi phục

Tài liệu này dành cho người vận hành. Đọc mục 1–2 để hiểu tình trạng, mục 4 để khôi phục khi có sự cố, mục 6 để diễn tập định kỳ.

## 1. Tình trạng thực tế (đã đối chiếu tài liệu Supabase)
| Hạng mục | Thực tế |
|---|---|
| Sao lưu tự động của Supabase | **Gói Free: không có** sao lưu hằng ngày (Supabase khuyên tự xuất dữ liệu và lưu ngoài). Gói Pro: hằng ngày, giữ 7 ngày; PITR là tiện ích trả phí thêm. |
| File ảnh trong Storage | **Không nằm trong** bản sao lưu cơ sở dữ liệu của Supabase (kể cả gói trả phí). |
| Mật khẩu đăng nhập | Không đọc ra được từ Supabase nên **không thể sao lưu**; khi khôi phục, nhân viên nhận mật khẩu tạm và phải đổi. |
| Mã nguồn website | Nằm trên GitHub (private). Cloudflare tự deploy lại từ đó. |

Vì vậy dự án có bộ sao lưu riêng (không tốn phí): `scripts/backup.mjs` và `scripts/restore.mjs`. Nó sao lưu **28 bảng dữ liệu, danh sách tài khoản nhân viên (không mật khẩu) và toàn bộ ảnh Storage** vào MỘT tệp mã hoá AES-256-GCM, kèm mã băm kiểm tra toàn vẹn.

## 2. Không nằm trong bản sao lưu — phải tự giữ
- **Cụm mật khẩu sao lưu** (`BACKUP_PASSPHRASE`): mất nó là mất bản sao lưu. Lưu ở trình quản lý mật khẩu, KHÁC nơi lưu tệp sao lưu.
- **Khoá `service_role`, khoá Turnstile, mã GA4/GTM**: lưu trong trình quản lý mật khẩu (Cloudflare Secrets không đọc lại được).
- **Cấu hình Supabase Auth** (mẫu email, nhà cung cấp đăng nhập, độ dài mật khẩu tối thiểu…) và **tên miền/DNS**: ghi lại ở sổ cấu hình riêng.
- Migration SQL đã có trong repo (`db/migrations/001…011`), nên cấu trúc cơ sở dữ liệu luôn dựng lại được.

## 3. Thiết lập sao lưu tự động hằng ngày (làm một lần)
1. Repo GitHub phải ở chế độ **Private** (dữ liệu khách hàng có trong tệp sao lưu).
2. GitHub → Settings → Secrets and variables → Actions → thêm 3 secret: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE` (≥ 12 ký tự, ngẫu nhiên, dài).
3. Tab **Actions → backup → Run workflow** để chạy thử lần đầu. Chạy xong, vào lần chạy đó → **Artifacts** → tải `ecom-backup` về.
4. **Đừng coi là xong cho đến khi bạn đã diễn tập khôi phục bản đó (mục 6).**
5. Lịch chạy: mỗi ngày 01:17 giờ Việt Nam; artifact giữ 30 ngày. **Mỗi tuần tải 1 bản về máy/ổ ngoài** để có bản nằm ngoài GitHub.
6. Lần chạy thất bại có thể không ai biết nếu không để ý: bật thông báo Actions của tài khoản GitHub (Settings → Notifications → Actions) và **mở tab Actions kiểm tra mỗi tuần** xem các lần chạy gần nhất đều xanh. Lịch tự động của repo công khai bị GitHub tắt sau 60 ngày không hoạt động; repo private không áp dụng nhưng vẫn nên kiểm tra.

Chạy tay (máy bạn, Node 18+):
```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<khoá> BACKUP_PASSPHRASE=<cụm> node scripts/backup.mjs
```
Tệp ra ở `backups/ecom-backup-YYYYMMDD-HHMMSS.bak.enc` (thư mục này đã nằm trong `.gitignore`; giữ 14 bản gần nhất).

## 4. KHÔI PHỤC khi có sự cố
**Nguyên tắc:** luôn khôi phục vào **dự án Supabase MỚI, TRỐNG** (cách này cũng là cách nhân bản cho công ty khác). Công cụ từ chối ghi vào dự án có dữ liệu khác, và từ chối khôi phục vào chính dự án nguồn.

1. **Chọn bản sao lưu** mới nhất còn tốt. Kiểm tra trước (không ghi gì): 
   ```bash
   BACKUP_PASSPHRASE=<cụm> node scripts/restore.mjs ecom-backup-….bak.enc --dry-run
   ```
   Phải thấy "Tệp sao lưu HỢP LỆ". Nếu báo `DECRYPT_FAILED` hoặc `INTEGRITY_FAILED` → thử bản khác.
2. **Tạo dự án Supabase mới.** Trong SQL Editor chạy lần lượt: `001_core`, `002_security`, `003_commerce`, `004_storage`, `005_staff_directory`, `006_content_guard`, `007_menus_blocks_guard`, `008_seo_tracking_guard`, `009_company_content`, `010_staff_management`, `011_backup_restore`. **KHÔNG chạy các file seed** (dữ liệu mẫu đã có trong bản sao lưu).
3. **Khôi phục:**
   ```bash
   TARGET_SUPABASE_URL=https://<ref-moi>.supabase.co TARGET_SERVICE_ROLE_KEY=<khoá-dự-án-mới> BACKUP_PASSPHRASE=<cụm> node scripts/restore.mjs ecom-backup-….bak.enc
   ```
   Kết quả đúng: mọi bảng ✔, "Storage: N tệp … đã đối chiếu nội dung", cuối cùng **"KHÔI PHỤC THÀNH CÔNG"**. Có dòng ✘ hoặc "KHÔNG KHỚP" thì **dừng lại**, chụp màn hình, không đưa vào sử dụng. Chạy lại lệnh là an toàn (bảng đã giống hệt sẽ được bỏ qua).
4. **Ghi lại mật khẩu tạm** in ra màn hình (chỉ hiện một lần) và gửi riêng cho từng nhân viên; họ bị bắt đổi mật khẩu ở lần đăng nhập đầu.
5. **Trỏ website sang dự án mới:**
   - `public/quan-tri/config.js`: đổi `SUPABASE_URL` và `SUPABASE_ANON_KEY` (khoá `anon` của dự án mới) → commit/push.
   - `wrangler.jsonc` (`vars`): đổi `SUPABASE_URL` và `SUPABASE_ANON_KEY`.
   - Cloudflare → Worker → Variables and Secrets: đặt lại secret `SUPABASE_SERVICE_ROLE_KEY` (khoá của dự án mới).
   - GitHub secrets của workflow sao lưu: cập nhật `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` để sao lưu tiếp tục chạy trên dự án mới.
6. **Kiểm tra sau khôi phục (≈10 phút):** mở `/api/health` (phải `"rpc": "ok"`); đăng nhập CMS bằng Super Admin; mở danh sách Sản phẩm, Đơn hàng, Báo giá và so số lượng với bản cũ; mở 1 trang sản phẩm có ảnh; đặt thử 1 đơn COD rồi xử lý nó trong CMS.
7. Báo nhân viên; ghi sự cố vào sổ (nguyên nhân, thời điểm sự cố, dữ liệu mất bao nhiêu giờ).

### Mục tiêu (ước lượng, chưa đo trên hệ thống thật)
- **Mất dữ liệu tối đa (RPO): ~24 giờ** với lịch hằng ngày — đơn/báo giá phát sinh sau bản sao lưu cuối phải nhập lại từ email/điện thoại khách. Cần RPO nhỏ hơn: chạy workflow thủ công trước các thay đổi lớn, hoặc dùng Supabase Pro + PITR (trả phí).
- **Thời gian khôi phục (RTO): ~1–2 giờ** (chủ yếu là tạo dự án, chạy 11 file SQL và đổi cấu hình). Số này cần xác nhận bằng buổi diễn tập thật đầu tiên của bạn.

## 5. Giới hạn đã biết (đừng ngạc nhiên)
- **Nhất quán:** sao lưu đọc từng bảng một. Nếu có đơn mới xen vào giữa, công cụ phát hiện (dòng hàng mồ côi), tự thử lại tối đa 3 lần, và thất bại rõ ràng thay vì tạo tệp hỏng. Nên để lịch 01:17 sáng khi ít khách.
- **Kích thước:** toàn bộ tệp được xử lý trong bộ nhớ; ổn với hàng chục MB. Nếu dữ liệu/ảnh lên hàng trăm MB, cần cải tiến (báo lại).
- **Tài khoản:** chỉ tạo lại tài khoản của chính website (nhân viên). Mã tài khoản có thể đổi khi tạo lại; công cụ tự đổi mọi cột tham chiếu (người phụ trách, người thao tác, nhật ký). Tài liệu Supabase không nói rõ việc tạo tài khoản với mã định sẵn, nên cơ chế đổi mã là bắt buộc phải có.
- **Chưa kiểm chứng trên Supabase thật:** toàn bộ logic đã diễn tập trên Postgres thật trong máy và qua máy chủ giả giao diện Supabase; **buổi diễn tập trên 2 dự án Supabase thật chưa được làm** — hãy làm theo mục 6 trước khi tin cậy.
- Bản sao lưu chứa dữ liệu cá nhân khách hàng (tên, SĐT, địa chỉ, email): chỉ lưu bản mã hoá; xoá bản cũ theo chính sách dữ liệu của công ty.

## 6. Diễn tập định kỳ (mỗi quý, và ngay sau khi cài đặt)
1. Tải 1 bản sao lưu mới nhất từ GitHub Actions.
2. Tạo dự án Supabase **tạm** (gói Free, đặt tên `…-drill`), chạy 11 file migration.
3. `restore.mjs --dry-run` rồi khôi phục thật như mục 4 bước 3. **Ghi lại thời gian từ lúc bắt đầu tới khi "KHÔI PHỤC THÀNH CÔNG"** (đó là RTO thật của bạn).
4. Mở CMS trỏ vào dự án tạm (đổi tạm `config.js` ở bản chạy cục bộ), so số lượng sản phẩm/đơn/báo giá với dự án thật.
5. Xoá dự án tạm. Ghi kết quả vào sổ: ngày, tên tệp, thời gian, vấn đề gặp phải.

## 7. Sự cố thường gặp
| Thông báo | Nghĩa là | Cách xử lý |
|---|---|---|
| `DECRYPT_FAILED` | Sai cụm mật khẩu, hoặc tệp bị sửa/hỏng | Kiểm tra cụm mật khẩu; thử bản khác |
| `INTEGRITY_FAILED` | Tệp (không mã hoá) bị sửa/thiếu phần | Dùng bản khác |
| `SAME_PROJECT` | Đích trùng dự án nguồn | Tạo dự án MỚI; chỉ dùng `--allow-same-project` khi chắc chắn và đã xoá sạch dữ liệu |
| `TARGET_NOT_EMPTY: bảng X` | Đích đã có dữ liệu khác bản sao lưu | Dùng dự án trống (chỉ chạy migration, không seed) |
| `INCONSISTENT_SNAPSHOT` | Có giao dịch xen vào lúc sao lưu, đã hết lần thử | Chạy lại sau ít phút |
| `RESTORE_TABLE_NOT_ALLOWED` / hàm `restore_load` không tồn tại | Chưa chạy `011_backup_restore.sql` ở đích | Chạy file 011 |
