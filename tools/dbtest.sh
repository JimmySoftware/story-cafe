#!/bin/bash
# dbtest.sh — รัน test SQL (supabase/tests/*.sql) กับ Supabase ในเครื่องที่รันอยู่ (npx supabase start)
# ทุกไฟล์เป็น begin … rollback ในตัวเอง ไม่ทิ้งข้อมูล · ต้อง npx supabase db reset ให้มี migration + seed ก่อน
# ใช้: npm run test:db   หรือ   bash tools/dbtest.sh supabase/tests/xxx.sql
set -euo pipefail
cd "$(dirname "$0")/.."
C=${DB_CONTAINER:-supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)}
# dbhost = IP ของ container (ให้ test ที่ต้องเปิด connection เพิ่มด้วย dblink ใช้ผ่านรหัสผ่านได้ — localhost เป็น trust ซึ่ง dblink ไม่ยอมรับ)
HOST=$(docker exec "$C" hostname -i | awk '{print $1}')
psql() { docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -v dbhost="$HOST" -q "$@"; }
files=("$@"); [ ${#files[@]} -gt 0 ] || files=(supabase/tests/*.sql)
[ -e "${files[0]}" ] || { echo "ยังไม่มีไฟล์ test ใน supabase/tests/"; exit 1; }
pass=0; fail=0
for t in "${files[@]}"; do
  if out=$(psql < "$t" 2>&1); then echo "✓ $(basename "$t")"; pass=$((pass+1))
  else echo "✗ $(basename "$t")"; echo "$out" | grep -E 'ERROR|ASSERT|DETAIL|CONTEXT' | head -6; fail=$((fail+1)); fi
done
echo "test ฐานข้อมูล: ผ่าน $pass · ตก $fail"; [ $fail -eq 0 ]
