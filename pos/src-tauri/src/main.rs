// ไม่เปิดหน้าต่าง console เพิ่มบน Windows ตอน release — อย่าลบ
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    story_cafe_pos_lib::run();
}
