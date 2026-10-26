# รีวิว plugin `frontend-design`

ตรวจเมื่อ 2026-10-26 จากไฟล์ในเครื่อง (ไม่ได้ตรวจกับต้นทางบน GitHub)

## ข้อมูลทั่วไป
- ที่มา: marketplace `claude-plugins-official` (repo `anthropics/claude-plugins-official`)
- ผู้เขียนใน `plugin.json`: Anthropic · commit `ea10b213686c90bb1984b2016937310e05336cf3`
- ติดตั้งระดับ user เมื่อ 2026-10-16
- ที่อยู่ไฟล์: `~/.claude/plugins/cache/claude-plugins-official/frontend-design/ea10b213686c/`

## มันทำอะไร
เป็นชุดคำแนะนำให้ Claude ออกแบบหน้าเว็บให้มีเอกลักษณ์ ไม่ซ้ำแบบ template ทั่วไป (เลือกสี ฟอนต์ เลย์เอาต์ วางแผนก่อนเขียนโค้ด) ตอนที่เรียกใช้ skill ข้อความใน `SKILL.md` จะถูกโหลดเข้าบทสนทนาเป็นคำสั่งให้ Claude ทำตาม ตัว plugin เองไม่ได้รันโค้ด

## ข้างในมีอะไรบ้าง
| ประเภท | ผลที่พบ |
|---|---|
| Skills | 1 ตัว: `skills/frontend-design/SKILL.md` (ไฟล์ markdown ล้วน) |
| Hooks | ไม่มี (ไม่มีโฟลเดอร์ `hooks/` และ `plugin.json` ไม่ประกาศ) |
| MCP server | ไม่มี (ไม่มี `.mcp.json`) |
| Agents / commands | ไม่มี |
| สคริปต์ที่รันอัตโนมัติ | ไม่มี ไม่พบไฟล์ `.sh` `.js` `.py` หรือไฟล์ที่รันได้เลย |

ไฟล์ทั้งหมดมี 5 ไฟล์ ได้แก่ `LICENSE`, `README.md`, `.claude-plugin/plugin.json`, `skills/frontend-design/SKILL.md`, `skills/frontend-design/LICENSE.txt` (โฟลเดอร์ `.in_use/` เป็นตัวนับ session ที่ Claude Code สร้างเอง ไม่ใช่ของ plugin) ค้นหาคำว่า hook, mcp, curl, wget, eval, exec, bash พบแค่ตัวอย่างในข้อความและลิงก์ license/cookbook

## สิทธิ์ที่ขอ
- `SKILL.md` ไม่มี `allowed-tools` จึงไม่ขอสิทธิ์เพิ่มและไม่ข้ามระบบถามสิทธิ์ของ Claude Code
- ไม่ประกาศการเข้าถึงเครือข่าย ไฟล์ หรือ environment variable
- สิ่งที่ทำได้จริงคือ "ชี้นำ Claude" เท่านั้น งานที่ Claude ลงมือต่อ (เขียนไฟล์ รัน build) ยังผ่านระบบสิทธิ์ปกติของ Claude Code

## สรุป
**ปลอดภัยพอสำหรับใช้งานต่อ** เพราะ
1. ไม่มี hooks, MCP server หรือสคริปต์ จึงไม่มีโค้ดที่รันเองโดยไม่ผ่านการอนุมัติ
2. เนื้อหาเป็นข้อความคำแนะนำด้านดีไซน์ล้วน อ่านทั้งไฟล์แล้วไม่พบคำสั่งให้ส่งข้อมูลออก อ่านความลับ หรือข้ามกฎของโปรเจกต์
3. มาจาก marketplace ทางการของ Anthropic และใช้ commit ที่ระบุตายตัว

**ข้อจำกัด**
- ตรวจเฉพาะ commit นี้ ถ้า plugin อัปเดต ต้องตรวจใหม่
- ไม่ได้เทียบไฟล์กับ repo ต้นทางว่าตรงกันหรือไม่
- ความเสี่ยงที่เหลือคือ skill เป็นข้อความที่ชี้นำพฤติกรรมของ Claude ได้ (เช่น ทำให้เลือกดีไซน์ต่างจาก brief) จึงควรตรวจผลงานเสมอ
- ไม่ได้ตรวจ plugin อื่นที่ติดตั้งอยู่ (`example-skills@anthropic-agent-skills`)

## ก่อนติดตั้ง plugin อื่น
เช็กลิสต์เดียวกัน: มีโฟลเดอร์ `hooks/` หรือไม่, มี `.mcp.json` หรือไม่, มีไฟล์สคริปต์หรือไม่, `SKILL.md` ขอ `allowed-tools` อะไร และใครเป็นผู้เผยแพร่
