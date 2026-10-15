-- seed_demo.sql — DỮ LIỆU MẪU để website có hình hài ngay: trang giới thiệu, dịch vụ, tin tức, hỏi đáp, chính sách, sản phẩm, menu, khối trang chủ.
-- CHẠY SAU: 11 migration + seed_core.sql + seed_xe_dien.sql (+ seed_settings.sql). Chạy lại nhiều lần được (không nhân đôi, không ghi đè nội dung bạn đã sửa).
-- QUY ƯỚC AN TOÀN (đọc kỹ):
--   * Nội dung mẫu chỉ là văn bản chung, KHÔNG có số liệu/giải thưởng/đối tác/chứng nhận bịa. Hãy sửa cho đúng công ty thật.
--   * SẢN PHẨM mẫu để ở trạng thái NHÁP (giá là số minh hoạ) — website chưa bán gì cho tới khi bạn sửa giá thật và bấm Xuất bản.
--   * CHÍNH SÁCH mẫu để ở trạng thái NHÁP — là bản khởi đầu, PHẢI được công ty/luật sư rà soát trước khi xuất bản.
--   * Bản tiếng Anh đều là dịch máy, trạng thái NHÁP (không tự xuất bản) — vào CMS duyệt rồi mới xuất bản.
--   * Mọi nội dung mẫu có author_name = 'Nội dung mẫu' (bài/trang) hoặc SKU bắt đầu bằng 'MAU-' (sản phẩm) để dễ tìm và xoá (xem cuối file).

-- ===== Hàm phụ tạm thời (tự mất khi đóng phiên) =====
create or replace function pg_temp.add_content(p_kind text, p_status text, p_sort int, p_cat bigint,
  p_vi_slug text, p_vi_title text, p_vi_excerpt text, p_vi_body text,
  p_en_slug text, p_en_title text, p_en_excerpt text, p_en_body text) returns void language plpgsql as $$
declare v_id bigint;
begin
  if exists (select 1 from content_translations where lang = 'vi' and slug = p_vi_slug) then return; end if;
  insert into content_items(kind, status, sort, post_category_id, author_name, publish_at)
    values (p_kind, p_status, p_sort, p_cat, 'Nội dung mẫu', case when p_status = 'published' then now() else null end) returning id into v_id;
  insert into content_translations(item_id, lang, slug, title, excerpt, body, status, machine_translated)
    values (v_id, 'vi', p_vi_slug, p_vi_title, p_vi_excerpt, p_vi_body, case when p_status = 'published' then 'published' else 'draft' end, false);
  if p_en_slug is not null then
    insert into content_translations(item_id, lang, slug, title, excerpt, body, status, machine_translated)
      values (v_id, 'en', p_en_slug, p_en_title, p_en_excerpt, p_en_body, 'draft', true);
  end if;
end $$;

-- ===== Chuyên mục tin tức =====
do $$
declare v_id bigint;
begin
  if not exists (select 1 from post_category_translations where lang = 'vi' and slug = 'tin-cong-ty') then
    insert into post_categories(sort) values (1) returning id into v_id;
    insert into post_category_translations(post_category_id, lang, slug, name, status, machine_translated) values
      (v_id, 'vi', 'tin-cong-ty', 'Tin công ty', 'published', false), (v_id, 'en', 'company-news', 'Company news', 'draft', true);
  end if;
  if not exists (select 1 from post_category_translations where lang = 'vi' and slug = 'kinh-nghiem-su-dung') then
    insert into post_categories(sort) values (2) returning id into v_id;
    insert into post_category_translations(post_category_id, lang, slug, name, status, machine_translated) values
      (v_id, 'vi', 'kinh-nghiem-su-dung', 'Kinh nghiệm sử dụng', 'published', false), (v_id, 'en', 'user-guides', 'User guides', 'draft', true);
  end if;
end $$;

