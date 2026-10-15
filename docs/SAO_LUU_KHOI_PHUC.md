# Sổ tay sao lưu & khôi phục

Dành cho người vận hành. Đọc mục 1–2 để hiểu tình trạng, mục 3 để cài sao lưu tự động, **mục 4 để khôi phục khi có sự cố**, **mục 5 để diễn tập (làm ngay sau khi cài đặt và mỗi quý)**.

## 1. Tình trạng thực tế (đã đối chiếu tài liệu Supabase)
| Hạng mục | Thực tế |
|---|---|
| Sao lưu tự động của Supabase | **Gói Free: không có** sao lưu hằng ngày (Supabase khuyên tự xuất dữ liệu và lưu ngoài). Gói Pro: hằng ngày, giữ 7 ngày; PITR là tiện ích trả phí thêm. |
| File ảnh trong Storage | **Không nằm trong** bản sao lưu cơ sở dữ liệu của Supabase (kể cả gói trả phí). |
| Mật khẩu đăng nhập | Không đọc ra được từ Supabase nên **không thể sao lưu**; khi khôi phục, nhân viên nhận mật khẩu tạm và phải đổi. |
| Mã nguồn website | Nằm trên GitHub (private). Cloudflare tự deploy lại từ đó. |

Vì vậy dự án có bộ sao lưu riêng, không tốn phí: `scripts/backup.mjs` và `scripts/restore.mjs`. Nó sao lưu **28 bảng dữ liệu, danh sách tài khoản nhân viên (không mật khẩu) và toàn bộ ảnh Storage** vào MỘT tệp mã hoá AES-256-GCM, kèm mã băm kiểm tra toàn vẹn.

## 2. Không nằm trong bản sao lưu — phải tự giữ
- **Cụm mật khẩu sao lưu** (`BACKUP_PASSPHRASE`): mất nó là mất bản sao lưu, không có cách giải mã. Lưu ở trình quản lý mật khẩu, **khác nơi** lưu tệp sao lưu.
- **Khoá `service_role`, khoá Turnstile, mã GA4/GTM**: lưu trong trình quản lý mật khẩu (Cloudflare Secrets không đọc lại được).
- **Cấu hình Supabase Auth** (mẫu email, nhà cung cấp đăng nhập, độ dài mật khẩu tối thiểu…) và **tên miền/DNS**: ghi lại ở sổ cấu hình riêng.
- Migration SQL nằm trong repo (`db/migrations/001…011`) nên cấu trúc cơ sở dữ liệu luôn dựng lại được.

## 3. Cài sao lưu tự động hằng ngày (làm một lần)

### 3.1. Repo phải ở chế độ Private
Mở repo trên GitHub: cạnh tên repo phải có nhãn **Private**. Nếu là **Public**: **Settings** → kéo xuống **Danger Zone** → **Change repository visibility** → **Make private** → xác nhận. (Tệp sao lưu đã mã hoá, nhưng dữ liệu khách hàng nằm trong đó nên vẫn giữ repo kín.)

### 3.2. Lấy giá trị cho 3 secret
| Secret | Lấy ở đâu |
|---|---|
| `SUPABASE_URL` | Supabase → project → **Project Settings → API → Project URL**, dạng `https://xxxx.supabase.co`, không có dấu `/` ở cuối |
| `SUPABASE_SERVICE_ROLE_KEY` | Cùng trang, mục **Project API keys** → khoá **service_role** → **Reveal**. **Không** dùng khoá `anon`. Khoá này có toàn quyền trên database — không dán vào chat, email hay file trong repo |
| `BACKUP_PASSPHRASE` | Tự tạo bằng trình quản lý mật khẩu: chuỗi ngẫu nhiên **≥ 12 ký tự** (nên 24–32). Lưu ngay vào trình quản lý mật khẩu với tên rõ nghĩa, **và có thêm 1 bản dự phòng ở nơi thứ hai** (giấy trong két, hoặc người tin cậy thứ hai) |

