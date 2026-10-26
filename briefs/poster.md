# Brief: โปสเตอร์เมนูประจำฤดู (PNG) + คุมค่าใช้จ่าย
> ข้อมูลสมมติเพื่อการเรียน · ชื่อในนี้คือข้อตกลงที่ `npm run check -- 18` อ่านตามเป๊ะ · ตัวตรวจใช้ `claude` จำลอง (`tools/fakes/claude`) ไม่เสียเงิน ส่วนตอนคุณรันจริงใช้ล็อกอินของคุณเอง
> ไม่ใช้บริการสร้างภาพที่ต้องสมัคร: ภาพมาจาก template HTML + ฟอนต์ที่มีในโฟลเดอร์ (`web/public/fonts/`)

## เป้าหมาย
ได้ไฟล์ `out/poster.png` ขนาด **1080×1350** ของเมนูประจำฤดู (`data/seasonal.json`) จาก 3 ขั้นต่อกัน: **โมเดลเขียนข้อความโปสเตอร์ → เครื่องมือเรากรอก template → ไฟล์ภาพ** · และต้องมี **เพดานค่าใช้จ่าย** ที่กดซ้ำเท่าไหร่ก็ไม่บานปลาย

## เครื่องมือ `tools/poster/`
รันด้วย `node --import tsx tools/poster/cli.ts [--theme <ข้อความ>] [--out <ไฟล์.png>] [--force]` (ค่าเริ่มต้น `out/poster.png`; ไฟล์ HTML วางข้างกันนามสกุล `.html`)
1. **ข้อมูลที่ใช้:** `data/seasonal.json` (ชื่อ ราคา คำบรรยาย `shop` `hours`), `data/ai-limits.json` (เพดาน), `tools/poster/template.html` (ไฟล์สำเร็จ: ช่อง `{{season}} {{headline}} {{subline}} {{items}} {{footer}} {{root}}`; `{{items}}` = `<li>` ละเมนู มี `<span class="name">`, `<span class="price">`, `<span class="blurb">`)
2. **โมเดล (ข้อความเท่านั้น):** เรียกแบบเดียวกับบท 17 ผ่าน env `CLAUDE_BIN` (ค่าเริ่มต้น `claude`), ไม่ใช้ shell: `-p <prompt> --output-format json --json-schema <schema> --max-budget-usd <max_usd_per_call>` · schema = `{"headline": string, "subline": string, "items": [{"name": string, "blurb": string}], "footer": string}` (ไม่มีฟิลด์ราคา: **ราคามาจาก `data/seasonal.json` เท่านั้น** ใส่ลง template เอง) · `--theme` ต่อท้าย prompt เป็นโจทย์เพิ่ม (เช่น "เน้นวันฝนตก")
3. **ตรวจผลโมเดลก่อนใช้:** `items` ต้องเป็นเมนูในไฟล์ครบทุกชื่อ ไม่เกิน ไม่ขาด (ชื่อตรงกับไฟล์) มิฉะนั้น exit 1 พิมพ์ข้อความไทย ไม่สร้างไฟล์ · ข้อความจากโมเดลต้อง **escape HTML** ก่อนใส่ template (กัน `<script>`)
4. **cache:** คีย์ = hash ของ (เมนู + theme + prompt) → เก็บผลโมเดลที่ `<state>/poster-cache/<key>.json` · มี cache แล้วห้ามเรียกโมเดลและไม่นับค่าใช้จ่าย (พิมพ์ว่า "จาก cache") · `--force` ข้าม cache
5. **เพดานค่าใช้จ่าย:** state ที่ `<state>/spend.json` = `{"date":"YYYY-MM-DD","calls":n,"usd":x}` (วันตามเวลา Asia/Bangkok, ขึ้นวันใหม่เริ่มศูนย์) · `<state>` = env `CAFE_STATE_DIR` (ค่าเริ่มต้น `.cafe`)
   - ก่อนเรียกโมเดล: ถ้า `calls >= max_calls_per_day` หรือ `usd + max_usd_per_call > max_usd_per_day` → **ไม่เรียก** exit 3 พิมพ์ข้อความไทยบอกว่าถึงเพดานวันนี้ (ใช้ไปกี่ครั้ง กี่ดอลลาร์) · cache ที่มีอยู่ยังใช้ได้แม้ถึงเพดาน
   - หลังเรียกสำเร็จ: `calls += 1`, `usd += total_cost_usd` จากผล JSON ของ claude
6. **วาดภาพ:** กรอก template → เขียน HTML → เปิดด้วย Playwright (`playwright`, Chromium headless, viewport 1080×1350, รอ `document.fonts.ready`) → screenshot เป็น PNG
7. **ตรวจภาพด้วย screenshot ของเราเอง:** ก่อนจบ ตรวจใน DOM ว่าไม่มีข้อความล้นกรอบ (ทุก `li` และ `#headline` อยู่ในจอ 1080×1350, `scrollWidth` ไม่เกิน) และฟอนต์ Kanit โหลดจริง · ไม่ผ่าน → exit 4 ข้อความไทย **ไม่ทิ้งไฟล์ PNG** (ลบที่เพิ่งสร้าง)
8. **สำเร็จ:** พิมพ์ `โปสเตอร์ → <ไฟล์.png> (โมเดล 1 ครั้ง · $0.05)` หรือ `(จาก cache)` exit 0 · ใส่สคริปต์ `npm run poster` ใน `package.json`

## ตั้งค่าครั้งเดียว
`npm install` แล้ว `npx playwright install chromium` (ตัวตรวจและเครื่องมือใช้ Chromium ตัวเดียวกัน) · เปิดดูผลด้วยการเปิดไฟล์ภาพให้ Claude อ่าน (Read) แล้วบอกว่าเห็นอะไร

## เสร็จเมื่อ
`npm test` ผ่าน (มี test ใน `tools/poster/*.test.ts`) · `npm run check -- 18` ผ่าน · รันจริงด้วยล็อกอินของคุณหนึ่งครั้ง ได้ `out/poster.png` และ Claude เปิดภาพดูแล้วรายงานว่าเห็นเมนูครบ 3 รายการ
