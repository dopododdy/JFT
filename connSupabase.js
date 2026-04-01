/**
 * แผนผังครอบครัวจวงพลงาม (JFT) - การเชื่อมต่อฐานข้อมูล
 * ไฟล์เชื่อมต่อ Supabase สำหรับโปรเจกต์ตระกูลจวงพลงาม
 */

// ตั้งค่า Supabase
const SUPABASE_URL = 'https://bfpdywqsovagjtifugov.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0HxSBco0tyCwh-ulB8H53Q_e-nvymr3';

// สร้าง Supabase Client (ใช้ชื่อ _supabase เพื่อไม่ชนกับตัวแปรของ Library)
const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// เก็บข้อมูลสมาชิกทั้งหมดไว้ใช้งานร่วมกัน
window._familyMembers = [];

/**
 * ป้องกัน XSS ด้วยการ Escape อักขระพิเศษใน HTML
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * แปลงวันที่เป็นรูปแบบไทย (เช่น 1 เมษายน 2569)
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

/**
 * คำนวณอายุจากวันเกิด
 */
function calcAge(birthDateStr) {
    if (!birthDateStr) return null;
    const birth = new Date(birthDateStr);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age > 0 ? age : null;
}

/**
 * ดึงข้อมูลสมาชิกทั้งหมดจากตาราง profiles
 */
async function fetchFamilyMembers() {
    const statusEl   = document.getElementById('connection-status');
    const containerEl = document.getElementById('members-container');
    if (!statusEl || !containerEl) return;

    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('*')
            .order('birth_date', { ascending: true });

        if (error) throw error;

        statusEl.innerHTML = '<span style="color:#16a34a;font-weight:bold;">เชื่อมต่อสำเร็จ ✅</span>';

        window._familyMembers = data || [];
        const countEl = document.getElementById('member-count');
        if (countEl) countEl.textContent = window._familyMembers.length > 0 ? window._familyMembers.length + ' คน' : '';

        renderMemberCards(window._familyMembers);
        populateParentDropdown(window._familyMembers);

        // อัปเดตแผนผังถ้ากำลังแสดงอยู่
        const treeView = document.getElementById('tree-view');
        if (treeView && treeView.style.display !== 'none') {
            renderFamilyTree(window._familyMembers);
        }

    } catch (err) {
        console.error('ข้อผิดพลาด:', err.message);
        statusEl.innerHTML = '<span style="color:#dc2626;font-weight:bold;">การเชื่อมต่อผิดพลาด ❌</span>';
        containerEl.innerHTML = `
            <div class="state-placeholder" style="border-color:#fecaca;">
                <div style="font-size:2rem;">❌</div>
                <p style="color:#991b1b;font-weight:600;">เกิดข้อผิดพลาด</p>
                <small style="color:#b91c1c;">${escapeHtml(err.message)}</small>
            </div>`;
    }
}

/**
 * แสดงการ์ดสมาชิกในมุมมองตาราง
 */
function renderMemberCards(members) {
    const containerEl = document.getElementById('members-container');
    if (!containerEl) return;

    if (!members || members.length === 0) {
        containerEl.innerHTML = `
            <div class="state-placeholder">
                <div style="font-size:2.5rem;">🌱</div>
                <p>ยังไม่พบข้อมูลสมาชิกในตระกูล</p>
                <small>กดปุ่ม <strong>เพิ่มสมาชิก</strong> เพื่อเริ่มต้นสร้างแผนผังครอบครัว</small>
            </div>`;
        return;
    }

    containerEl.innerHTML = members.map(member => {
        const fullName    = `${member.first_name} ${member.last_name || ''}`.trim();
        const genderIcon  = member.gender === 'ชาย' ? '👨' : (member.gender === 'หญิง' ? '👩' : '👤');
        const accentColor = member.gender === 'ชาย' ? '#2563eb' : (member.gender === 'หญิง' ? '#db2777' : '#059669');

        let parentText = '';
        if (member.parent_id) {
            const parent = window._familyMembers.find(m => m.id === member.parent_id);
            if (parent) {
                const parentName = `${parent.first_name} ${parent.last_name || ''}`.trim();
                parentText = `<div><strong>ผู้ปกครอง:</strong> ${escapeHtml(parentName)}</div>`;
            }
        }

        return `
            <div class="member-card" data-name="${escapeHtml(fullName.toLowerCase())}" style="border-left-color:${accentColor};">
                <h3 class="member-card-name">${genderIcon} ${escapeHtml(fullName)}</h3>
                <div class="member-card-info">
                    <div><strong>เพศ:</strong> ${escapeHtml(member.gender) || 'ไม่ระบุ'}</div>
                    <div><strong>วันเกิด:</strong> ${formatThaiDate(member.birth_date)}</div>
                    ${parentText}
                    ${member.bio ? `<div class="member-bio">"${escapeHtml(member.bio)}"</div>` : ''}
                </div>
            </div>`;
    }).join('');
}