-- ===== Trang giới thiệu =====
select pg_temp.add_content('page', 'published', 1, null,
  'gioi-thieu', 'Giới thiệu', 'Chúng tôi là ai và chúng tôi mang đến điều gì cho khách hàng.',
  $b$<h2>Về chúng tôi</h2>
<p>Chúng tôi chuyên nhập khẩu và phân phối các dòng xe điện và linh kiện xe điện cho khách hàng cá nhân và doanh nghiệp. Mục tiêu của chúng tôi là giúp khách hàng chọn được sản phẩm phù hợp, giá minh bạch và được hỗ trợ sau bán hàng rõ ràng.</p>
<h2>Chúng tôi cam kết</h2>
<ul>
<li><strong>Giá công khai:</strong> giá bán lẻ niêm yết trên website (chưa gồm VAT); đơn số lượng lớn được báo giá riêng.</li>
<li><strong>Thông tin rõ ràng:</strong> thông số kỹ thuật, chính sách bảo hành và vận chuyển được nêu cụ thể ở từng sản phẩm.</li>
<li><strong>Hỗ trợ tận tâm:</strong> tư vấn chọn xe, hướng dẫn sử dụng, tiếp nhận bảo hành.</li>
</ul>
<h2>Liên hệ</h2>
<p>Thông tin liên hệ nằm ở chân trang và tại trang <a href="/vi/lien-he/">Liên hệ</a>. Nếu bạn cần mua số lượng lớn, hãy dùng trang <a href="/vi/bao-gia-so-luong-lon/">Báo giá số lượng lớn</a>.</p>
<p><em>[Mẫu — hãy thay bằng giới thiệu thật: lịch sử công ty, năng lực, địa chỉ showroom/kho, đội ngũ…]</em></p>$b$,
  'about-us', 'About us', 'Who we are and what we offer our customers.',
  $b$<h2>About us</h2>
<p>We import and distribute electric vehicles and EV parts for individual and business customers. Our goal is to help customers choose the right product with transparent pricing and clear after-sales support.</p>
<h2>Our commitments</h2>
<ul>
<li><strong>Public pricing:</strong> retail prices are listed on the website (excluding VAT); bulk orders receive tailored quotes.</li>
<li><strong>Clear information:</strong> specifications, warranty and shipping terms are stated on each product.</li>
<li><strong>Dedicated support:</strong> advice on choosing a vehicle, usage guidance and warranty handling.</li>
</ul>
<h2>Contact</h2>
<p>Contact details are in the footer and on the <a href="/en/contact/">Contact</a> page. For bulk purchases, use the <a href="/en/request-quote/">bulk quote</a> page.</p>
<p><em>[Sample — replace with the real company story.]</em></p>$b$);

-- ===== Dịch vụ =====
select pg_temp.add_content('service', 'published', 1, null,
  'tu-van-chon-xe', 'Tư vấn chọn xe', 'Giúp bạn chọn đúng dòng xe theo nhu cầu, quãng đường và ngân sách.',
  $b$<p>Bạn chưa biết nên chọn xe nào? Đội ngũ tư vấn sẽ hỏi nhu cầu sử dụng (quãng đường mỗi ngày, tải trọng, địa hình, ngân sách) rồi đề xuất các lựa chọn phù hợp.</p>
<h2>Quy trình</h2>
<ol><li>Bạn mô tả nhu cầu qua điện thoại hoặc biểu mẫu liên hệ.</li><li>Chúng tôi đề xuất 2–3 mẫu xe kèm so sánh ưu nhược điểm.</li><li>Bạn xem thông số, chốt mẫu và đặt hàng trực tuyến hoặc qua điện thoại.</li></ol>
<p><em>[Mẫu — hãy chỉnh theo cách làm thực tế của công ty.]</em></p>$b$,
  'vehicle-consulting', 'Vehicle consulting', 'We help you pick the right vehicle for your needs, distance and budget.',
  $b$<p>Not sure which vehicle to choose? Our team will ask about your usage (daily distance, payload, terrain, budget) and suggest suitable options.</p>
<h2>Process</h2>
<ol><li>Describe your needs by phone or through the contact form.</li><li>We suggest 2–3 models with a comparison.</li><li>You review the specs, choose, and order online or by phone.</li></ol>
<p><em>[Sample — adjust to the real process.]</em></p>$b$);

select pg_temp.add_content('service', 'published', 2, null,
  'bao-hanh-bao-tri', 'Bảo hành & bảo trì', 'Tiếp nhận bảo hành, kiểm tra định kỳ và thay thế linh kiện.',
  $b$<p>Chúng tôi tiếp nhận bảo hành theo chính sách của từng sản phẩm (thời hạn bảo hành được ghi trong phần thông số kỹ thuật) và hỗ trợ kiểm tra, bảo trì định kỳ.</p>
<ul><li>Tiếp nhận yêu cầu bảo hành qua điện thoại hoặc biểu mẫu liên hệ.</li><li>Kiểm tra, xác định nguyên nhân và thông báo phương án xử lý.</li><li>Cung cấp linh kiện thay thế (pin, sạc, bộ điều khiển, lốp…) theo từng dòng xe.</li></ul>
<p><em>[Mẫu — hãy nêu rõ địa điểm bảo hành, thời gian xử lý và điều kiện bảo hành thật.]</em></p>$b$,
  'warranty-maintenance', 'Warranty & maintenance', 'Warranty handling, periodic checks and replacement parts.',
  $b$<p>We handle warranty according to each product's policy (warranty period is shown in the specifications) and support periodic inspection and maintenance.</p>
<ul><li>Submit a warranty request by phone or via the contact form.</li><li>We inspect, identify the cause and propose a solution.</li><li>Replacement parts (battery, charger, controller, tires…) are available per model.</li></ul>
<p><em>[Sample — state the real service locations, turnaround and conditions.]</em></p>$b$);

