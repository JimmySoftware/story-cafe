# Brief: ช่องทางขาย `channel` ครบทุกส่วน + แก้จนเขียว
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 23` อ่านตามเป๊ะ · ทุกอย่างทดสอบกับ Supabase ในเครื่อง + LINE จำลอง

## เป้าหมาย
เจ้าของร้านอยากรู้ว่ายอดมาจากช่องไหน: **หน้าร้าน (store) · LINE (line) · เว็บ (web) · เดลิเวอรี (delivery)** เรื่องเดียวที่แตะ **ทุกส่วน** ของระบบ (ฐานข้อมูล, ฟังก์ชัน, POS, แอปเจ้าของ, หน้าเว็บ) จึงเป็นงานที่ต้อง "แก้ไปตรวจไป จนเขียว" — และต้องรู้ว่าเมื่อไหร่ควรหยุด

## 1) ฐานข้อมูล (migration ใหม่ ห้ามแก้เก่า)
- คอลัมน์ `channel text not null check (channel in ('store','line','web','delivery'))` บน `pos_bills` (ค่าเริ่มต้น `store`), `orders` (ค่าเริ่มต้น `web`), `shop_orders` (ค่าเริ่มต้น `web`) · ข้อมูลเก่าได้ค่าเริ่มต้น
- ฟังก์ชันรับพารามิเตอร์ใหม่ **ต่อท้าย** แบบมีค่าเริ่มต้น: `pos_record_bill(…, p_channel text default 'store')`, `place_preorder(…, p_channel text default 'web')`, `create_order(…, p_channel text default 'web')` · ค่านอกรายการ → exception ขึ้นต้น `bad_channel:` · ของเดิมที่เรียกแบบไม่ส่ง `p_channel` ต้องยังใช้ได้ (ห้ามมี overload ซ้ำซ้อนจนเรียกกำกวม: ลบฟังก์ชันเก่าที่ลายเซ็นไม่ตรงทิ้งก่อนสร้างใหม่)
- `sales_summary(p_day)` เพิ่ม `by_channel`: `{"store":{"bills","revenue","cups"},"line":{…},"web":{…},"delivery":{…}}` ครบทั้งสี่ช่องแม้เป็นศูนย์ · ผลรวมทั้งสี่ช่อง = `bills`/`revenue`/`cups` รวม (ฟังก์ชันเดียวทุกช่องทาง ห้ามแตกเป็นหลายฟังก์ชัน)
- trigger คิวแจ้งเตือน (บท 15): `payload` เพิ่ม `"channel"` ของออเดอร์นั้น
- `morning_summary_data` เพิ่ม `by_channel` = จำนวนออเดอร์ของวันนั้นแยกช่อง (`{"store":n,"line":n,"web":n,"delivery":n}`)
- test SQL ใหม่ `supabase/tests/14_channel.sql` (ชื่อมีคำว่า `channel`) พิสูจน์ข้อด้านบน แล้ว `npm run test:db` ผ่านทั้งหมด

## 2) ฟังก์ชัน (Edge Functions)
- `notify_owner`: ข้อความแจ้งออเดอร์ใหม่บอกช่องเป็นภาษาไทยท้ายบรรทัด เช่น `ออเดอร์ใหม่ SC-… · ยอด 130 บาท · ช่องทาง LINE` (ป้ายไทย: store=`หน้าร้าน`, line=`LINE`, web=`เว็บ`, delivery=`เดลิเวอรี`)
- `morning_summary`: ข้อความสรุปเช้ามีบรรทัดแยกช่อง (เฉพาะช่องที่มีออเดอร์) เช่น `ช่องทาง: LINE 1 · เว็บ 2`

## 3) หน้าจอ
- POS (`pos/`): ปุ่มเลือกช่อง `data-testid="channel-store|line|web|delivery"` (ค่าเริ่มต้น store) · ช่องที่เลือกติดไปกับบิลในคิว offline (`PendingBill.channel`) และส่งเป็น `p_channel` ตอนบันทึก
- แอปเจ้าของ (`owner/`): แสดงยอดแยกช่อง `data-testid="channel-total-store|line|web|delivery"` จาก `sales_summary().by_channel` เท่านั้น
- หน้าเว็บ (`web/`): พรีออเดอร์และร้านค้าส่ง `p_channel: 'web'` ชัดเจน

## 4) workflow "แก้จนเขียว" (ไฟล์สำเร็จ `tools/green-loop.mjs`)
`node tools/green-loop.mjs --rounds 4 [--part win|break|extra]` = ตรวจ → ถ้าแดงเรียก `claude -p` แก้ → ตรวจใหม่ ซ้ำจนเขียว หรือครบ N รอบ หรือแก้ไปสองครั้งติดกันแล้วรายการที่แดงยังเหมือนเดิม (หยุดก่อนเผาเงิน) · พิมพ์ตารางรอบ/ข้อที่แดง/ค่าใช้จ่าย · สคริปต์นี้ **ไม่ใช่ agent**: คนกำหนดจำนวนรอบ ไม่ใช่โมเดล
- ใช้ได้เมื่อ "ตัวตรวจ" ชัดเจนและเร็ว · ถ้าไม่มีตัวตรวจที่เชื่อถือได้ ลูปจะแก้ผิดทางอย่างมั่นใจ

## 5) เปรียบเทียบ (เขียนเอง ผลจากการรันจริง)
`docs/workflow-vs-team.md`: ตารางเปรียบเทียบ workflow (green-loop) กับ agent team ที่ใช้เวลา/รอบ/ค่าใช้จ่ายจริงของ workflow รอบนี้ (จากตารางที่สคริปต์พิมพ์) + บอกตรง ๆ ว่า agent teams เป็นฟีเจอร์ **ทดลอง (experimental)** ปิดเป็นค่าเริ่มต้น เปิดด้วย `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` ต้องใช้ session แบบ interactive (ใน `claude -p` ไม่ตั้งทีม) ใช้ token มากกว่า session เดียว · อ้างเอกสารทางการ https://code.claude.com/docs/en/agent-teams · ห้ามเดาตัวเลขของ team ที่ไม่ได้ลองเอง (ถ้าไม่ได้ลองให้เขียนว่ายังไม่ได้ลอง)

## เสร็จเมื่อ
`npm test`, `npm run test:db`, `npm run check -- 23` ผ่าน · commit เป็นภาษาไทย
