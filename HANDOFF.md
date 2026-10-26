# HANDOFF — Story Cafe (ร้านตัวอย่างของคอร์ส Claude Code ฉบับคาเฟ่)

อัปเดตล่าสุด 26 ต.ค. 2026 · job 1026-141006-05cf (worker station-d) · เจ้าของ: session `cc` (DGX Station `/home/station/books/cc-course`)

## What this is
แอปร้านกาแฟสมมติ "Story Cafe" ที่ผู้เรียนสร้างทีละบทด้วย Claude Code จากสูตร (recipe) ที่ copy-paste ได้ · ปลายทางของคอร์สคือโปรแกรมร้านที่ใช้งานได้จริงของร้านเดียว
(ข้อมูลร้านอยู่ในไฟล์ข้อมูล/ตั้งค่า ไม่ฝังในโค้ด เพื่อให้โค้ดชุดเดียวกันเป็น SaaS ได้ทีหลัง · Jimmy 26 ต.ค.) · รอบ 1 ครอบคลุมบทแนะนำ + บท 1–8 (ยังไม่มี Supabase; เริ่มบท 9)
ทุกอย่างเป็นข้อมูลสมมติ (เบอร์ `0X-XXX-XXXX`, LINE `@storycafe-demo`, ที่อยู่สมมติ) ไม่มีโลโก้/แบรนด์จริง

## Current version
- branch `main` = `lesson-08` + ไฟล์นี้ · remote `origin` = https://github.com/JimmySoftware/story-cafe (**ยังไม่ push**: cc push หลัง Jimmy ดูรอบ 1) · ยังไม่มี LICENSE (กำลังตัดสิน source-available)
- Tag ทั้งหมดอยู่ในประวัติเส้นตรงเดียว (ลำดับตามตาราง):

| tag | คืออะไร | สูตรที่ใช้ tag นี้เป็นจุดเริ่ม |
|---|---|---|
| `lesson-00` (= `start-00`) | ชุดเริ่มต้นของผู้เรียน: `README.md`, `menu.txt`, `shop.txt`, `fonts/`, `.gitignore` (`.cafe/`), ตัวตรวจ `npm run check` (ไม่มี dependency) | 00 |
| `start-01` | kit + `briefs/menu-board.md` + ตัวตรวจบท 1 | 01 |
| `lesson-01` | + `menu.html` (เมนูบอร์ด) + `CLAUDE.md` ฉบับย่อ | |
| `start-02` / `lesson-02` | + `briefs/preorder.md` · + `docs/plan-preorder.md`, `plan-vague.md`, `เทียบแผน.md` | 02 |
| `start-03` / `lesson-03` | + `.env` ปลอม (ค่า FAKE) · + `.claude/settings.json` (deny `.env*`/`secrets/`, ask ก่อน push) + `.env.example` | 03 |
| `start-04` / `lesson-04` | + `data/menu.csv`, `data/shop.json`, Excel ของร้าน, ใบสั่งตัวอย่าง, test + `pdf.ts` ของใบเสนอราคา, parser Excel แบบเข้มงวด, `package.json` (pdfkit, exceljs, tsx) · + `pricing.ts`, `cli.ts`, parser ที่รับราคาหลายรูปแบบ + test | 04 |
| `start-05` / `lesson-05` | ตัวตรวจบท 5 (ผู้เรียนเริ่ม **ไม่มี .git**) · + `.gitignore` เต็ม + `docs/git-first-commit.md` | 05 |
| `start-06` / `lesson-06` | + `briefs/shop-rules.md` · + `CLAUDE.md` ฉบับสมบูรณ์ | 06 |
| `start-07` / `lesson-07` | + `web/` (Vite+React+TS, `src/menu.ts` อ่าน `data/`, ฟอนต์ใน `public/fonts/`) + `briefs/landing.md` + ข้อมูลของขาย/workshop ใน `shop.json` · + หน้าแรก (skill `frontend-design`) + `docs/plugin-review.md` | 07 |
| `start-08` / `lesson-08` | + `briefs/deploy.md` + แถบโปรโมชันกว้างตายตัวใน `web/index.html` (จงใจให้ล้นจอมือถือ) · + `wrangler.jsonc`, สคริปต์ deploy, แก้แถบโปรให้พอดีจอ, `docs/responsive-check.md` | 08 |

