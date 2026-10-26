#!/bin/bash
# backup.sh — สำรองข้อมูลร้าน (pg_dump ของ schema public) จาก Supabase ในเครื่อง
# ใช้: bash tools/backup.sh   → เขียน ${CAFE_BACKUP_DIR:-backups}/story-cafe-YYYYMMDD-HHMMSS.sql (สิทธิ์ 600)
# บรรทัดสุดท้ายที่พิมพ์ = เส้นทางไฟล์ · ไม่พิมพ์รหัสผ่านหรือ connection string (ต่อผ่าน socket ใน container)
set -uo pipefail
cd "$(dirname "$0")/.."
C=${DB_CONTAINER:-supabase_db_$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)}

if ! command -v docker >/dev/null 2>&1 || [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" != "true" ]; then
  echo "สำรองไม่ได้: ฐานข้อมูลในเครื่องยังไม่ทำงาน (ไม่พบ container $C) — รัน npx supabase start ก่อน แล้วลองใหม่" >&2
  exit 1
fi

DIR=${CAFE_BACKUP_DIR:-backups}
mkdir -p "$DIR" || { echo "สำรองไม่ได้: สร้างโฟลเดอร์ $DIR ไม่ได้" >&2; exit 1; }
FILE="$DIR/story-cafe-$(date +%Y%m%d-%H%M%S).sql"

umask 077
if ! docker exec "$C" pg_dump -U postgres -d postgres --schema=public --no-owner > "$FILE" 2>/dev/null; then
  rm -f "$FILE"
  echo "สำรองไม่ได้: pg_dump ล้มเหลว ลองรัน npx supabase status ดูว่าฐานข้อมูลปกติไหม" >&2
  exit 1
fi
chmod 600 "$FILE"
echo "สำรองข้อมูลสำเร็จ ($(wc -c < "$FILE" | tr -d ' ') ไบต์)"
echo "$FILE"
