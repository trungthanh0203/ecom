-- seed_xe_dien.sql — danh mục + thuộc tính cho ngành XE ĐIỆN. Ngành khác: thay file này, giữ nguyên core.
-- Tên VI: published. Tên EN: DRAFT + machine_translated=true (dịch máy, chờ người duyệt — không tự xuất bản).
insert into public.categories(id, sort) values (1,1),(2,2),(3,3),(4,4),(5,5),(6,6),(7,7) on conflict do nothing;
select setval(pg_get_serial_sequence('public.categories','id'), 7);

insert into public.category_translations(category_id, lang, slug, name, status, machine_translated) values
 (1,'vi','o-to-dien','Ô tô điện','published',false),            (1,'en','electric-cars','Electric cars','draft',true),
 (2,'vi','xe-dien-du-lich','Xe điện du lịch','published',false), (2,'en','electric-sightseeing-vehicles','Electric sightseeing vehicles','draft',true),
 (3,'vi','xe-ba-banh-dien','Xe ba bánh điện','published',false), (3,'en','electric-tricycles','Electric tricycles','draft',true),
 (4,'vi','xe-may-dien','Xe máy điện','published',false),         (4,'en','electric-motorcycles','Electric motorcycles','draft',true),
 (5,'vi','xe-dap-dien','Xe đạp điện','published',false),         (5,'en','electric-bicycles','Electric bicycles','draft',true),
 (6,'vi','do-choi-dien','Đồ chơi điện','published',false),       (6,'en','electric-toys','Electric toys','draft',true),
 (7,'vi','linh-kien-xe-dien','Linh kiện xe điện','published',false), (7,'en','ev-parts','EV parts','draft',true)
on conflict do nothing;

insert into public.attribute_defs(category_id, code, value_type, unit, filterable, sort, label_vi, label_en) values
 (null,'origin','text',null,true,1,'Xuất xứ','Origin'),
 (null,'warranty_months','number','tháng',false,2,'Bảo hành','Warranty'),
 -- Ô tô điện (1)
 (1,'battery_kwh','number','kWh',true,10,'Dung lượng pin','Battery capacity'),
 (1,'range_km','number','km',true,11,'Quãng đường tối đa/lần sạc','Max range per charge'),
 (1,'motor_kw','number','kW',true,12,'Công suất động cơ','Motor power'),
 (1,'top_speed_kmh','number','km/h',false,13,'Tốc độ tối đa','Top speed'),
 (1,'charge_time_h','number','giờ',false,14,'Thời gian sạc đầy','Full charge time'),
 (1,'seats','number','chỗ',true,15,'Số chỗ ngồi','Seats'),
 (1,'battery_warranty','text',null,false,16,'Bảo hành pin','Battery warranty'),
 -- Xe điện du lịch (2)
 (2,'seats','number','chỗ',true,10,'Số chỗ ngồi','Seats'),
 (2,'battery_kwh','number','kWh',false,11,'Dung lượng pin','Battery capacity'),
 (2,'range_km','number','km',true,12,'Quãng đường/lần sạc','Range per charge'),
 (2,'motor_kw','number','kW',false,13,'Công suất động cơ','Motor power'),
 (2,'top_speed_kmh','number','km/h',false,14,'Tốc độ tối đa','Top speed'),
 -- Ba bánh điện (3)
 (3,'payload_kg','number','kg',true,10,'Tải trọng','Payload'),
 (3,'voltage_v','number','V',false,11,'Điện áp','Voltage'),
 (3,'capacity_ah','number','Ah',false,12,'Dung lượng ắc quy/pin','Battery capacity'),
 (3,'motor_w','number','W',false,13,'Công suất động cơ','Motor power'),
 (3,'range_km','number','km',true,14,'Quãng đường/lần sạc','Range per charge'),
 (3,'top_speed_kmh','number','km/h',false,15,'Tốc độ tối đa','Top speed'),
 -- Xe máy điện (4)
 (4,'motor_w','number','W',true,10,'Công suất động cơ','Motor power'),
 (4,'voltage_v','number','V',false,11,'Điện áp','Voltage'),
 (4,'capacity_ah','number','Ah',false,12,'Dung lượng pin','Battery capacity'),
 (4,'range_km','number','km',true,13,'Quãng đường/lần sạc','Range per charge'),
 (4,'top_speed_kmh','number','km/h',true,14,'Tốc độ tối đa','Top speed'),
 (4,'charge_time_h','number','giờ',false,15,'Thời gian sạc đầy','Full charge time'),
 (4,'weight_kg','number','kg',false,16,'Trọng lượng','Weight'),
 -- Xe đạp điện (5)
 (5,'motor_w','number','W',true,10,'Công suất động cơ','Motor power'),
 (5,'voltage_v','number','V',false,11,'Điện áp','Voltage'),
 (5,'capacity_ah','number','Ah',false,12,'Dung lượng pin','Battery capacity'),
 (5,'range_km','number','km',true,13,'Quãng đường/lần sạc','Range per charge'),
 (5,'wheel_inch','number','inch',true,14,'Cỡ bánh','Wheel size'),
 (5,'payload_kg','number','kg',false,15,'Tải trọng','Payload'),
 -- Đồ chơi điện (6)
 (6,'voltage_v','number','V',false,10,'Điện áp','Voltage'),
 (6,'age_range','text',null,true,11,'Độ tuổi phù hợp','Recommended age'),
 (6,'payload_kg','number','kg',false,12,'Tải trọng tối đa','Max load'),
 (6,'capacity_ah','number','Ah',false,13,'Dung lượng pin','Battery capacity'),
 -- Linh kiện (7)
 (7,'part_type','text',null,true,10,'Loại linh kiện','Part type'),
 (7,'compatible_models','text',null,true,11,'Dòng xe tương thích','Compatible models'),
 (7,'voltage_v','number','V',true,12,'Điện áp','Voltage'),
 (7,'capacity_ah','number','Ah',false,13,'Dung lượng','Capacity')
on conflict do nothing;