select pg_temp.add_content('service', 'published', 3, null,
  'ban-so-luong-lon-doanh-nghiep', 'Bán số lượng lớn cho doanh nghiệp', 'Báo giá riêng cho đơn hàng số lượng lớn, đại lý và dự án.',
  $b$<p>Doanh nghiệp, khu du lịch, đại lý hoặc đơn vị cần mua nhiều xe có thể gửi yêu cầu báo giá. Chúng tôi phản hồi với giá và điều kiện giao hàng phù hợp với số lượng.</p>
<p>Hãy điền biểu mẫu tại trang <a href="/vi/bao-gia-so-luong-lon/">Báo giá số lượng lớn</a>: nêu sản phẩm, số lượng, khu vực giao hàng và thời điểm dự kiến mua.</p>
<p><em>[Mẫu — bổ sung điều kiện áp dụng, thời gian phản hồi thật.]</em></p>$b$,
  'bulk-sales-for-business', 'Bulk sales for business', 'Tailored quotes for bulk orders, dealers and projects.',
  $b$<p>Businesses, tourist sites, dealers or organizations needing multiple vehicles can request a quote. We reply with pricing and delivery terms suited to the quantity.</p>
<p>Please fill in the <a href="/en/request-quote/">bulk quote</a> form: products, quantities, delivery area and expected purchase time.</p>
<p><em>[Sample — add real conditions and response time.]</em></p>$b$);

-- ===== Tin tức (bài hướng dẫn chung, không có số liệu bịa) =====
select pg_temp.add_content('post', 'published', 1, (select post_category_id from post_category_translations where lang = 'vi' and slug = 'tin-cong-ty'),
  'khai-truong-website-ban-xe-dien', 'Website bán xe điện chính thức hoạt động', 'Từ nay bạn có thể xem giá, đặt hàng và gửi yêu cầu báo giá trực tiếp trên website.',
  $b$<p>Website của chúng tôi đã sẵn sàng phục vụ: xem sản phẩm kèm thông số kỹ thuật, đặt hàng trực tuyến (thanh toán khi nhận hàng hoặc chuyển khoản) và gửi yêu cầu báo giá cho đơn số lượng lớn.</p>
<p><em>[Mẫu — hãy thay bằng thông báo thật của công ty.]</em></p>$b$,
  'official-website-launch', 'Our electric vehicle website is live', 'You can now view prices, order and request quotes directly on the website.',
  $b$<p>Our website is ready: browse products with specifications, order online (cash on delivery or bank transfer) and request quotes for bulk orders.</p><p><em>[Sample — replace with a real announcement.]</em></p>$b$);

select pg_temp.add_content('post', 'published', 2, (select post_category_id from post_category_translations where lang = 'vi' and slug = 'kinh-nghiem-su-dung'),
  'cach-chon-xe-dien-phu-hop', '5 điều cần cân nhắc khi chọn xe điện', 'Quãng đường, tải trọng, pin, bảo hành và chi phí sử dụng — những điều nên hỏi trước khi mua.',
  $b$<p>Trước khi mua xe điện, bạn nên cân nhắc:</p>
<ol>
<li><strong>Quãng đường mỗi ngày:</strong> chọn xe có quãng đường mỗi lần sạc lớn hơn nhu cầu thực tế để pin không phải chạy sát giới hạn.</li>
<li><strong>Tải trọng và địa hình:</strong> chở nặng hoặc đi dốc nhiều sẽ làm quãng đường thực tế giảm so với thông số.</li>
<li><strong>Loại pin và bảo hành pin:</strong> hỏi rõ loại pin, thời hạn và điều kiện bảo hành.</li>
<li><strong>Nơi sạc:</strong> đảm bảo có chỗ sạc thuận tiện và nguồn điện an toàn.</li>
<li><strong>Dịch vụ sau bán hàng:</strong> khả năng cung cấp linh kiện và nơi bảo hành.</li>
</ol>
<p>Cần hỗ trợ? Xem dịch vụ <a href="/vi/dich-vu/tu-van-chon-xe/">Tư vấn chọn xe</a>.</p>$b$,
  'how-to-choose-an-electric-vehicle', '5 things to consider when choosing an electric vehicle', 'Range, payload, battery, warranty and running costs — what to ask before buying.',
  $b$<p>Before buying an electric vehicle, consider:</p>
<ol><li><strong>Daily distance:</strong> pick a range comfortably above your real need.</li><li><strong>Payload and terrain:</strong> heavy loads and hills reduce real-world range.</li><li><strong>Battery type and battery warranty:</strong> ask for term and conditions.</li><li><strong>Charging:</strong> make sure you have convenient, safe charging.</li><li><strong>After-sales service:</strong> parts availability and warranty locations.</li></ol>$b$);

