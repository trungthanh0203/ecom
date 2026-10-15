# Hướng dẫn nhân bản website cho công ty khác

Mục tiêu: dựng website (bán lẻ + báo giá B2B + CMS, song ngữ VI/EN) cho một công ty mới **nhanh, đúng, không lẫn dữ liệu** với công ty khác.

## 0. Nguyên tắc
**Mỗi công ty = 1 repo GitHub (private) + 1 project Supabase + 1 Worker Cloudflare, tách biệt hoàn toàn.**
- Không dùng chung database, khoá API, repo hay Worker giữa các công ty. Lỗi hay rò rỉ của một công ty không được ảnh hưởng công ty khác.
- Mọi thứ riêng của công ty nằm trong **ít file cấu hình** (mục 5); phần còn lại là mã dùng chung, giữ nguyên để dễ cập nhật.
- **Không nhân bản bằng cách khôi phục bản sao lưu của công ty khác**: bản sao lưu chứa đơn hàng, báo giá, số điện thoại, tài khoản nhân viên của khách thật. Chỉ nhân bản **cấu trúc + dữ liệu mẫu theo ngành** (mục 4).

**Thời gian (ước lượng, chưa đo thực tế):** phần kỹ thuật khoảng 2–4 giờ nếu đã có sẵn thông tin ở mục 1; nhập nội dung (sản phẩm, bài viết, chính sách) mất thêm nhiều ngày tuỳ khối lượng.

## 1. Thu thập thông tin từ công ty trước khi làm
- Tên công ty/thương hiệu, hotline, email, địa chỉ, giờ làm việc, logo (PNG/WebP), favicon.
- Ngành hàng: danh sách danh mục sản phẩm, các thông số kỹ thuật cần hiển thị cho từng danh mục (ví dụ pin, quãng đường, công suất…).
- Thuế VAT áp dụng (hệ thống tính **giá chưa gồm VAT** và cộng VAT lúc đặt hàng).
- Phương thức thanh toán: COD (có/không), chuyển khoản (tên ngân hàng, số tài khoản, chủ tài khoản).
- Bảng phí vận chuyển theo tỉnh/thành, ngưỡng miễn phí.
- Tên miền (nếu có) và nơi quản lý DNS.
- Danh sách nhân viên (email + vai trò: Super Admin, Admin, Editor, Contributor, Sales, Order Manager).
- Nội dung pháp lý: chính sách bảo mật/dữ liệu cá nhân (Nghị định 13/2023), điều khoản, giao hàng, thanh toán, đổi trả. **Nội dung pháp lý do công ty/luật sư xác nhận**, không dùng nguyên văn từ công ty khác.
- Ngôn ngữ: hệ thống hỗ trợ sẵn **tiếng Việt + tiếng Anh**. Ngôn ngữ thứ ba cần sửa mã (đường dẫn `PATHS`, chuỗi `T` trong `src/i18n.js`, `LANGS`) — không có sẵn.

## 2. Tạo repo cho công ty mới
**Cách A (khuyến nghị): dùng repo gốc làm mẫu**
1. Repo gốc → **Settings** → tick **Template repository** (làm một lần).
2. Trang chính của repo gốc → nút **Use this template → Create a new repository** → đặt tên (ví dụ `website-congty-abc`) → chọn **Private** → Create.
3. Clone repo mới về máy: `git clone https://github.com/<tài-khoản>/website-congty-abc.git`.

**Cách B:** clone repo gốc, xoá thư mục `.git`, `git init`, tạo repo private mới trên GitHub rồi push.

Cả hai cách đều cho lịch sử sạch. Các file nhạy cảm (`tests/.env.test`, `.dev.vars`, `backups/`) đã nằm trong `.gitignore`, không bị mang theo.

## 3. Tạo project Supabase mới
1. supabase.com → **New project** (tên theo công ty). Gói Free giới hạn số project cùng lúc (cần xác minh giới hạn hiện hành); nếu đầy, dùng tổ chức (organization) khác hoặc nâng cấp.
2. **Project Settings → API**, ghi lại: **Project URL**, khoá **anon** (công khai, sẽ nằm trong mã) và khoá **service_role** (bí mật tuyệt đối: chỉ vào Cloudflare Secrets và GitHub Secrets, không vào repo/chat).
3. **SQL Editor** → chạy lần lượt (mở từng file trong `db/migrations/`, dán, **Run**, chờ "Success"):
   `001_core` → `002_security` → `003_commerce` → `004_storage` → `005_staff_directory` → `006_content_guard` → `007_menus_blocks_guard` → `008_seo_tracking_guard` → `009_company_content` → `010_staff_management` → `011_backup_restore` → `012_header_layout`
4. Kiểm tra: **Table Editor** thấy các bảng; **Storage** thấy bucket `media`.

