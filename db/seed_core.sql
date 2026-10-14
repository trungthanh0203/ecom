-- seed_core.sql — ma trận quyền + cài đặt mặc định. Chạy sau 001–003.
insert into public.role_permissions(role, perm)
select r, p from (values
  ('super_admin','products.write'),('super_admin','products.publish'),('super_admin','content.write'),('super_admin','content.publish'),
  ('super_admin','media.write'),('super_admin','seo.write'),('super_admin','orders.read'),('super_admin','orders.write'),
  ('super_admin','quotes.read'),('super_admin','quotes.write'),('super_admin','contacts.read'),('super_admin','contacts.write'),
  ('super_admin','settings.write'),('super_admin','staff.manage'),('super_admin','audit.read'),('super_admin','export.data'),

  ('admin','products.write'),('admin','products.publish'),('admin','content.write'),('admin','content.publish'),
  ('admin','media.write'),('admin','seo.write'),('admin','orders.read'),('admin','orders.write'),
  ('admin','quotes.read'),('admin','quotes.write'),('admin','contacts.read'),('admin','contacts.write'),
  ('admin','settings.write'),('admin','audit.read'),('admin','export.data'),

  ('editor','products.write'),('editor','products.publish'),('editor','content.write'),('editor','content.publish'),
  ('editor','media.write'),('editor','seo.write'),('editor','contacts.read'),

  ('contributor','products.write'),('contributor','content.write'),('contributor','media.write'),

  ('sales','quotes.read'),('sales','quotes.write'),('sales','orders.read'),('sales','contacts.read'),('sales','contacts.write'),('sales','export.data'),

  ('order_manager','orders.read'),('order_manager','orders.write'),('order_manager','quotes.read'),('order_manager','export.data')
) v(r, p)
on conflict do nothing;

insert into public.site_settings(key, value, is_public) values
  ('vat_rate',            '10',   true),    -- % VAT; giá niêm yết chưa gồm VAT. XÁC NHẬN thuế suất với kế toán.
  ('prices_include_vat',  'false', true),
  ('default_lang',        '"vi"', true),
  ('languages',           '["vi","en"]', true),
  ('currency',            '"VND"', true)
on conflict (key) do nothing;