### 3.3. Nhập vào GitHub — đúng tab, đúng loại
**Settings → Secrets and variables → Actions → tab `Secrets` → nút xanh `New repository secret`.** Tạo đúng 3 secret, tên đúng từng chữ (phân biệt hoa thường): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE`. GitHub không hiện lại giá trị sau khi lưu.

**Hai lỗi đã gặp thực tế (đừng lặp lại):**
- Thêm vào tab **Variables** thay vì **Secrets** → workflow thấy giá trị rỗng. Biến ở Variables hiển thị công khai nên cũng không được dùng cho khoá.
- Thêm vào **Environment secrets** (tạo một "environment" rồi thêm secret vào đó) → chỉ job nào khai báo đúng environment mới đọc được; workflow này không khai báo nên cũng thấy rỗng. Phải là **Repository secrets** (nút `New repository secret`, cột "Environment" để trống). Nếu lỡ tạo environment thừa: **Settings → Environments →** chọn nó **→ Delete environment** (xoá sau khi đã tạo xong 3 repository secret).

### 3.4. Chạy thử lần đầu và tải bản sao lưu về
1. Repo → tab **Actions**. Nếu GitHub hỏi bật workflow, bấm **"I understand my workflows, go ahead and enable them"**.
2. Cột trái, mục **All workflows** → bấm **backup**.
3. Bên phải bấm **Run workflow** → giữ nhánh `main` → bấm nút xanh **Run workflow** trong hộp nhỏ.
4. Tải lại trang, bấm vào dòng mới (biểu tượng vàng = đang chạy) → bấm job **backup** để xem log. Chờ 1–3 phút đến khi có **dấu tick xanh**.
5. Bước đầu tiên trong log, **"Kiểm tra đã có đủ secret"**, phải hiện cả 3 dòng `…: có`. Dòng nào `THIẾU` thì secret đó sai tên hoặc nằm sai chỗ (xem 3.3).
6. Bước **Run node scripts/backup.mjs** phải hiện số dòng từng bảng, số tệp Storage và cuối cùng `Xong: out/ecom-backup-….bak.enc`.
7. Về trang tóm tắt lần chạy, kéo xuống mục **Artifacts** → bấm **ecom-backup** để tải file `.zip`. Giải nén được file `ecom-backup-AAAAMMDD-GGPPSS.bak.enc`. Cất ở nơi an toàn; không gửi qua email/chat.

### 3.5. Vận hành hằng ngày
- Workflow tự chạy mỗi ngày 01:17 giờ Việt Nam; artifact giữ 30 ngày.
- **Mỗi tuần tải 1 bản về máy/ổ ngoài** để có bản nằm ngoài GitHub.
- Lần chạy thất bại có thể không ai biết: bật thông báo Actions của tài khoản GitHub (Settings → Notifications → Actions) và **mở tab Actions kiểm tra mỗi tuần** xem các lần chạy gần nhất đều xanh.
- Nếu đổi sang project Supabase khác, cập nhật lại 2 secret `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`, nếu không sao lưu vẫn chạy vào project cũ.

Chạy tay trên máy (Node 18+, PowerShell):
```powershell
cd D:\WebCty\commerce-template
$env:SUPABASE_URL = "https://<ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "Khoá service_role"
$env:BACKUP_PASSPHRASE = Read-Host "Cụm mật khẩu sao lưu"
node scripts/backup.mjs
```
Tệp ra ở `backups\ecom-backup-….bak.enc` (thư mục đã nằm trong `.gitignore`; giữ 14 bản gần nhất).

## 4. KHÔI PHỤC khi có sự cố
**Nguyên tắc:** luôn khôi phục vào **project Supabase MỚI, TRỐNG** (đây cũng là cách nhân bản cho công ty khác). Công cụ từ chối ghi vào project có dữ liệu khác và từ chối khôi phục vào chính project nguồn. **Không bao giờ** chạy restore với khoá `service_role` của project đang chạy thật.

### 4.1. Chuẩn bị tệp
Giải nén `.zip` tải từ GitHub (mục 3.4), đặt file `.bak.enc` vào thư mục ngoài dự án, ví dụ `D:\WebCty\backups-drill\`.

### 4.2. Kiểm tra tệp — chưa ghi gì vào đâu cả
```powershell
cd D:\WebCty\commerce-template
$env:BACKUP_PASSPHRASE = Read-Host "Nhập cụm mật khẩu sao lưu"
node scripts/restore.mjs "D:\WebCty\backups-drill\ecom-backup-AAAAMMDD-GGPPSS.bak.enc" --dry-run
```
Đúng khi thấy danh sách 28 bảng kèm số dòng rồi dòng **"Tệp sao lưu HỢP LỆ (đã kiểm toàn vẹn)"**. Đối chiếu thử số dòng `products`, `orders` có hợp lý không. `DECRYPT_FAILED` = sai cụm mật khẩu hoặc tệp hỏng → thử bản khác.

### 4.3. Tạo project Supabase mới (bắt đầu bấm giờ)
supabase.com → **New project** (tên gợi ý `…-drill` khi diễn tập hoặc tên mới khi khôi phục thật) → chờ 1–2 phút khởi tạo. Gói Free giới hạn số project cùng lúc; nếu đầy phải xoá bớt project không dùng.

### 4.4. Chạy 11 file migration
Project mới → **SQL Editor → New query**. Với từng file trong `db\migrations\`: mở file, sao chép toàn bộ, dán vào, bấm **Run**, **đúng thứ tự**:

`001_core` → `002_security` → `003_commerce` → `004_storage` → `005_staff_directory` → `006_content_guard` → `007_menus_blocks_guard` → `008_seo_tracking_guard` → `009_company_content` → `010_staff_management` → `011_backup_restore` → `012_header_layout`

- **KHÔNG chạy** `seed_core.sql`, `seed_xe_dien.sql`, `seed_settings.sql`, `bootstrap_staff.sql` (dữ liệu đã có trong bản sao lưu; chạy seed làm project không còn trống và restore sẽ từ chối).
- Mỗi file phải báo "Success". Lỗi ở file nào thì dừng và xử lý trước khi sang file kế.
- Kiểm tra: **Table Editor** có các bảng `products`, `orders`…; **Storage** có bucket `media`.

### 4.5. Lấy thông tin kết nối của project mới
**Project Settings → API**: lấy **Project URL** và khoá **service_role** của project MỚI (khác khoá project cũ).

### 4.6. Chạy khôi phục
```powershell
cd D:\WebCty\commerce-template
$env:TARGET_SUPABASE_URL = "https://<mã-project-mới>.supabase.co"
$env:TARGET_SERVICE_ROLE_KEY = Read-Host "Khoá service_role của project MỚI"
$env:BACKUP_PASSPHRASE = Read-Host "Nhập cụm mật khẩu sao lưu"
node scripts/restore.mjs "D:\WebCty\backups-drill\ecom-backup-AAAAMMDD-GGPPSS.bak.enc"
```
Kiểm tra kỹ dòng `TARGET_SUPABASE_URL` trước khi Enter: phải là URL project **mới**.

### 4.7. Đọc kết quả
**Thành công:**
```
  ✔ products        12 dòng → khôi phục 12
  ✔ orders           5 dòng → khôi phục 5
  ...
  Storage: 8 tệp tải lên, 8 đã đối chiếu nội dung
