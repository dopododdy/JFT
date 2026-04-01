/**
 * Juangphonngam Family Tree (JFT) - Database Connection
 * ไฟล์เชื่อมต่อ Supabase สำหรับโปรเจกต์ตระกูลจวงพลงาม
 */

// 1. ตั้งค่า Configuration (URL และ Public Key ของคุณ)
const SUPABASE_URL = 'https://bfpdywqsovagjtifugov.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0HxSBco0tyCwh-ulB8H53Q_e-nvymr3';

// 2. สร้าง Supabase Client
// หมายเหตุ: ใช้ชื่อตัวแปร _supabase เพื่อไม่ให้ชนกับตัวแปรกลางของ Library ที่โหลดจาก CDN
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * ฟังก์ชันสำหรับดึงข้อมูลสมาชิกทั้งหมดจากตาราง profiles
 */
async function fetchFamilyMembers() {
    const statusEl = document.getElementById('connection-status');
    const containerEl = document.getElementById('members-container');

    // ตรวจสอบว่ามี Element ในหน้า HTML หรือไม่
    if (!statusEl || !containerEl) return;

    try {
        // ดึงข้อมูลจาก Supabase โดยเรียงตามวันเกิด (จากผู้ใหญ่ไปหาเด็ก)
        const { data, error } = await _supabase
            .from('profiles')
            .select('*')
            .order('birth_date', { ascending: true });

        if (error) throw error;

        // แสดงสถานะสำเร็จ
        statusEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;">เชื่อมต่อข้อมูลสำเร็จ ✅</span>';

        if (data && data.length > 0) {
            // สร้าง HTML สำหรับการ์ดสมาชิกแต่ละคน
            const cardsHtml = data.map(member => {
                const fullName = `${member.first_name} ${member.last_name || ''}`.trim();
                const genderIcon = member.gender === 'ชาย' ? '👨' : (member.gender === 'หญิง' ? '👩' : '👤');
                
                return `
                    <div class="member-card" style="
                        background: white; 
                        padding: 20px; 
                        border-radius: 12px; 
                        margin-bottom: 15px; 
                        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
                        border-left: 5px solid #2563eb;
                    ">
                        <h3 style="margin: 0 0 10px 0; color: #1e293b;">
                            ${genderIcon} ${fullName}
                        </h3>
                        <div style="font-size: 0.95rem; color: #475569; line-height: 1.6;">
                            <div><strong>เพศ:</strong> ${member.gender || 'ไม่ระบุ'}</div>
                            <div><strong>วันเกิด:</strong> ${formatThaiDate(member.birth_date)}</div>
                            ${member.bio ? `<div style="margin-top:8px; font-style:italic;">"${member.bio}"</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            containerEl.innerHTML = cardsHtml;
        } else {
            // กรณีเชื่อมต่อได้แต่ไม่มีข้อมูล
            containerEl.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #94a3b8; border: 2px dashed #e2e8f0; border-radius: 12px;">
                    <p>ยังไม่พบข้อมูลสมาชิกในตระกูล</p>
                    <small>กรุณาเพิ่มข้อมูลในตาราง profiles ผ่าน Supabase Dashboard</small>
                </div>`;
        }

    } catch (err) {
        console.error('Connection Error:', err.message);
        statusEl.innerHTML = '<span style="color: #dc2626; font-weight: bold;">การเชื่อมต่อผิดพลาด ❌</span>';
        containerEl.innerHTML = `
            <div style="background: #fef2f2; color: #991b1b; padding: 20px; border-radius: 8px; border: 1px solid #fecaca;">
                <strong>เกิดข้อผิดพลาด:</strong> ${err.message}
            </div>`;
    }
}

/**
 * ฟังก์ชันแปลงวันที่เป็นรูปแบบไทย (เช่น 1 เมษายน 2569)
 */
function formatThaiDate(dateStr) {
    if (!dateStr) return 'ไม่ระบุ';
    const date = new Date(dateStr);
    return date.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// รันฟังก์ชันเมื่อโหลดหน้าเว็บสำเร็จ
document.addEventListener('DOMContentLoaded', fetchFamilyMembers);
