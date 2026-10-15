import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url)), read = (p) => readFileSync(join(here, p), 'utf8');
const db = new PGlite();
await db.exec(read('auth_stub.sql'));
for (const f of readdirSync(join(here, '../db/migrations')).sort()) { try { await db.exec(read('../db/migrations/' + f)); } catch (e) { console.log('migration', f, 'bỏ qua/lỗi:', e.message.slice(0, 80)); } }
await db.exec(read('../db/seed_core.sql')); await db.exec(read('../db/seed_xe_dien.sql'));
const cnt = async () => (await db.query(`select (select count(*) from content_items)::int c,(select count(*) from content_translations)::int t,(select count(*) from products)::int p,(select count(*) from product_translations)::int pt,(select count(*) from menus)::int m,(select count(*) from home_blocks)::int h,(select count(*) from post_categories)::int pc`)).rows[0];
let fail = 0;
try { await db.exec(read('../db/seed_demo.sql')); } catch (e) { console.log('LỖI seed_demo:', e.message); fail++; }
const a = await cnt(); console.log('lần 1', a);
try { await db.exec(read('../db/seed_demo.sql')); } catch (e) { console.log('LỖI lần 2:', e.message); fail++; }
const b = await cnt(); console.log('lần 2', b);
if (JSON.stringify(a) !== JSON.stringify(b)) { console.log('✘ chạy lại làm thay đổi dữ liệu'); fail++; }
const pub = (await db.query(`select kind,count(*)::int n from content_items where status='published' group by 1 order by 1`)).rows; console.log('published', JSON.stringify(pub));
console.log(fail ? 'THẤT BẠI' : 'OK'); process.exitCode = fail ? 1 : 0;