select pg_temp.add_content('post', 'published', 3, (select post_category_id from post_category_translations where lang = 'vi' and slug = 'kinh-nghiem-su-dung'),
  'bao-quan-pin-xe-dien', 'Mẹo bảo quản pin xe điện', 'Vài thói quen đơn giản giúp pin bền hơn.',
  $b$<ul>
<li>Dùng đúng bộ sạc đi kèm hoặc do nhà sản xuất khuyến nghị.</li>
<li>Tránh để pin cạn hoàn toàn trong thời gian dài.</li>
<li>Không để xe dưới nắng gắt hoặc nơi ẩm ướt lâu ngày.</li>
<li>Nếu cất xe lâu, sạc pin ở mức vừa phải và kiểm tra định kỳ.</li>
</ul>
<p><em>Lưu ý: hãy làm theo hướng dẫn riêng của từng loại pin/xe. [Mẫu — hãy rà soát lại theo sản phẩm bạn bán.]</em></p>$b$,
  'ev-battery-care-tips', 'Tips for taking care of your EV battery', 'A few simple habits that help batteries last longer.',
  $b$<ul><li>Use the supplied or manufacturer-recommended charger.</li><li>Avoid leaving the battery fully drained for long periods.</li><li>Keep the vehicle out of strong sun and damp places.</li><li>For long storage, keep a moderate charge and check periodically.</li></ul><p><em>Note: always follow the instructions for your specific battery/vehicle.</em></p>$b$);

-- ===== Hỏi đáp (FAQ): tiêu đề = câu hỏi, body = câu trả lời =====
select pg_temp.add_content('faq', 'published', 1, null, 'gia-da-gom-vat-chua', 'Giá hiển thị đã gồm VAT chưa?', null,
  '<p>Giá niêm yết trên website là giá chưa gồm VAT. VAT và phí vận chuyển (nếu có) được hiển thị rõ ở giỏ hàng và bước thanh toán.</p>',
  'is-vat-included', 'Do displayed prices include VAT?', null, '<p>Listed prices exclude VAT. VAT and shipping fees (if any) are shown in the cart and at checkout.</p>');
select pg_temp.add_content('faq', 'published', 2, null, 'thanh-toan-nhu-the-nao', 'Tôi có thể thanh toán bằng cách nào?', null,
  '<p>Bạn có thể thanh toán khi nhận hàng (COD) hoặc chuyển khoản ngân hàng (nếu cửa hàng đã bật). Phương thức khả dụng hiển thị ở bước thanh toán.</p>',
  'payment-methods', 'How can I pay?', null, '<p>You can pay on delivery (COD) or by bank transfer (if enabled). Available methods are shown at checkout.</p>');
select pg_temp.add_content('faq', 'published', 3, null, 'mua-so-luong-lon', 'Tôi muốn mua số lượng lớn thì sao?', null,
  '<p>Hãy gửi yêu cầu tại trang <a href="/vi/bao-gia-so-luong-lon/">Báo giá số lượng lớn</a>. Chúng tôi sẽ liên hệ với giá và điều kiện phù hợp.</p>',
  'bulk-purchase', 'What if I want to buy in bulk?', null, '<p>Submit a request on the <a href="/en/request-quote/">bulk quote</a> page and we will get back to you with tailored pricing.</p>');
select pg_temp.add_content('faq', 'published', 4, null, 'thoi-gian-giao-hang', 'Bao lâu thì nhận được hàng?', null,
  '<p>Thời gian giao hàng phụ thuộc sản phẩm và khu vực nhận hàng; nhân viên sẽ xác nhận cụ thể khi liên hệ xác nhận đơn. <em>[Mẫu — hãy ghi thời gian giao hàng thật.]</em></p>',
  'delivery-time', 'How long does delivery take?', null, '<p>Delivery time depends on the product and your area; our staff will confirm when verifying your order. <em>[Sample — enter real delivery times.]</em></p>');