กติกา: `lesson-NN` = สถานะ **ท้ายบท NN** (คัดจากการรันจริง แล้ว curate) · `start-NN` = `lesson-(NN-1)` + ไฟล์สำเร็จของบท NN (brief, ข้อมูล, ตัวตรวจ) · ไฟล์ของบทหลังไม่โผล่ใน tag ก่อนหน้า
(ตัวตรวจ `lesson-NN.mjs` ปรากฏที่ `start-NN`) · tag **ไม่มี `.git` ของผู้เรียน** (ผู้เรียนได้ไฟล์ล้วนจาก `git archive`): สูตรที่ `git_state: init` (บท 6–8) ให้ companion รัน `git init -b main` + commit "start <tag>" ให้ก่อนเปิด Terminal

## File map และวิธีสร้างใหม่
- `tools/check/` — `index.mjs` (`npm run check -- NN [--part win|break] [--json]`, env `CAFE_CHECK_DIR` ให้เครื่องมือชี้ตัวตรวจจากที่อื่น), `lib.mjs`, `lesson-NN.mjs` (รายการ `checks` มี `part`: `win` = ผลแรก, `break` = ลองพัง, `later` = `[ตรวจหลังสมัคร]` ข้ามไม่นับตก)
- `tools/quote/`, `tools/menu/` — ใบเสนอราคา PDF และตัวแปลง Excel→CSV (บท 4) · `data/` — `menu.csv` (ราคาจริงที่เดียว), `shop.json` · `web/` — หน้าเว็บ (Vite) · `briefs/` — brief ต่อบท · `docs/` — งานที่ผู้เรียนทำในแต่ละบท
- สูตร (recipe cards) และหลักฐานการทดสอบ **ไม่อยู่ใน repo นี้**: `/home/station/books/cc-course/course/recipes/` (`00.md`…`08.md`, `index.json`, `recipe.schema.json`, `needs.json`, `img/`, `validation/`)
- ที่มาของ tag: แต่ละ `lesson-NN` สร้างโดยรัน prompt ของสูตรจริงใน box สะอาด แล้วคัดไฟล์ผลลัพธ์ของรอบที่ดีเข้า repo ด้วยมือ (ดู Version history); ประวัติถูกเขียนใหม่ด้วย `validation/bin/retree.py` เมื่อต้องแก้ไฟล์ที่ต้องอยู่ในหลาย tag (ตัวตรวจ, README) — repo ยังไม่เคย push จึงทำได้
- สร้างใหม่ทั้งหมด: ดู `course/recipes/validation/README.md` (harness: `bin/mkbox.sh`, `run.py`, `recipe_run.sh`, `aggregate.py`, `mkcards.py`)

## Verified facts & sources
ข้อเท็จจริงของเครื่องมือ/บริการ: `course/FACTS-add-v12-cafe.md` (Claude Code 2.1.310, wrangler `--dry-run` ไม่ต้องล็อกอิน, เวอร์ชัน npm, plan mode แบบ headless ฯลฯ) · ที่เหลือใช้ `course/FACTS.md` ตามเดิม
ไม่มีตัวเลขราคาจริง: ราคาเมนู/ของขาย/workshop ทั้งหมดเป็นค่าสมมติของร้านตัวอย่าง

## Decisions
- 26 ต.ค. Jimmy: ชื่อร้าน Story Cafe · mod ชื่อ `cafe-coder` · บท 6–10 นาที ได้ผลแรก ≤ 3 นาที · เป็นคอร์สอย่างเดียว · ทำร้านเดียวก่อน ข้อมูลร้านไม่ hardcode (answers file)
- รัน headless ด้วย `--permission-mode auto` (= ค่าเริ่มต้นของผู้เรียน) เพราะ `acceptEdits` ปฏิเสธคำสั่ง shell ทั่วไป
- "ผลแรก" = เวลานับจากกด Enter จนตัวตรวจส่วน `win` ผ่านครั้งแรก (poll ทุก 3 วินาที) ไม่ใช่เวลาที่ Claude หยุดพูด
- บท 5 เริ่มโดยไม่มี `.git` (สอน git ตั้งแต่ศูนย์) · บท 6–8 เริ่มด้วย repo ที่ companion `git init` ให้ · `.claude/settings.json` ต้องเข้า git, `settings.local.json` ไม่เข้า
- `lesson-06` ไม่รวมผล prompt ข้อ 2 (เมนู "ลาเต้ส้ม") เพราะเป็นแค่การพิสูจน์ว่า Claude ทำตาม CLAUDE.md ไม่ใช่ข้อมูลร้านถาวร
- test ของบท 4 ที่เทียบ Excel→CSV เทียบกับ `tools/menu/expected-menu.csv` (ไม่ใช่ `data/menu.csv`) เพื่อให้เพิ่มเมนูจริงทีหลังไม่ทำ test แดง (พบจากรัน r06 รอบแรก)

