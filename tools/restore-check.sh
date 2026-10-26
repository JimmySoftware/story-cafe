#!/bin/bash
# restore-check.sh — พิสูจน์ว่าไฟล์สำรองกู้ได้จริง: กู้ลงฐานชั่วคราว restore_check_<เลขสุ่ม> แล้วเทียบจำนวนแถวทุกตารางใน public กับฐานจริง
# ใช้: bash tools/restore-check.sh <ไฟล์.sql>   → exit 0 เมื่อตรงทุกตาราง ไม่งั้น exit 1 · ลบฐานชั่วคราวทุกกรณี
# ฐานชั่วคราวมีแค่ stub ของ auth: error ของ FK ไป auth.users (ไม่มีผู้ใช้จริง) / สิทธิ์ของ role เป็นเรื่องปกติ — นับแถวต่อได้
set -uo pipefail
cd "$(dirname "$0")/.."
FILE=${1:-}
[ -n "$FILE" ] || { echo "ใช้: bash tools/restore-check.sh <ไฟล์.sql>" >&2; exit 1; }
[ -f "$FILE" ] || { echo "ตรวจไม่ได้: ไม่พบไฟล์ $FILE" >&2; exit 1; }
C=${DB_CONTAINER:-supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)}
if ! command -v docker >/dev/null 2>&1 || [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" != "true" ]; then
  echo "ตรวจไม่ได้: ฐานข้อมูลในเครื่องยังไม่ทำงาน (ไม่พบ container $C) — รัน npx supabase start ก่อน" >&2
  exit 1
fi

q() { docker exec -i "$C" psql -U postgres -d "$1" -Atq -c "$2"; }   # q <ฐาน> <sql>
TMP="restore_check_${RANDOM}${RANDOM}"
cleanup() { docker exec "$C" psql -U postgres -d postgres -qc "drop database if exists $TMP with (force)" >/dev/null 2>&1; }
trap cleanup EXIT

q postgres "create database $TMP" >/dev/null || { echo "ตรวจไม่ได้: สร้างฐานชั่วคราวไม่ได้" >&2; exit 1; }
# stub schema auth ขั้นต่ำ (ฐานชั่วคราวไม่มี auth ของ Supabase) ให้ตารางที่ใช้ DEFAULT auth.uid() สร้างได้ และนับแถวได้ครบ
q "$TMP" "create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select null::uuid';
  create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb';
  create function auth.role() returns text language sql stable as 'select null::text'" >/dev/null \
  || { echo "ตรวจไม่ได้: เตรียมฐานชั่วคราวไม่ได้" >&2; exit 1; }
# กู้ไฟล์ลงไป (ไม่หยุดเมื่อเจอ error) · เก็บ error ไว้บอกจำนวน
ERRS=$(docker exec -i "$C" psql -U postgres -d "$TMP" -q < "$FILE" 2>&1 >/dev/null | grep -c 'ERROR')
echo "กู้ไฟล์ลงฐานชั่วคราวแล้ว (error ที่ข้ามไป ${ERRS} รายการ เช่น เรื่อง auth ซึ่งปกติ)"

TABLES=$(q postgres "select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') order by 1") \
  || { echo "ตรวจไม่ได้: อ่านรายชื่อตารางจากฐานจริงไม่ได้" >&2; exit 1; }
bad=0; total=0
for t in $TABLES; do
  total=$((total+1))
  real=$(q postgres "select count(*) from public.\"$t\"") || real="?"
  back=$(q "$TMP" "select count(*) from public.\"$t\"" 2>/dev/null); [ -n "$back" ] || back="-"
  if [ "$real" = "$back" ]; then echo "✓ $t $back/$real"; else echo "✗ $t $back/$real"; bad=$((bad+1)); fi
done
echo "(รูปแบบ: แถวในไฟล์สำรอง/แถวในฐานจริง)"
if [ $bad -eq 0 ]; then echo "กู้คืนตรงกันทุกตาราง ($total ตาราง)"; exit 0; fi
echo "กู้คืนไม่ตรง $bad ตารางจาก $total — ไฟล์สำรองเก่ากว่าข้อมูลจริง หรือกู้ไม่ครบ ให้สำรองใหม่แล้วตรวจอีกครั้ง"
exit 1