select pg_temp.add_content('faq', 'published', 5, null, 'chinh-sach-bao-hanh', 'Sản phẩm được bảo hành như thế nào?', null,
  '<p>Thời hạn bảo hành được ghi ở phần thông số kỹ thuật của từng sản phẩm. Để yêu cầu bảo hành, vui lòng liên hệ hotline hoặc gửi biểu mẫu liên hệ. <em>[Mẫu — bổ sung điều kiện bảo hành thật.]</em></p>',
  'warranty-policy', 'How does the warranty work?', null, '<p>The warranty period is listed in each product''s specifications. To claim warranty, call the hotline or use the contact form. <em>[Sample.]</em></p>');
select pg_temp.add_content('faq', 'published', 6, null, 'dat-hang-khong-can-tai-khoan', 'Tôi có cần đăng ký tài khoản để đặt hàng không?', null,
  '<p>Không. Bạn có thể đặt hàng với tư cách khách, chỉ cần điền thông tin nhận hàng ở bước thanh toán.</p>',
  'guest-checkout', 'Do I need an account to order?', null, '<p>No. You can order as a guest by entering delivery details at checkout.</p>');

-- ===== Chính sách (NHÁP — cần rà soát pháp lý trước khi xuất bản) =====
select pg_temp.add_content('policy', 'draft', 1, null, 'chinh-sach-bao-mat', 'Chính sách bảo mật thông tin', 'Cách chúng tôi thu thập, sử dụng và bảo vệ dữ liệu cá nhân.',
  $b$<p><strong>[BẢN NHÁP KHỞI ĐẦU — cần được công ty/luật sư rà soát, đối chiếu Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân trước khi xuất bản.]</strong></p>
<h2>1. Dữ liệu chúng tôi thu thập</h2><p>Họ tên, số điện thoại, email, địa chỉ nhận hàng và nội dung bạn gửi khi đặt hàng, yêu cầu báo giá hoặc liên hệ.</p>
<h2>2. Mục đích sử dụng</h2><p>Xử lý đơn hàng, giao hàng, báo giá, chăm sóc khách hàng và bảo hành.</p>
<h2>3. Chia sẻ dữ liệu</h2><p>Chỉ chia sẻ với đơn vị vận chuyển và đối tác cần thiết để hoàn thành đơn hàng, hoặc khi pháp luật yêu cầu.</p>
<h2>4. Quyền của bạn</h2><p>Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xoá dữ liệu cá nhân bằng cách liên hệ với chúng tôi.</p>
<h2>5. Liên hệ</h2><p>Xem thông tin liên hệ ở chân trang.</p>$b$,
  'privacy-policy', 'Privacy policy', 'How we collect, use and protect personal data.',
  $b$<p><strong>[DRAFT STARTER — must be reviewed by the company/legal counsel before publishing.]</strong></p><h2>Data we collect</h2><p>Name, phone, email, delivery address and the content you submit when ordering, requesting quotes or contacting us.</p><h2>Purpose</h2><p>Order processing, delivery, quotes, customer care and warranty.</p><h2>Sharing</h2><p>Only with carriers and partners needed to fulfil your order, or where required by law.</p><h2>Your rights</h2><p>You may request access, correction or deletion of your personal data by contacting us.</p>$b$);
select pg_temp.add_content('policy', 'draft', 2, null, 'dieu-khoan-su-dung', 'Điều khoản sử dụng', 'Các điều khoản khi sử dụng website và mua hàng.',
  $b$<p><strong>[BẢN NHÁP KHỞI ĐẦU — cần rà soát pháp lý trước khi xuất bản.]</strong></p>
<h2>1. Chấp thuận</h2><p>Khi sử dụng website và đặt hàng, bạn đồng ý với các điều khoản này.</p>
<h2>2. Giá và thanh toán</h2><p>Giá niêm yết chưa gồm VAT; tổng tiền cuối cùng hiển thị ở bước thanh toán. Đơn hàng chỉ có hiệu lực sau khi chúng tôi xác nhận.</p>
<h2>3. Thông tin sản phẩm</h2><p>Chúng tôi cố gắng cung cấp thông tin chính xác; hình ảnh và thông số có thể có sai khác nhỏ so với thực tế.</p>
<h2>4. Giới hạn trách nhiệm</h2><p>[Bổ sung theo tư vấn pháp lý.]</p>$b$,
  'terms-of-use', 'Terms of use', 'Terms for using the website and purchasing.',
  $b$<p><strong>[DRAFT STARTER — legal review required.]</strong></p><h2>Acceptance</h2><p>By using the website and ordering, you agree to these terms.</p><h2>Pricing and payment</h2><p>Listed prices exclude VAT; the final total is shown at checkout. Orders take effect once we confirm them.</p><h2>Product information</h2><p>We aim to be accurate; images and specifications may differ slightly from the actual product.</p>$b$);
