// 1. กำหนดค่า URL และ Publishable Key ของคุณ
const supabaseUrl = 'https://bfpdywqsovagjtifugov.supabase.co';
const supabaseKey = 'sb_publishable_0HxSBco0tyCwh-ulB8H53Q_e-nvymr3';

// 2. สร้าง Supabase Client
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 3. ฟังก์ชันสำหรับดึงข้อมูลสมาชิกตระกูลจากตาราง profiles
async function getFamilyMembers() {
    const statusElement = document.getElementById('connection-status');
    const containerElement = document.getElementById('members-container');

    try {
        // ลองดึงข้อมูลทั้งหมดจากตาราง 'profiles'
        const { data, error } = await supabase
            .from('profiles')
            .select('*');

        // ถ้ามี Error จาก Supabase ให้โยนเข้า Catch
        if (error) throw error;

        // อัปเดตสถานะเมื่อเชื่อมต่อสำเร็จ
        statusElement.innerHTML = '<span class="success">เชื่อมต่อสำเร็จ! ✅</span>';

        // ตรวจสอบว่ามีข้อมูลหรือไม่
        if (data && data.length > 0) {
            // วนลูปสร้าง HTML สำหรับแสดงผลแต่ละบุคคล
            const htmlContent = data.map(member => `
                <div class="member-card">
                    <h3>${member.first_name || 'ไม่ระบุชื่อ'} ${member.last_name || ''}</h3>
                    <p><strong>เพศ:</strong> ${member.gender || '-'}</p>
                    <p><strong>วันเกิด:</strong> ${member.birth_date || 'ไม่ระบุ'}</p>
                </div>
            `).join('');
            
            containerElement.innerHTML = htmlContent;
        } else {
            // กรณีเชื่อมต่อได้ แต่ยังไม่มีข้อมูลในตาราง
            containerElement.innerHTML = `
                <div class="member-card" style="text-align: center; color: #6b7280;">
                    ยังไม่มีข้อมูลสมาชิกในระบบ <br>
                    (ตาราง <code>profiles</code> เชื่อมต่อได้แล้ว แต่ยังว่างเปล่าอยู่ครับ)
                </div>`;
        }

    } catch (error) {
        console.error('พบข้อผิดพลาด:', error.message);
        // อัปเดตสถานะเมื่อเชื่อมต่อล้มเหลว
        statusElement.innerHTML = `<span class="error">เชื่อมต่อล้มเหลว ❌ (${error.message})</span>`;
        containerElement.innerHTML = '<p style="color: red;">โปรดตรวจสอบชื่อตาราง (profiles) หรือนโยบาย RLS ใน Supabase อีกครั้ง</p>';
    }
}

// 4. สั่งให้ฟังก์ชันทำงานทันทีที่โหลดหน้าเว็บเสร็จ
document.addEventListener('DOMContentLoaded', getFamilyMembers);