/**
 * เติมตัวเลือกผู้ปกครองในฟอร์มเพิ่มสมาชิก
 */
function populateParentDropdown(members) {
    const select = document.getElementById('f-parent');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="">— ไม่มีผู้ปกครอง (รุ่นแรก) —</option>';
    (members || []).forEach(m => {
        const name = `${m.first_name} ${m.last_name || ''}`.trim();
        const opt  = document.createElement('option');
        opt.value       = m.id;
        opt.textContent = name;
        if (m.id === currentValue) opt.selected = true;
        select.appendChild(opt);
    });
}

/**
 * แสดงแผนผังครอบครัวแบบ SVG พร้อมเส้นโยงความสัมพันธ์
 */
function renderFamilyTree(members) {
    const container = document.getElementById('tree-view-container');
    if (!container) return;

    if (!members || members.length === 0) {
        container.innerHTML = `
            <div class="state-placeholder">
                <div style="font-size:2.5rem">🌳</div>
                <p>ยังไม่มีข้อมูลสมาชิก</p>
            </div>`;
        return;
    }

    const NODE_W = 150;
    const NODE_H = 68;
    const H_GAP  = 24;
    const V_GAP  = 64;
    const PAD    = 24;

    // สร้าง map และกำหนดลูก ๆ ให้แต่ละโหนด
    const byId = {};
    members.forEach(m => { byId[m.id] = { ...m, _children: [] }; });

    const roots = [];
    members.forEach(m => {
        if (m.parent_id && byId[m.parent_id]) {
            byId[m.parent_id]._children.push(byId[m.id]);
        } else {
            roots.push(byId[m.id]);
        }
    });

    // เรียงลูกตามวันเกิด
    function sortChildren(node) {
        node._children.sort((a, b) => (a.birth_date || '').localeCompare(b.birth_date || ''));
        node._children.forEach(sortChildren);
    }
    roots.forEach(sortChildren);

    // คำนวณความกว้างของ subtree แต่ละโหนด
    function calcWidth(node) {
        if (node._children.length === 0) {
            node._subtreeW = NODE_W;
            return NODE_W;
        }
        const childW = node._children.reduce((s, c) => s + calcWidth(c), 0)
                     + (node._children.length - 1) * H_GAP;
        node._subtreeW = Math.max(NODE_W, childW);
        return node._subtreeW;
    }
    roots.forEach(calcWidth);

    // กำหนดตำแหน่ง x, y ให้แต่ละโหนด
    const positions = {};
    function assignPos(node, x, y) {
        if (node._children.length === 0) {
            positions[node.id] = { x, y };
        } else {
            const childTotalW = node._children.reduce((s, c) => s + c._subtreeW, 0)
                              + (node._children.length - 1) * H_GAP;
            positions[node.id] = { x: x + (node._subtreeW - NODE_W) / 2, y };
            let cx = x + (node._subtreeW - childTotalW) / 2;
            node._children.forEach(child => {
                assignPos(child, cx, y + NODE_H + V_GAP);
                cx += child._subtreeW + H_GAP;
            });
        }
    }
    let rx = 0;
    roots.forEach(root => {
        assignPos(root, rx, 0);
        rx += root._subtreeW + H_GAP;
    });

    // ขนาด canvas
    let maxX = 0, maxY = 0;
    Object.values(positions).forEach(p => {
        maxX = Math.max(maxX, p.x + NODE_W);
        maxY = Math.max(maxY, p.y + NODE_H);
    });
    const canvasW = maxX + PAD * 2;
    const canvasH = maxY + PAD * 2;

    // สร้างเส้นโยง SVG (Cubic Bézier)
    const lines = [];
    members.forEach(m => {
        if (!m.parent_id || !positions[m.id] || !positions[m.parent_id]) return;
        const pp  = positions[m.parent_id];
        const cp  = positions[m.id];
        const x1  = pp.x + NODE_W / 2 + PAD;
        const y1  = pp.y + NODE_H + PAD;
        const x2  = cp.x + NODE_W / 2 + PAD;
        const y2  = cp.y + PAD;
        const mid = (y1 + y2) / 2;
        lines.push(
            `<path d="M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}"` +
            ` stroke="#059669" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-opacity="0.75"/>`
        );
    });

    // สร้างโหนดสมาชิก
    const nodesHtml = members.map(m => {
        if (!positions[m.id]) return '';
        const pos         = positions[m.id];
        const fullName    = `${m.first_name} ${m.last_name || ''}`.trim();
        const genderIcon  = m.gender === 'ชาย' ? '👨' : (m.gender === 'หญิง' ? '👩' : '👤');
        const accentColor = m.gender === 'ชาย' ? '#2563eb' : (m.gender === 'หญิง' ? '#db2777' : '#059669');
        const age         = calcAge(m.birth_date);
        const subText     = age ? `อายุ ${age} ปี` : (m.birth_date ? formatThaiDate(m.birth_date) : '');

        return `<div class="tree-node" style="left:${pos.x + PAD}px;top:${pos.y + PAD}px;border-left-color:${accentColor};">
            <div class="tree-node-name">${genderIcon} ${escapeHtml(fullName)}</div>
            ${subText ? `<div class="tree-node-sub">${escapeHtml(subText)}</div>` : ''}
        </div>`;
    }).join('');

    const hasRelations = members.some(m => m.parent_id && positions[m.parent_id]);

    container.innerHTML = `
        <div class="tree-scroll-wrap">
            <div class="tree-canvas" style="width:${canvasW}px;height:${canvasH}px;">
                <svg style="position:absolute;top:0;left:0;" width="${canvasW}" height="${canvasH}">
                    <defs>
                        <filter id="line-glow">
                            <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#059669" flood-opacity="0.2"/>
                        </filter>
                    </defs>
                    <g filter="url(#line-glow)">${lines.join('')}</g>
                </svg>
                ${nodesHtml}
            </div>
        </div>
        ${!hasRelations ? `<div class="tree-hint">💡 ระบุ "ผู้ปกครอง" ตอนเพิ่มสมาชิกเพื่อสร้างเส้นเชื่อมความสัมพันธ์</div>` : ''}
    `;
}

/**
 * ตรวจสอบว่ามี session อยู่แล้วหรือไม่ ถ้าไม่มีให้ sign-in แบบ anonymous
 * เพื่อให้ auth.uid() ไม่เป็น null ก่อน insert ข้อมูลลงตาราง
 * หากโปรเจกต์ไม่ได้เปิด Anonymous Sign-in จะใช้ anon key แทนโดยไม่หยุดการทำงาน
 */
async function ensureSignedIn() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        const { error } = await _supabase.auth.signInAnonymously();
        if (error) {
            // Anonymous sign-in อาจไม่ได้เปิดใช้งานในโปรเจกต์ Supabase
            // บันทึก warning และดำเนินการต่อโดยใช้ anon key แทน
            console.warn(`Anonymous sign-in ไม่พร้อมใช้งาน (${error.message}) — ดำเนินการต่อด้วย anon key`);
        }
    }
}

// โหลดข้อมูลเมื่อเปิดหน้าเว็บ
document.addEventListener('DOMContentLoaded', fetchFamilyMembers);
