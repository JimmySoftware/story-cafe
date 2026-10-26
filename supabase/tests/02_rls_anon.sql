-- RLS: anon อ่านได้เฉพาะที่อนุญาต และเขียนไม่ได้
begin;
update public.menu_items set active = false where sort = 1;
update public.settings set is_public = false where key = 'phone';
insert into public.settings (key, value, is_public) values ('secret_test', '"x"', false);

set local role anon;
do $$
declare ok boolean;
begin
  assert (select count(*) from public.menu_items) = 13, 'anon ต้องเห็นเฉพาะเมนู active';
  assert (select count(*) from public.options) = 12, 'anon ต้องอ่าน options ได้';
  assert (select count(*) from public.settings where key in ('phone','secret_test')) = 0, 'anon ต้องไม่เห็น settings ที่ไม่ public';
  assert (select count(*) from public.settings) = 14, 'anon เห็นเฉพาะ settings ที่ public';

  ok := false;
  begin perform 1 from public.ingredients; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน ingredients ไม่ได้';
  ok := false;
  begin perform 1 from public.recipes; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องอ่าน recipes ไม่ได้';

  ok := false;
  begin update public.menu_items set price = 1; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องแก้ menu_items ไม่ได้';
  ok := false;
  begin insert into public.options (kind, label, price_delta, sort) values ('a','b',0,1); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องเพิ่ม options ไม่ได้';
  ok := false;
  begin delete from public.settings; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon ต้องลบ settings ไม่ได้';
end $$;
rollback;