Tài khoản nhân viên được TẠO LẠI — mật khẩu tạm …
KHÔI PHỤC THÀNH CÔNG — mọi bảng và tệp đã được đối chiếu với bản sao lưu.
```
- **Mật khẩu tạm chỉ hiện một lần** → ghi lại và gửi riêng cho từng nhân viên (họ bị bắt đổi mật khẩu ở lần đăng nhập đầu).
- **Dừng bấm giờ** ở dòng "KHÔI PHỤC THÀNH CÔNG": đó là thời gian khôi phục thật (RTO).
- Có dòng ✘ hoặc phần **"KHÔNG KHỚP"** → **dừng lại**, chụp màn hình, không đưa vào sử dụng. Chạy lại lệnh là an toàn (bảng đã giống hệt được bỏ qua).

### 4.8. Tự kiểm tra thêm (≈ 5–10 phút)
- **Table Editor**: so số dòng `products`, `orders`, `quote_requests` với project cũ.
- **Storage → media**: số thư mục/tệp khớp.
- **Authentication → Users**: thấy email các nhân viên được tạo lại.
- Mở thử vài sản phẩm xem tên, giá đúng.

### 4.9. Nếu là khôi phục THẬT (không phải diễn tập): trỏ website sang project mới
- `public/quan-tri/config.js`: đổi `SUPABASE_URL` và `SUPABASE_ANON_KEY` (khoá `anon` của project mới) → commit/push.
- `wrangler.jsonc` (`vars`): đổi `SUPABASE_URL` và `SUPABASE_ANON_KEY`.
- Cloudflare → Worker → Variables and Secrets: đặt lại secret `SUPABASE_SERVICE_ROLE_KEY` (khoá project mới).
- GitHub secrets của workflow sao lưu: cập nhật `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` để sao lưu chạy tiếp trên project mới.
- Kiểm tra sau khi trỏ: mở `/api/health` (phải `"rpc": "ok"`); đăng nhập CMS bằng Super Admin; mở Sản phẩm, Đơn hàng, Báo giá; mở 1 trang sản phẩm có ảnh; đặt thử 1 đơn COD và xử lý nó trong CMS.
- Báo nhân viên; ghi sự cố vào sổ (nguyên nhân, thời điểm, dữ liệu mất bao nhiêu giờ).

### Mục tiêu (ước lượng, chưa đo trên hệ thống thật — cập nhật sau buổi diễn tập đầu)
- **Mất dữ liệu tối đa (RPO): ~24 giờ** với lịch hằng ngày — đơn/báo giá phát sinh sau bản sao lưu cuối phải nhập lại từ email/điện thoại khách. Cần RPO nhỏ hơn: bấm **Run workflow** thủ công trước các thay đổi lớn, hoặc dùng Supabase Pro + PITR (trả phí).
- **Thời gian khôi phục (RTO): ~1–2 giờ** (chủ yếu là tạo project, chạy 11 file SQL và đổi cấu hình).

## 5. Diễn tập khôi phục (ngay sau khi cài, rồi mỗi quý)
Làm đúng mục 4.1 → 4.8 với **project tạm** (tên `…-drill`), không làm 4.9. Ghi vào sổ: ngày, tên tệp, thời gian từ 4.3 tới "KHÔI PHỤC THÀNH CÔNG", kết quả mục 4.8, vấn đề gặp phải. Dọn dẹp sau khi xong:
```powershell
Remove-Item Env:TARGET_SUPABASE_URL, Env:TARGET_SERVICE_ROLE_KEY, Env:BACKUP_PASSPHRASE
```
Rồi xoá project tạm: **Project Settings → General → Delete project**.

## 6. Giới hạn đã biết (đừng ngạc nhiên)
- **Nhất quán:** sao lưu đọc từng bảng một. Nếu có đơn mới xen vào giữa, công cụ phát hiện (dòng hàng mồ côi), tự thử lại tối đa 3 lần và thất bại rõ ràng thay vì tạo tệp hỏng. Lịch 01:17 sáng được chọn vì ít khách.
- **Kích thước:** toàn bộ tệp xử lý trong bộ nhớ; ổn với hàng chục MB. Nếu dữ liệu/ảnh lên hàng trăm MB cần cải tiến.
- **Tài khoản:** chỉ tạo lại tài khoản của chính website (nhân viên). Mã tài khoản có thể đổi khi tạo lại; công cụ tự đổi mọi cột tham chiếu (người phụ trách, người thao tác, nhật ký). Tài liệu Supabase không nói rõ việc tạo tài khoản với mã định sẵn nên cơ chế đổi mã là bắt buộc.
- **Chưa kiểm chứng trên Supabase thật:** logic đã diễn tập trên Postgres thật trong máy và qua máy chủ giả giao diện Supabase; **buổi diễn tập trên 2 project Supabase thật là việc của mục 5** — làm trước khi tin cậy.
- Bản sao lưu chứa dữ liệu cá nhân khách hàng (tên, SĐT, địa chỉ, email): chỉ lưu bản mã hoá; xoá bản cũ theo chính sách dữ liệu của công ty.

## 7. Sự cố thường gặp
| Thông báo / triệu chứng | Nghĩa là | Cách xử lý |
|---|---|---|
| Workflow: `thiếu SUPABASE_URL …(giá trị đang RỖNG)` | Secret nằm sai tab/sai loại hoặc sai tên | Mục 3.3: phải là **Repository secrets** ở tab **Secrets** |
| Workflow: `401` / `Invalid API key` | Dán nhầm khoá `anon` hoặc khoá project khác | Dùng khoá **service_role** đúng project |
| Không thấy workflow **backup** / nút **Run workflow** | Chưa push `.github/workflows/backup.yml` lên `main`, hoặc đang xem trang một lần chạy | Push lên `main`; bấm lại **backup** ở cột trái |
| `DECRYPT_FAILED` | Sai cụm mật khẩu, hoặc tệp bị sửa/hỏng | Kiểm tra cụm mật khẩu; thử bản khác |
| `INTEGRITY_FAILED` | Tệp (không mã hoá) bị sửa/thiếu phần | Dùng bản khác |
| `thiếu TARGET_SUPABASE_URL hoặc TARGET_SERVICE_ROLE_KEY` | Chưa đặt biến trong cửa sổ PowerShell hiện tại | Chạy lại các dòng `$env:` ở 4.6 |
| `SAME_PROJECT` | URL đích trùng project nguồn (dán nhầm URL project thật) | Dừng lại, kiểm tra URL; chỉ dùng `--allow-same-project` khi chắc chắn và đã xoá sạch dữ liệu |
| `TARGET_NOT_EMPTY: bảng X` | Đích đã có dữ liệu khác bản sao lưu (đã chạy seed, hoặc dùng lại project) | Tạo project mới, chỉ chạy 11 migration |
| `INCONSISTENT_SNAPSHOT` | Có giao dịch xen vào lúc sao lưu, đã hết 3 lần thử | Chạy lại sau ít phút |
| `could not find the function … restore_load` | Chưa chạy `011_backup_restore.sql` ở đích | Chạy file 011 |
| `relation … does not exist` | Thiếu một migration trước đó | Kiểm tra đủ 11 file theo thứ tự |
| Lỗi ở bước tạo tài khoản khi khôi phục | Phần chưa thử được trên Supabase thật | Gửi nguyên thông báo lỗi cho người phát triển |
