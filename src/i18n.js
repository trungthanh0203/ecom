export const PATHS = {
  vi: { products: "san-pham", category: "danh-muc", brand: "thuong-hieu", cart: "gio-hang", checkout: "thanh-toan", confirm: "dat-hang-thanh-cong", quote: "bao-gia-so-luong-lon", quoteDone: "da-gui", contact: "lien-he", news: "tin-tuc", services: "dich-vu", policies: "chinh-sach", postCat: "chuyen-muc", faq: "hoi-dap", partners: "doi-tac", certs: "chung-nhan", projects: "du-an", careers: "tuyen-dung" },
  en: { products: "products", category: "category", brand: "brand", cart: "cart", checkout: "checkout", confirm: "order-confirmation", quote: "request-quote", quoteDone: "sent", contact: "contact", news: "news", services: "services", policies: "policies", postCat: "topic", faq: "faq", partners: "partners", certs: "certifications", projects: "projects", careers: "careers" }
};
export const u = (lang, key, ...rest) => "/" + [lang, PATHS[lang][key], ...rest].filter(Boolean).join("/") + "/";
export const productUrl = (lang, slug) => u(lang, "products", slug);

const D = {
  vi: {
    faq_title: "Hỏi đáp thường gặp", partners_title: "Đối tác & thương hiệu", certs_title: "Chứng nhận & giấy phép", projects_title: "Dự án & khách hàng tiêu biểu", careers_title: "Tuyển dụng", issuer: "Đơn vị cấp", year: "Năm", client: "Khách hàng", location: "Địa điểm", job_type: "Hình thức", salary: "Mức lương", deadline: "Hạn nộp hồ sơ", apply: "Ứng tuyển", apply_text: "Gửi hồ sơ/CV về email:", visit_site: "Truy cập website", view_cert: "Xem chứng nhận", expired: "Đã hết hạn nhận hồ sơ", more_info: "Thông tin thêm", jt_full_time: "Toàn thời gian", jt_part_time: "Bán thời gian", jt_contract: "Hợp đồng", jt_intern: "Thực tập", jt_freelance: "Cộng tác viên",
    consent_text: "Website dùng cookie phân tích (Google Analytics/Tag Manager) để cải thiện trải nghiệm. Bạn có đồng ý không?", consent_accept: "Chấp nhận", consent_decline: "Từ chối", cookie_settings: "Cài đặt cookie",
    nav_news: "Tin tức", nav_services: "Dịch vụ", h_latest_news: "Tin tức mới", read_more: "Xem chi tiết", news_title: "Tin tức & kiến thức", services_title: "Dịch vụ", policies_title: "Chính sách", all_topics: "Tất cả chuyên mục", posted_on: "Đăng ngày", empty_content: "Chưa có nội dung.", company: "Công ty", cta_contact: "Liên hệ tư vấn", by: "Tác giả",
    nav_products: "Sản phẩm", nav_quote: "Báo giá SLL", nav_contact: "Liên hệ", search_ph: "Tìm sản phẩm, mã SKU…", search: "Tìm", cart: "Giỏ hàng", home: "Trang chủ", skip: "Bỏ qua điều hướng",
    hero_sub: "Xe điện chính hãng — giá bán lẻ công khai, báo giá riêng cho đơn mua số lượng lớn.", hero_cta: "Xem sản phẩm", hero_cta2: "Yêu cầu báo giá SLL",
    h_cats: "Danh mục sản phẩm", h_featured: "Sản phẩm nổi bật", h_new: "Sản phẩm mới", h_brands: "Thương hiệu phân phối",
    b2b_title: "Mua số lượng lớn?", b2b_text: "Gửi yêu cầu để nhận báo giá riêng cho đại lý, doanh nghiệp, dự án.", b2b_cta: "Yêu cầu báo giá mua số lượng lớn",
    add_to_cart: "Thêm vào giỏ", quote_btn: "Yêu cầu báo giá mua số lượng lớn (Giá SLL)", quote_short: "Giá SLL", qty: "Số lượng",
    excl_vat: "Giá chưa gồm VAT", call_price: "Liên hệ để biết giá", not_retail: "Sản phẩm này không bán lẻ trực tuyến — vui lòng gửi yêu cầu báo giá.",
    sku: "Mã SKU", brand: "Thương hiệu", category: "Danh mục", unit: "Đơn vị", package: "Quy cách",
    t_desc: "Mô tả", t_specs: "Thông số kỹ thuật", t_features: "Đặc tính & lợi ích", t_ship: "Vận chuyển & chính sách", related: "Sản phẩm liên quan",
    sort: "Sắp xếp", sort_new: "Mới nhất", sort_asc: "Giá tăng dần", sort_desc: "Giá giảm dần", filters: "Bộ lọc", price_min: "Giá từ", price_max: "Giá đến", apply: "Áp dụng", reset: "Xoá lọc",
    all_cats: "Tất cả danh mục", all_brands: "Tất cả thương hiệu", no_products: "Chưa có sản phẩm phù hợp.", prev: "‹ Trước", next: "Sau ›", page: "Trang", results: "sản phẩm",
    cart_title: "Giỏ hàng", cart_empty: "Giỏ hàng trống.", continue: "Tiếp tục mua sắm", checkout: "Đặt hàng", remove: "Xoá", subtotal: "Tiền hàng", vat: "VAT", shipping: "Phí vận chuyển", total: "Tổng thanh toán",
    ship_tbd: "Tính khi nhập địa chỉ", price_note: "Giá được kiểm tra lại khi đặt hàng.", unit_price: "Đơn giá", line_total: "Thành tiền", item: "Sản phẩm",
    ck_title: "Thanh toán", ck_name: "Họ tên người nhận *", ck_phone: "Số điện thoại *", ck_email: "Email (tuỳ chọn)", ck_province: "Tỉnh/Thành phố *", ck_ward: "Phường/Xã", ck_address: "Địa chỉ (số nhà, đường) *",
    ck_note: "Ghi chú đơn hàng", ck_pay: "Phương thức thanh toán", ck_cod: "Thanh toán khi nhận hàng (COD)", ck_bank: "Chuyển khoản ngân hàng", ck_consent: "Tôi đồng ý với điều khoản và chính sách xử lý dữ liệu cá nhân *",
    ck_submit: "Xác nhận đặt hàng", ck_no_pay: "Hiện chưa có phương thức thanh toán nào được kích hoạt. Vui lòng liên hệ cửa hàng.",
    cf_title: "Đặt hàng thành công", cf_code: "Mã đơn hàng", cf_keep: "Vui lòng lưu mã đơn để tra cứu.", cf_bank_title: "Hướng dẫn chuyển khoản", cf_status: "Trạng thái", cf_pay_status: "Thanh toán", cf_none: "Không tìm thấy thông tin đơn hàng trên thiết bị này.",
    q_title: "Yêu cầu báo giá mua số lượng lớn", q_intro: "Điền thông tin, nhân viên sẽ liên hệ và gửi báo giá riêng. Gửi yêu cầu không cần tạo tài khoản.", q_contact: "Người liên hệ *", q_company: "Tên công ty *", q_phone: "Số điện thoại *", q_email: "Email công việc *", q_tax: "Mã số doanh nghiệp",
    q_items: "Sản phẩm cần báo giá", q_prod: "Sản phẩm (SKU hoặc tên) *", q_qty: "Số lượng *", q_unit: "Đơn vị", q_add: "+ Thêm sản phẩm", q_area: "Khu vực giao hàng", q_time: "Thời gian dự kiến mua", q_msg: "Nội dung yêu cầu", q_submit: "Gửi yêu cầu báo giá", q_consent: "Tôi đồng ý với chính sách xử lý dữ liệu cá nhân *",
    qd_title: "Đã nhận yêu cầu báo giá", qd_text: "Nhân viên sẽ liên hệ với bạn sớm nhất. Mã yêu cầu của bạn:",
    ct_title: "Liên hệ", ct_name: "Họ tên *", ct_phone: "Số điện thoại", ct_email: "Email", ct_msg: "Nội dung *", ct_submit: "Gửi liên hệ", ct_ok: "Đã gửi. Chúng tôi sẽ phản hồi sớm.", ct_need: "Nhập số điện thoại hoặc email.",
    nf_title: "Không tìm thấy trang", nf_text: "Trang bạn tìm không tồn tại hoặc đã được di chuyển.", footer_rights: "Bảo lưu mọi quyền.", working: "Giờ làm việc",
    turnstile_need: "Vui lòng xác minh bạn không phải robot.", sending: "Đang gửi…", problem_NOT_FOUND: "Sản phẩm không còn tồn tại", problem_UNAVAILABLE: "Sản phẩm tạm ngừng kinh doanh", problem_NOT_FOR_RETAIL: "Không bán lẻ — cần báo giá", problem_NO_PRICE: "Chưa có giá", problem_QTY_LIMIT: "Vượt số lượng tối đa",
    added: "Đã thêm vào giỏ hàng",
    err_GENERIC: "Có lỗi xảy ra, vui lòng thử lại.", err_RATE: "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.", err_CONSENT_REQUIRED: "Vui lòng đồng ý với điều khoản.", err_INVALID_CUSTOMER: "Thông tin giao hàng chưa hợp lệ.", err_CART_INVALID: "Giỏ hàng có sản phẩm không hợp lệ — hãy kiểm tra lại giỏ hàng.", err_EMPTY_CART: "Giỏ hàng trống.",
    err_INVALID_PAYMENT_METHOD: "Phương thức thanh toán không hợp lệ.", err_INVALID_QUOTE_FIELDS: "Thông tin liên hệ chưa hợp lệ.", err_INVALID_QUOTE_ITEMS: "Danh sách sản phẩm chưa hợp lệ.", err_QUOTE_PRODUCT_UNAVAILABLE: "Có sản phẩm không còn khả dụng.", err_INVALID_CONTACT_FIELDS: "Thông tin liên hệ chưa hợp lệ.", err_TURNSTILE: "Xác minh robot thất bại, vui lòng thử lại.",
    err_ORIGIN: "Yêu cầu bị từ chối.", err_INVALID_ITEM: "Giỏ hàng có dữ liệu không hợp lệ."
  },
  en: {
    faq_title: "Frequently asked questions", partners_title: "Partners & brands", certs_title: "Certifications & licenses", projects_title: "Projects & clients", careers_title: "Careers", issuer: "Issued by", year: "Year", client: "Client", location: "Location", job_type: "Type", salary: "Salary", deadline: "Apply by", apply: "Apply", apply_text: "Send your CV to:", visit_site: "Visit website", view_cert: "View certificate", expired: "Applications are closed", more_info: "More", jt_full_time: "Full-time", jt_part_time: "Part-time", jt_contract: "Contract", jt_intern: "Internship", jt_freelance: "Freelance",
    consent_text: "This website uses analytics cookies (Google Analytics/Tag Manager) to improve your experience. Do you agree?", consent_accept: "Accept", consent_decline: "Decline", cookie_settings: "Cookie settings",
    nav_news: "News", nav_services: "Services", h_latest_news: "Latest news", read_more: "Read more", news_title: "News & insights", services_title: "Services", policies_title: "Policies", all_topics: "All topics", posted_on: "Posted on", empty_content: "No content yet.", company: "Company", cta_contact: "Contact us", by: "By",
    nav_products: "Products", nav_quote: "Bulk quote", nav_contact: "Contact", search_ph: "Search products, SKU…", search: "Search", cart: "Cart", home: "Home", skip: "Skip navigation",
    hero_sub: "Genuine electric vehicles — public retail prices, tailored quotes for bulk orders.", hero_cta: "Browse products", hero_cta2: "Request a bulk quote",
    h_cats: "Product categories", h_featured: "Featured products", h_new: "New arrivals", h_brands: "Brands we distribute",
    b2b_title: "Buying in bulk?", b2b_text: "Send a request to get a dedicated quote for dealers, businesses and projects.", b2b_cta: "Request a bulk quote",
    add_to_cart: "Add to cart", quote_btn: "Request a bulk-purchase quote", quote_short: "Bulk quote", qty: "Quantity",
    excl_vat: "Price excludes VAT", call_price: "Contact us for price", not_retail: "This product is not sold online at retail — please send a quote request.",
    sku: "SKU", brand: "Brand", category: "Category", unit: "Unit", package: "Packaging",
    t_desc: "Description", t_specs: "Specifications", t_features: "Features & benefits", t_ship: "Shipping & policies", related: "Related products",
    sort: "Sort", sort_new: "Newest", sort_asc: "Price: low to high", sort_desc: "Price: high to low", filters: "Filters", price_min: "Price from", price_max: "Price to", apply: "Apply", reset: "Clear filters",
    all_cats: "All categories", all_brands: "All brands", no_products: "No matching products yet.", prev: "‹ Prev", next: "Next ›", page: "Page", results: "products",
    cart_title: "Cart", cart_empty: "Your cart is empty.", continue: "Continue shopping", checkout: "Checkout", remove: "Remove", subtotal: "Subtotal", vat: "VAT", shipping: "Shipping", total: "Total",
    ship_tbd: "Calculated from address", price_note: "Prices are re-verified when you place the order.", unit_price: "Unit price", line_total: "Amount", item: "Item",
    ck_title: "Checkout", ck_name: "Recipient name *", ck_phone: "Phone *", ck_email: "Email (optional)", ck_province: "Province/City *", ck_ward: "Ward", ck_address: "Address (street, number) *",
    ck_note: "Order note", ck_pay: "Payment method", ck_cod: "Cash on delivery (COD)", ck_bank: "Bank transfer", ck_consent: "I agree to the terms and the personal-data policy *",
    ck_submit: "Place order", ck_no_pay: "No payment method is enabled yet. Please contact the shop.",
    cf_title: "Order placed", cf_code: "Order code", cf_keep: "Please keep this code for reference.", cf_bank_title: "Bank transfer instructions", cf_status: "Status", cf_pay_status: "Payment", cf_none: "No order information found on this device.",
    q_title: "Request a bulk-purchase quote", q_intro: "Fill in the form and our staff will contact you with a dedicated quote. No account needed.", q_contact: "Contact person *", q_company: "Company name *", q_phone: "Phone *", q_email: "Business email *", q_tax: "Company tax ID",
    q_items: "Products to quote", q_prod: "Product (SKU or name) *", q_qty: "Quantity *", q_unit: "Unit", q_add: "+ Add product", q_area: "Delivery area", q_time: "Expected purchase time", q_msg: "Message", q_submit: "Send quote request", q_consent: "I agree to the personal-data policy *",
    qd_title: "Quote request received", qd_text: "Our staff will contact you shortly. Your request code:",
    ct_title: "Contact", ct_name: "Name *", ct_phone: "Phone", ct_email: "Email", ct_msg: "Message *", ct_submit: "Send", ct_ok: "Sent. We will get back to you soon.", ct_need: "Enter a phone number or an email.",
    nf_title: "Page not found", nf_text: "The page you are looking for does not exist or has moved.", footer_rights: "All rights reserved.", working: "Working hours",
    turnstile_need: "Please verify you are human.", sending: "Sending…", problem_NOT_FOUND: "Product no longer exists", problem_UNAVAILABLE: "Product temporarily unavailable", problem_NOT_FOR_RETAIL: "Not sold at retail — quote required", problem_NO_PRICE: "No price", problem_QTY_LIMIT: "Quantity limit exceeded",
    added: "Added to cart",
    err_GENERIC: "Something went wrong, please try again.", err_RATE: "Too many attempts, please try again in a few minutes.", err_CONSENT_REQUIRED: "Please accept the terms.", err_INVALID_CUSTOMER: "Delivery details are invalid.", err_CART_INVALID: "Your cart has invalid items — please review it.", err_EMPTY_CART: "Cart is empty.",
    err_INVALID_PAYMENT_METHOD: "Invalid payment method.", err_INVALID_QUOTE_FIELDS: "Contact details are invalid.", err_INVALID_QUOTE_ITEMS: "Product list is invalid.", err_QUOTE_PRODUCT_UNAVAILABLE: "A product is no longer available.", err_INVALID_CONTACT_FIELDS: "Contact details are invalid.", err_TURNSTILE: "Bot check failed, please retry.",
    err_ORIGIN: "Request rejected.", err_INVALID_ITEM: "Your cart contains invalid data."
  }
};
export const tr = (lang) => D[lang] || D.vi;
const KEY = { post: "news", service: "services", policy: "policies", faq: "faq", partner: "partners", certification: "certs", project: "projects", career: "careers" };
export const HAS_DETAIL = new Set(["post", "service", "policy", "project", "career"]);
export const LIST_ONLY_KINDS = ["faq", "partner", "certification", "project", "career"];
export const listUrl = (lang, kind) => u(lang, KEY[kind]);
export const contentUrl = (lang, kind, slug) => (kind === "page" ? `/${lang}/${slug}/` : u(lang, KEY[kind], slug));