## Version history
- 26 ต.ค. 2026 · job 1026-141006-05cf: รอบ 1 สร้าง tag `lesson-00`…`lesson-08` + `start-01`…`start-08`; 9 สูตร × 5 รัน ผ่าน 5/5 ทุกสูตร (ตารางผลอยู่ใน Hub item `cc-cafe-r1` และ `course/recipes/validation/stats.json`)
- สิ่งที่แก้หลังรอบแรกไม่ผ่านเกณฑ์ (ย่อ): สูตร 1 ให้บอกว่า "ไม่ต้องเปิดเบราว์เซอร์" (Claude เคยลองถ่ายภาพหน้าจอด้วย firefox แล้วค้าง 3 นาที) · สูตร 4 ข้อ 2 เทียบกับ fixture แทน `data/menu.csv` · สูตร 5 เพิ่มกฎ ".claude/settings.json ต้องเข้า git" (รอบแรกรอบหนึ่งลืม commit) · สูตร 6 ให้ commit CLAUDE.md ในข้อ 1 · ตัวตรวจ 2, 3, 6, 7 แก้ที่เข้มเกินไปจนปฏิเสธคำตอบที่ถูก (รายละเอียดใน summary ของ Hub item)

## Open feedback / known weak points
- `lesson-05` ไม่มีประวัติ git ของผู้เรียน (เก็บเฉพาะไฟล์): ตัวตรวจ 5 ส่วน `break` และ `lesson-06` ส่วน `break` จึงตกเมื่อรันบนสถานะ tag เปล่า ๆ (ตั้งใจ: ส่วนเหล่านั้นตรวจผลของ prompt ข้อ 2)
- ขั้นที่ต้องทำใน session จริง ทดสอบ headless ไม่ได้: `/rewind` (บท 3), plan mode แบบกดอนุมัติ (บท 2), `/context` `/compact` `/usage` (บท 6)
- ไม่ได้ทดสอบ: push ขึ้น GitHub จริง, `wrangler login` + deploy จริง, ติดตั้ง plugin จาก marketplace บนเครื่องที่ไม่มีสำเนา (ต้องสมัคร/ใช้เน็ตจริง; ห้ามสมัครบริการในรอบนี้)
- ทดสอบบน Linux (Station, arm64) เท่านั้น: Windows/Mac ต้องทดสอบก่อนถ่าย (DESIGN §9)
- บทที่ผลแรกช้าที่สุดคือบท 2 (median 88 วินาที, สูงสุด 121) เพราะ Claude เขียนแผนยาว ~140 บรรทัด

## 2026-10-26 (cc) — LICENSE added to all history
- Jimmy chose **Elastic License 2.0**. `LICENSE` (exact official text, `course/licenses/ELv2-official.txt`) and a README "## License" line were added to **every commit** with filter-branch. Tags lesson-NN, start-NN and main moved.
- The old refs are kept as `rr/<tag>-nolicense` and `rr/main-nolicense`. The backup bundle is `/scratch/pipeline/cc-course-backup/story-cafe-r1-before-license.bundle`.
- Verified that each new tag = the old tag + only LICENSE (93 lines) + 3 README lines. check 4/8 pass on a clean clone. check 6/7 give the same results as the old tags (see weak point below).
- **Weak point found:** on a plain clone of tag `lesson-06`, `check 6` fails 3 items (ลาเต้ส้ม row, quote 950, Thai commit), because the tag holds the curated end state, not the learner's step-2 output. On `lesson-07`, `check 7` needs `npm run build` first. Decide in round 2 whether lesson-NN must pass its own check as is.

