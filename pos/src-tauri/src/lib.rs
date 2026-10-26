// POS หน้าร้านของ Story Cafe: เปลือก Tauri บาง ๆ — หน้าจอและการคิดเงินอยู่ฝั่ง TypeScript (src/)
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("เปิดหน้าต่าง POS ไม่ได้");
}