select pg_temp.add_content('policy', 'draft', 3, null, 'chinh-sach-giao-hang', 'Chính sách giao hàng', 'Phạm vi, thời gian và phí giao hàng.',
  $b$<p><strong>[BẢN NHÁP KHỞI ĐẦU — hãy điền thông tin thật.]</strong></p>
<h2>Phạm vi giao hàng</h2><p>[Các tỉnh/thành áp dụng.]</p>
<h2>Phí giao hàng</h2><p>Phí giao hàng được tính theo khu vực và hiển thị ở giỏ hàng/thanh toán.</p>
<h2>Thời gian giao hàng</h2><p>[Thời gian dự kiến theo khu vực.]</p>
<h2>Kiểm tra khi nhận hàng</h2><p>Vui lòng kiểm tra sản phẩm khi nhận và báo ngay cho chúng tôi nếu có vấn đề.</p>$b$,
  'shipping-policy', 'Shipping policy', 'Delivery coverage, timing and fees.',
  $b$<p><strong>[DRAFT STARTER — fill in real information.]</strong></p><h2>Coverage</h2><p>[Provinces served.]</p><h2>Fees</h2><p>Shipping fees depend on the area and are shown in the cart/checkout.</p><h2>Timing</h2><p>[Estimated time by area.]</p><h2>On receipt</h2><p>Please inspect the product on delivery and tell us right away if there is a problem.</p>$b$);
select pg_temp.add_content('policy', 'draft', 4, null, 'chinh-sach-doi-tra', 'Chính sách đổi trả', 'Điều kiện đổi trả và hoàn tiền.',
  $b$<p><strong>[BẢN NHÁP KHỞI ĐẦU — hãy điền điều kiện thật và rà soát pháp lý (Luật Bảo vệ quyền lợi người tiêu dùng).]</strong></p>
<h2>Điều kiện đổi trả</h2><p>[Thời hạn, tình trạng sản phẩm, trường hợp được chấp nhận.]</p>
<h2>Cách thức</h2><p>Liên hệ hotline hoặc biểu mẫu liên hệ, nêu mã đơn hàng và lý do.</p>
<h2>Hoàn tiền</h2><p>[Hình thức và thời gian hoàn tiền.]</p>$b$,
  'return-policy', 'Return policy', 'Return and refund conditions.',
  $b$<p><strong>[DRAFT STARTER — fill in real conditions; legal review required.]</strong></p><h2>Conditions</h2><p>[Time limit, product condition, accepted cases.]</p><h2>How to return</h2><p>Contact us with your order code and reason.</p><h2>Refunds</h2><p>[Method and timing.]</p>$b$);