## 4. Dữ liệu khởi tạo theo công ty
Chạy trong SQL Editor, **sau** 12 migration:

1. **`db/seed_core.sql`** (dùng nguyên): ma trận quyền 6 vai trò + cài đặt mặc định (VAT 10% — **sửa theo công ty** ở CMS sau, hoặc sửa file trước khi chạy).
2. **Dữ liệu ngành hàng:** sao chép `db/seed_xe_dien.sql` thành `db/seed_<ngành>.sql` rồi sửa theo mẫu:
   - `categories`: mỗi dòng một danh mục (id, thứ tự). Đặt `parent_id` nếu có danh mục con.
   - `category_translations`: tên + slug cho từng danh mục. Tên tiếng Việt `published`; tiếng Anh để `draft` và `machine_translated = true` (người có thẩm quyền duyệt rồi mới xuất bản — hệ thống không tự xuất bản bản dịch máy).
   - `attribute_defs`: thông số kỹ thuật theo danh mục (`category_id` rỗng = dùng chung): `code` (chữ thường, gạch dưới), `value_type` (`text`/`number`/`boolean`), `unit`, `filterable`, `label_vi`, `label_en`.
   - Giữ dòng `setval(...)` nếu bạn gán `id` tường minh (để bộ đếm tự tăng không trùng).
   Dữ liệu này cũng sửa được sau trong CMS (Danh mục, Thuộc tính kỹ thuật), nên chỉ cần khung ban đầu.
3. **`db/seed_settings.sql`**: sửa tên công ty, hotline, email, địa chỉ, giờ làm việc; bật COD; (tuỳ chọn) thông tin chuyển khoản; phí vận chuyển mặc định. Hoặc bỏ qua và nhập ở CMS → **Cài đặt**.
3b. **(Tuỳ chọn) `db/seed_demo.sql`**: nội dung mẫu (giới thiệu, dịch vụ, tin tức, hỏi đáp, chính sách nháp, 7 sản phẩm nháp, menu, khối trang chủ) để website có hình hài ngay. Sản phẩm và chính sách để NHÁP; sửa nội dung/giá thật rồi mới xuất bản. Nội dung mẫu đang theo ngành xe điện — ngành khác cần viết lại.
4. **Tài khoản Super Admin đầu tiên:**
   - Supabase → **Authentication → Users → Add user** → nhập email + mật khẩu mạnh, **tick "Auto confirm user"**.
   - Mở `db/bootstrap_staff.sql`, **chỉ giữ dòng `super_admin`** và đổi email đúng với người vừa tạo (xoá các dòng tài khoản thử còn lại), rồi chạy. Kiểm tra `select * from staff;` có 1 dòng.
   - Các nhân viên khác tạo trong CMS → **Nhân sự** (mật khẩu tạm hiện một lần).

## 5. Sửa cấu hình trong mã (chỉ những chỗ này)
| File | Sửa gì |
|---|---|
| `wrangler.jsonc` | `name` (tên Worker, **duy nhất và phải đúng bằng tên Worker trên Cloudflare**), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_NAME`; để `SITE_URL` trống cho đến khi có tên miền; `TURNSTILE_SITEKEY` khi bật chống bot |
| `public/quan-tri/config.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (cùng giá trị như trên), `SITE_NAME` |
| `src/i18n.js` | câu giới thiệu ở trang chủ mặc định: khoá `hero_sub` ở cả khối `vi` và `en` (hiện đang nhắc "xe điện") |
| `public/assets/shop.css` | màu thương hiệu: `--brand` (nút mua) và `--quote` (nút báo giá) ở dòng `:root` đầu file và dòng chế độ tối ngay dưới |
| `db/seed_<ngành>.sql`, `db/seed_settings.sql`, `db/bootstrap_staff.sql` | như mục 4 |

**Không sửa** `worker.js`, `src/*.js` (trừ `hero_sub`), `db/migrations/*`: đó là phần dùng chung. Tuỳ biến càng ít file, việc cập nhật về sau càng ít xung đột (mục 9).
Khoá `anon` là công khai theo thiết kế nên được nằm trong mã. **Khoá `service_role` tuyệt đối không được ghi vào bất kỳ file nào.**

Sau khi sửa: commit và push lên repo của công ty.

## 6. Triển khai lên Cloudflare
1. Cloudflare Dashboard → **Workers & Pages → Create → Import a repository** → chọn repo của công ty.
2. **Tên Worker phải đúng bằng `name` trong `wrangler.jsonc`** (bài học thực tế: lệch tên gây lỗi build và Worker chỉ có file tĩnh). Giữ lệnh deploy mặc định `npx wrangler deploy`, để trống lệnh build.
3. Chờ build xong. Vào **Worker → Settings → Variables and Secrets**, thêm kiểu **Secret**:
   - `SUPABASE_SERVICE_ROLE_KEY` (khoá service_role của project công ty này) — bắt buộc.
   - `TURNSTILE_SECRET` — khi bật chống bot (xem mục 8).
