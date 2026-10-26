// สร้าง supabase/seed.sql จาก data/*.csv (ไม่พิมพ์ราคา/ปริมาณเอง) · ข้อมูลร้านอยู่ในตาราง settings (supabase/seed_settings.sql)
// ใช้: node tools/db/gen-seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8');
const csv = (f) => {
  const [head, ...rows] = read(f).trim().split(/\r?\n/).map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i].trim()])));
};
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const out = ['-- สร้างโดย tools/db/gen-seed.mjs จาก data/*.csv — อย่าแก้มือ', ''];

const menu = csv('menu.csv');
out.push('-- migration (เมนูใหม่) รันก่อน seed: ดันแถวที่มีอยู่แล้วไปต่อท้ายเมนูในไฟล์ เพื่อให้ sort ไม่ซ้ำ');
out.push(`update public.menu_items set sort = sort + ${menu.length};`, '');
out.push('insert into public.menu_items (category, name, price, is_drink, sort) values');
out.push(menu.map((m, i) => `  (${q(m.category)}, ${q(m.name)}, ${Number(m.price)}, ${m.is_drink === '1'}, ${i + 1})`).join(',\n') + ';', '');

out.push('insert into public.options (kind, label, price_delta, sort) values');
out.push(csv('options.csv').map((o) => `  (${q(o.kind)}, ${q(o.label)}, ${Number(o.price_delta)}, ${Number(o.sort)})`).join(',\n') + ';', '');

out.push('insert into public.ingredients (name, unit, stock, reorder_level) values');
out.push(csv('ingredients.csv').map((g) => `  (${q(g.name)}, ${q(g.unit)}, ${Number(g.stock)}, ${Number(g.reorder_level)})`).join(',\n') + ';', '');

out.push('insert into public.recipes (menu_item_id, ingredient_id, amount)');
out.push('select m.id, g.id, v.amount from (values');
out.push(csv('recipes.csv').map((r) => `  (${q(r.menu)}, ${q(r.ingredient)}, ${Number(r.amount)}::numeric)`).join(',\n'));
out.push(') as v(menu, ingredient, amount)');
out.push('join public.menu_items m on m.name = v.menu');
out.push('join public.ingredients g on g.name = v.ingredient;', '');

writeFileSync(new URL('../../supabase/seed.sql', import.meta.url), out.join('\n'));