## รอบ 2 (บท 9–16 + แก้จากรอบ 1) · job 1026-153827-540d · 26 ต.ค. 2026
**Tag ใหม่ (ยังไม่ push):** `start-09…16` / `lesson-09…16` ต่อจาก `lesson-08` ในเส้นประวัติเดียว · tag รอบ 1 ที่ถูกสร้างใหม่ (ตัวตรวจข้าม `onTag`) เก็บของเดิมไว้เป็น `rr/<tag>-r2` และ `rr/main-r2` → cc ต้อง force-update tag รอบ 1 ที่ origin **โดยตั้งใจ** (ดู summary)

| tag | คืออะไร |
|---|---|
| `start-09` / `lesson-09` | Supabase ในเครื่อง + `settings` (data/shop.json ย้ายมาเป็นตาราง) + เมนู/ตัวเลือก/วัตถุดิบ/สูตรเครื่องดื่ม + MCP read-only + บทเรียน prompt injection ในชื่อเมนู |
| `start-10` / `lesson-10` | สั่งล่วงหน้า เลือกเวลารับ: ช่อง 10 นาที 6 แก้ว บังคับที่ฐานข้อมูล + race test 8 คน |
| `start-11` / `lesson-11` | `/ship` (.claude/commands) + RLS ปิดช่อง `lookup_order` |
| `start-12` / `lesson-12` | ร้านเมล็ดกาแฟ/drip bag: products, shop_orders, `create_order` (สต็อกใน transaction), หน้า `#/shop` |
| `start-13` / `lesson-13` | PromptPay: `create_payment`, `payment_webhook` (ลายเซ็น Stripe), สลิปสำรอง · Stripe จำลอง `tools/fakes/stripe.mjs` |
| `start-14` / `lesson-14` | โค้ดบัตรสะสมแต้มของ freelancer (บั๊ก 4 จุด) · lesson-14 = อ่าน + test แดง + แก้ |
| `start-15` / `lesson-15` | LINE notify: `notify_queue` + trigger + `notify_owner` (retry key) · LINE จำลอง `tools/fakes/line.mjs` |
| `start-16` / `lesson-16` | สรุปเช้า cron 07:00 (UTC 00:00) + `line_webhook` (ลายเซ็นก่อน parse, dedupe, เจ้าของเท่านั้น) |

**กติกา tag ต้องผ่านตัวตรวจของตัวเอง:** `lib.onTag` + `skipOnTag` — ข้อที่เป็นงานของผู้เรียนเอง (เช่น commit ภาษาไทย, ประวัติ git, ไม่มี `.git`) ขึ้น "ข้าม (เป็นงานของผู้เรียน)" เมื่อ checkout tag · ทุก `lesson-00…16` ผ่าน `npm run check -- NN` บน clone ใหม่หลัง `npm ci` (+ `npm run build` ใน web/ บทที่ต้องใช้ · บท 9–16 ต้อง `npx supabase start` + `db reset` ก่อน) · ทดสอบด้วย `validation/bin/tagcheck.sh NN`
**บทเรียนจากรอบนี้:** (1) docker volume ของ Supabase ในเครื่องคงอยู่หลัง `supabase stop` → box ใหม่ที่ใช้ project id เดิมได้ฐานข้อมูลเก่า ทำให้ "ผลแรก" วัดเร็วเกินจริง (เจอที่สูตร 12) · harness ลบ volume ก่อนทุกรัน (2) `order_items.cups` เป็นจำนวนแก้วของทั้งรายการอยู่แล้ว (cup_units × qty): สรุปเช้าต้อง `sum(cups)` ไม่คูณ qty ซ้ำ (brief บท 16 เดิมเขียนกำกวม) (3) ตัวตรวจต้องไม่ฝากความหวังไว้กับข้อมูลที่ค้างในฐานข้อมูลของผู้เรียน: เคลียร์ `pickup_slots` ที่ค้างก่อนสั่งทดสอบ (บท 15) (4) Claude ลองถ่ายภาพหน้าจอ/ค้างเมื่อ prompt ยาวเกินไป → แยก prompt 1 ให้ชนะใน ≤ 3 นาที, ส่วนเขียน test ย้ายไป prompt 2 (บท 12, 16)
**ที่ยังไม่ได้ตรวจ ([ตรวจหลังสมัคร]):** Stripe จริง (PaymentIntent, QR ด้วย Stripe.js, webhook endpoint) · LINE จริง (push ถึงมือถือ, Verify webhook, โควตา) · pg_cron/Database Webhook บน Supabase จริง · หน้าเว็บ `#/shop` บนจอจริง