4. Mở `https://<tên-worker>.<tài-khoản>.workers.dev/api/health`: phải thấy `"service_key": true` và `"rpc": "ok"`. `DB_AUTH` = khoá sai; `NO_SERVICE_KEY` = chưa đặt secret.
5. **Tên miền riêng:** Worker → **Settings → Domains & Routes → Add → Custom domain**. Tên miền cần trỏ DNS về Cloudflare (cần xác minh quy trình cho từng nhà đăng ký). Sau khi tên miền hoạt động, điền `SITE_URL` trong `wrangler.jsonc` (dạng `https://tên-miền`, không dấu `/` cuối) rồi push.

## 7. Cấu hình trong CMS (thứ tự khuyến nghị)
Đăng nhập tại `https://<địa-chỉ-website>/quan-tri/` bằng Super Admin.
1. **Cài đặt**: thông tin công ty, **VAT**, COD, ngân hàng, phí vận chuyển.
2. **Thiết lập SEO → bật "Chặn công cụ tìm kiếm" ngay** (tránh Google lập chỉ mục khi chưa xong). Tải logo, favicon, ảnh chia sẻ.
3. **Danh mục, Thương hiệu, Thuộc tính kỹ thuật**: rà lại từ dữ liệu ngành; duyệt và xuất bản bản dịch tiếng Anh.
4. **Sản phẩm**: nhập (mỗi sản phẩm cần SKU, giá, bản dịch VI đã xuất bản rồi mới xuất bản được).
5. **Nội dung**: Giới thiệu, và **các chính sách bắt buộc** (bảo mật/dữ liệu cá nhân, điều khoản, giao hàng, thanh toán, đổi trả). Checkout có ô đồng ý điều khoản nên không được để trống.
6. **Menu, Khối trang chủ** (không cấu hình thì dùng bố cục mặc định).
7. **Nhân sự**: tạo tài khoản theo vai trò; gửi mật khẩu tạm riêng cho từng người.
8. **GA4/GTM** nếu công ty dùng (chỉ Admin).

## 8. Kiểm thử trước khi bàn giao
- [ ] `/api/health` đều `ok`.
- [ ] Đặt 1 đơn COD thử từ điện thoại → xuất hiện trong CMS → xử lý hết trạng thái → ghi chú, in phiếu.
- [ ] Gửi 1 yêu cầu báo giá nhiều sản phẩm và 1 form liên hệ → thấy trong CMS.
- [ ] Đổi ngôn ngữ VI/EN; trang chỉ hiện ở ngôn ngữ có bản dịch đã xuất bản.
- [ ] Mỗi vai trò đăng nhập thử: Contributor không xuất bản được; Sales/Order Manager thấy đúng phần của mình.
- [ ] Giá sản phẩm khớp ở danh sách, chi tiết, giỏ, checkout; tổng tiền có VAT và phí ship đúng.
- [ ] Hiển thị trên điện thoại (menu, giỏ, form).
- [ ] **Trước khi mở công khai:** bật Cloudflare **Turnstile** (đặt `TURNSTILE_SITEKEY` trong `wrangler.jsonc`, secret `TURNSTILE_SECRET`, và `REQUIRE_TURNSTILE` = `"true"`); thêm một quy tắc **Rate Limiting** của Cloudflare cho `/api/*` (giới hạn trong mã chỉ theo từng máy chủ nhỏ).
- [ ] Khi chính thức ra mắt: **tắt** "Chặn công cụ tìm kiếm", gửi `sitemap.xml` cho Google Search Console.
- Có thể chạy bộ kiểm thử tự động trên hệ thống thật của công ty: điền tài khoản thử vào `tests/.env.test` rồi `npm run test:live` (xem `tests/.env.test.example`).