select pg_temp.add_content('policy', 'draft', 5, null, 'chinh-sach-bao-hanh-chung', 'Chính sách bảo hành', 'Thời hạn và điều kiện bảo hành.',
  $b$<p><strong>[BẢN NHÁP KHỞI ĐẦU — hãy điền điều kiện thật.]</strong></p>
<h2>Thời hạn</h2><p>Theo thông số của từng sản phẩm.</p>
<h2>Điều kiện</h2><p>[Trường hợp được/không được bảo hành.]</p>
<h2>Cách yêu cầu bảo hành</h2><p>Liên hệ hotline hoặc biểu mẫu liên hệ, cung cấp mã đơn hàng.</p>$b$,
  'warranty-terms', 'Warranty policy', 'Warranty period and conditions.',
  $b$<p><strong>[DRAFT STARTER — fill in real conditions.]</strong></p><h2>Period</h2><p>As stated in each product's specifications.</p><h2>Conditions</h2><p>[What is and is not covered.]</p><h2>How to claim</h2><p>Contact the hotline or contact form with your order code.</p>$b$);

-- ===== Sản phẩm mẫu (NHÁP, giá minh hoạ — PHẢI sửa giá thật rồi mới Xuất bản) =====
create or replace function pg_temp.add_product(p_sku text, p_cat bigint, p_price numeric, p_featured boolean, p_new boolean, p_attrs jsonb,
  p_vi_slug text, p_vi_name text, p_vi_short text, p_vi_desc text, p_en_slug text, p_en_name text, p_en_short text, p_en_desc text) returns void language plpgsql as $$
declare v_id bigint;
begin
  if exists (select 1 from products where sku = p_sku) or exists (select 1 from product_translations where lang = 'vi' and slug = p_vi_slug) then return; end if;
  insert into products(sku, category_id, price, status, featured, is_new, unit, attrs, retail_enabled)
    values (p_sku, p_cat, p_price, 'draft', p_featured, p_new, 'chiếc', p_attrs, true) returning id into v_id;
  insert into product_translations(product_id, lang, slug, name, short_desc, description, status, machine_translated) values
    (v_id, 'vi', p_vi_slug, p_vi_name, p_vi_short, p_vi_desc, 'draft', false),
    (v_id, 'en', p_en_slug, p_en_name, p_en_short, p_en_desc, 'draft', true);
end $$;

select pg_temp.add_product('MAU-OTO-01', 1, 450000000, true, true, '{"battery_kwh":30,"range_km":300,"seats":5,"warranty_months":24}',
  'o-to-dien-mau-01', 'Ô tô điện mẫu 5 chỗ', 'Sản phẩm mẫu — thay bằng mẫu xe thật.', '<p>Mô tả mẫu. Hãy nhập mô tả, tính năng và ảnh thật của sản phẩm. Thông số kỹ thuật là số minh hoạ.</p>',
  'sample-electric-car-01', 'Sample 5-seat electric car', 'Sample product — replace with a real model.', '<p>Sample description. Enter the real description, features and photos. Specs are illustrative numbers.</p>');
select pg_temp.add_product('MAU-DULICH-01', 2, 180000000, true, false, '{"seats":8,"range_km":80,"warranty_months":12}',
  'xe-dien-du-lich-mau-01', 'Xe điện du lịch mẫu 8 chỗ', 'Sản phẩm mẫu — thay bằng mẫu xe thật.', '<p>Mô tả mẫu.</p>',
  'sample-sightseeing-vehicle-01', 'Sample 8-seat sightseeing vehicle', 'Sample product.', '<p>Sample description.</p>');
select pg_temp.add_product('MAU-3BANH-01', 3, 65000000, false, true, '{"payload_kg":500,"range_km":60,"warranty_months":12}',
  'xe-ba-banh-dien-mau-01', 'Xe ba bánh điện chở hàng mẫu', 'Sản phẩm mẫu — thay bằng mẫu xe thật.', '<p>Mô tả mẫu.</p>',
  'sample-electric-tricycle-01', 'Sample electric cargo tricycle', 'Sample product.', '<p>Sample description.</p>');
select pg_temp.add_product('MAU-XEMAY-01', 4, 22000000, true, true, '{"motor_w":1500,"range_km":80,"top_speed_kmh":50,"warranty_months":24}',
  'xe-may-dien-mau-01', 'Xe máy điện mẫu', 'Sản phẩm mẫu — thay bằng mẫu xe thật.', '<p>Mô tả mẫu.</p>',
  'sample-electric-motorcycle-01', 'Sample electric motorcycle', 'Sample product.', '<p>Sample description.</p>');
select pg_temp.add_product('MAU-XEDAP-01', 5, 9500000, false, true, '{"motor_w":250,"range_km":50,"wheel_inch":20,"warranty_months":12}',
  'xe-dap-dien-mau-01', 'Xe đạp điện mẫu', 'Sản phẩm mẫu — thay bằng mẫu xe thật.', '<p>Mô tả mẫu.</p>',
  'sample-electric-bicycle-01', 'Sample electric bicycle', 'Sample product.', '<p>Sample description.</p>');
select pg_temp.add_product('MAU-DOCHOI-01', 6, 2800000, false, true, '{"voltage_v":12,"age_range":"3–6 tuổi","warranty_months":6}',
  'xe-dien-tre-em-mau-01', 'Xe điện trẻ em mẫu', 'Sản phẩm mẫu — thay bằng mẫu thật.', '<p>Mô tả mẫu.</p>',
  'sample-kids-ride-on-01', 'Sample kids'' ride-on car', 'Sample product.', '<p>Sample description.</p>');
select pg_temp.add_product('MAU-LINHKIEN-01', 7, 1200000, false, false, '{"part_type":"Bộ sạc","voltage_v":48,"warranty_months":6}',
  'bo-sac-xe-dien-mau-01', 'Bộ sạc xe điện mẫu', 'Sản phẩm mẫu — thay bằng linh kiện thật.', '<p>Mô tả mẫu.</p>',
  'sample-ev-charger-01', 'Sample EV charger', 'Sample product.', '<p>Sample description.</p>');

-- ===== Menu (chỉ tạo khi chưa có menu nào) =====
-- Thanh menu chính (màu thương hiệu) cố ý KHÔNG tạo: khi trống, website tự dựng từ Danh mục sản phẩm (kèm danh mục con) + Dịch vụ + Báo giá. Muốn tự sắp xếp: CMS > Menu > Thanh menu chính.
insert into menus(location, sort, label_vi, label_en, url_vi, url_en)
select * from (values
  ('top', 1, 'Trang chủ', 'Home', '/vi/', '/en/'),
  ('top', 2, 'Tin tức', 'News', '/vi/tin-tuc/', '/en/news/'),
  ('top', 3, 'Dịch vụ', 'Services', '/vi/dich-vu/', '/en/services/'),
  ('top', 4, 'Hỏi đáp', 'FAQ', '/vi/hoi-dap/', '/en/faq/'),
  ('top', 5, 'Giới thiệu', 'About', '/vi/gioi-thieu/', '/en/about-us/'),
  ('top', 6, 'Liên hệ', 'Contact', '/vi/lien-he/', '/en/contact/'),
  ('footer', 1, 'Giới thiệu', 'About', '/vi/gioi-thieu/', '/en/about-us/'),
  ('footer', 2, 'Báo giá số lượng lớn', 'Bulk quote', '/vi/bao-gia-so-luong-lon/', '/en/request-quote/'),
  ('footer', 3, 'Chính sách', 'Policies', '/vi/chinh-sach/', '/en/policies/'),
  ('footer', 4, 'Hỏi đáp', 'FAQ', '/vi/hoi-dap/', '/en/faq/')
) v(location, sort, label_vi, label_en, url_vi, url_en)
where not exists (select 1 from menus);

-- ===== Khối trang chủ (chỉ tạo khi chưa có khối nào) =====
insert into home_blocks(block_type, sort, payload)
select * from (values
  ('showcase', 1, '{"cfg":{"limit":4},"vi":{"title":"Xe điện chính hãng cho mọi nhu cầu","subtitle":"Giá bán lẻ công khai, báo giá riêng cho đơn số lượng lớn. Tư vấn chọn xe, giao hàng và bảo hành tận nơi.","cta1_label":"Xem sản phẩm","cta1_url":"/vi/san-pham/","news_title":"Tin tức mới"},"en":{"title":"Genuine electric vehicles for every need","subtitle":"Public retail prices, tailored quotes for bulk orders.","cta1_label":"Shop products","cta1_url":"/en/products/","news_title":"Latest news"}}'::jsonb),
  ('categories', 2, '{"vi":{"title":"Danh mục sản phẩm"},"en":{"title":"Product categories"}}'::jsonb),
  ('products', 3, '{"cfg":{"source":"featured","limit":8},"vi":{"title":"Sản phẩm nổi bật"},"en":{"title":"Featured products"}}'::jsonb),
  ('products', 4, '{"cfg":{"source":"new","limit":8},"vi":{"title":"Sản phẩm mới"},"en":{"title":"New arrivals"}}'::jsonb),
  ('news', 5, '{"cfg":{"limit":3},"vi":{"title":"Tin tức mới nhất"},"en":{"title":"Latest news"}}'::jsonb),
  ('cta', 6, '{"vi":{"title":"Mua số lượng lớn?","text":"Gửi yêu cầu để nhận báo giá riêng cho doanh nghiệp, đại lý và dự án.","button_label":"Gửi yêu cầu báo giá","button_url":"/vi/bao-gia-so-luong-lon/"},"en":{"title":"Buying in bulk?","text":"Send a request to get a tailored quote for businesses, dealers and projects.","button_label":"Request a quote","button_url":"/en/request-quote/"}}'::jsonb)
) v(block_type, sort, payload)
where not exists (select 1 from home_blocks);

-- ===== Kiểm tra nhanh =====
select (select count(*) from content_items where author_name = 'Nội dung mẫu') as noi_dung_mau,
       (select count(*) from products where sku like 'MAU-%') as san_pham_mau,
       (select count(*) from menus) as menu, (select count(*) from home_blocks) as khoi_trang_chu;

-- ===== XOÁ DỮ LIỆU MẪU khi không cần (bỏ comment, chạy riêng) =====
-- delete from content_items where author_name = 'Nội dung mẫu';
-- delete from products where sku like 'MAU-%';
