-- 012_header_layout.sql — bố cục đầu trang kiểu cửa hàng: thêm vị trí menu 'top' (thanh liên kết nhanh trên cùng) và loại khối trang chủ 'showcase' (banner lớn + banner phụ + tin mới).
-- Chạy được nhiều lần. Không đổi dữ liệu có sẵn.
alter table public.menus drop constraint if exists menus_location_ck;
alter table public.menus add constraint menus_location_ck check (location in ('main', 'footer', 'top'));
alter table public.home_blocks drop constraint if exists home_blocks_type_ck;
alter table public.home_blocks add constraint home_blocks_type_ck check (block_type in ('hero', 'categories', 'products', 'brands', 'news', 'cta', 'text', 'banner', 'showcase'));