## 9. Sao lưu cho công ty mới (bắt buộc làm trước khi nhập dữ liệu thật)
Làm theo `docs/SAO_LUU_KHOI_PHUC.md` **trong repo của công ty đó**: đặt 3 secret (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_PASSPHRASE`) ở tab **Secrets** của repo → **Run workflow** → tải bản sao lưu → **diễn tập khôi phục** vào project tạm. Mỗi công ty dùng **cụm mật khẩu sao lưu riêng**, lưu riêng.

## 10. Bàn giao cho công ty
- Tài khoản Super Admin (đã đổi mật khẩu) và hướng dẫn dùng CMS.
- **Quyền sở hữu tài khoản** Supabase, Cloudflare, GitHub, tên miền: quyết định rõ (khuyến nghị công ty đứng tên hoặc có quy trình chuyển giao). Mất quyền vào các tài khoản này là mất khả năng vận hành.
- Danh sách thông tin cần cất giữ: khoá `service_role`, cụm mật khẩu sao lưu, khoá Turnstile, mã GA4/GTM, mật khẩu các tài khoản trên (ở trình quản lý mật khẩu của công ty).
- Giới hạn gói miễn phí và khi nào cần nâng cấp: Supabase (dung lượng cơ sở dữ liệu/Storage, project tạm dừng khi không hoạt động lâu, không có sao lưu tự động), Cloudflare Workers (số yêu cầu/ngày). **Các hạn mức cụ thể cần xác minh với tài liệu hiện hành tại thời điểm triển khai.**

## 11. Cập nhật mã cho các công ty đã nhân bản
Khi bản gốc có tính năng/sửa lỗi mới:
1. Trong repo của công ty, thêm repo gốc làm nguồn cập nhật (một lần): `git remote add upstream https://github.com/<tài-khoản>/<repo-gốc>.git`.
2. Khi cần cập nhật: `git fetch upstream` rồi `git merge upstream/main`. Xung đột (nếu có) thường chỉ ở các file mục 5 — giữ giá trị của công ty.
3. **Migration mới phải chạy tay** ở project Supabase của từng công ty (Cloudflare chỉ deploy mã, không đụng database). Lập **sổ ghi migration đã chạy** cho mỗi công ty (file nào, ngày nào) để không bỏ sót hay chạy trùng.
4. Sau khi cập nhật: kiểm tra `/api/health`, thử đặt đơn thử, và chạy sao lưu thủ công trước khi cập nhật lớn.

## 12. Lỗi hay gặp khi nhân bản (rút từ thực tế triển khai)
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Build Cloudflare báo tên Worker không khớp; "Variables cannot be added to a Worker that only has static assets" | `name` trong `wrangler.jsonc` khác tên Worker trên Cloudflare | Sửa `name` cho đúng, push lại |
| `/api/health` báo `NO_SERVICE_KEY` / giỏ hàng, báo giá báo "Có lỗi xảy ra (NO_SERVICE_KEY)" | Chưa đặt secret `SUPABASE_SERVICE_ROLE_KEY` trên Worker | Đặt secret kiểu **Secret** ở Worker → Variables and Secrets |
| `DB_AUTH` | Dán nhầm khoá `anon` hoặc khoá của project khác | Dùng khoá `service_role` đúng project |
| `DB_NO_FUNCTION` / `DB_PERMISSION` | Chưa chạy đủ các migration | Chạy lại theo thứ tự 001 → 012 |
| Không tải được ảnh sản phẩm/logo | Chưa chạy `004_storage.sql` (không có bucket `media`) | Chạy file 004 |
| Đăng nhập CMS báo "chưa được cấp quyền" | Chưa chạy `bootstrap_staff.sql` hoặc sai email | Mục 4.4 |
| CMS trắng trang hoặc không gọi được dữ liệu | `config.js` sai URL/anon key | Sửa cho đúng project công ty rồi push |
| Danh mục/thuộc tính tạo mới bị trùng id | Seed gán `id` tường minh nhưng thiếu `setval` | Thêm dòng `setval(...)` như trong `seed_xe_dien.sql` |
| Secret GitHub cho sao lưu "rỗng" | Thêm vào tab Variables hoặc Environment secrets | `docs/SAO_LUU_KHOI_PHUC.md` mục 3.3 |
| Trang chủ hiện câu "xe điện" ở công ty ngành khác | Quên sửa `hero_sub` | Mục 5 (hoặc cấu hình Khối trang chủ trong CMS) |

## 13. Danh sách kiểm tra rút gọn (in ra dùng)
- [ ] Thu thập đủ thông tin (mục 1)
- [ ] Repo private mới từ bản mẫu
- [ ] Project Supabase mới; ghi URL, anon, service_role
- [ ] 12 migration chạy xong; có bucket `media`
- [ ] Seed: core + ngành + settings; tạo Super Admin + `bootstrap_staff.sql`
- [ ] Sửa `wrangler.jsonc`, `config.js`, `hero_sub`, màu → push
- [ ] Worker Cloudflare (tên khớp) + secret `SUPABASE_SERVICE_ROLE_KEY`; `/api/health` ok
- [ ] CMS: cài đặt, SEO **chặn lập chỉ mục**, danh mục, sản phẩm, chính sách, menu, nhân sự
- [ ] Kiểm thử mục 8; Turnstile + Rate Limiting trước khi mở công khai
- [ ] Sao lưu: 3 secret, chạy thử, diễn tập khôi phục
- [ ] Bàn giao + quyết định quyền sở hữu tài khoản
- [ ] Tên miền; điền `SITE_URL`; **tắt chặn lập chỉ mục** khi ra mắt
