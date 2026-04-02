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
// เก็บข้อมูลความสัมพันธ์ทั้งหมด (จากตาราง relationships)
window._relationships = [];

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
 * ดึงข้อมูลความสัมพันธ์จากตาราง relationships (ถ้ามี)
 */
async function fetchRelationships() {
    try {
        const { data, error } = await _supabase
            .from('relationships')
            .select('*');
        if (error) throw error;
        window._relationships = data || [];
    } catch (err) {
        console.warn('ไม่สามารถดึงข้อมูลความสัมพันธ์ (อาจต้องสร้างตาราง relationships):', err.message);
        window._relationships = [];
    }
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
        await fetchRelationships();

        const countEl = document.getElementById('member-count');
        if (countEl) countEl.textContent = window._familyMembers.length > 0 ? window._familyMembers.length + ' คน' : '';

        renderMemberCards(window._familyMembers);
        populateParentDropdowns(window._familyMembers);

        // อัปเดต identity bar (ถ้ามีฟังก์ชัน)
        if (typeof updateIdentityBar === 'function') updateIdentityBar();

        // อัปเดตแผนผังเครือญาติถ้ากำลังแสดงอยู่
        const panelTree = document.getElementById('tab-panel-tree');
        if (panelTree && panelTree.style.display !== 'none') renderFamilyTree();

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
 * ลบสมาชิกออกจากฐานข้อมูล
 */
async function deleteMember(memberId, evt) {
    if (evt) evt.stopPropagation();
    const member = window._familyMembers.find(m => m.id === memberId);
    const name = member ? [member.prefix, member.first_name, member.last_name].filter(Boolean).join(' ') : 'สมาชิกนี้';
    if (!confirm(`ต้องการลบ "${name}" ออกจากระบบหรือไม่?\n(ข้อมูลที่ลบแล้วไม่สามารถกู้คืนได้)`)) return;
    try {
        await ensureSignedIn();
        const { error } = await _supabase.from('profiles').delete().eq('id', memberId);
        if (error) throw error;
        showToast('✅ ลบสมาชิกสำเร็จ');
        await fetchFamilyMembers();
    } catch (err) {
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message, true);
    }
}

/**
 * บันทึกความสัมพันธ์ระหว่างสมาชิก
 */
async function saveRelationship(fromId, toId, relationType) {
    try {
        await ensureSignedIn();

        if (relationType === 'พ่อ' || relationType === 'แม่') {
            // ลบความสัมพันธ์เดิม (ถ้ามี) แล้วบันทึกในตาราง relationships
            await _supabase.from('relationships').delete().match({ from_id: fromId, relation: relationType });
            const { error } = await _supabase
                .from('relationships')
                .insert([{ from_id: fromId, to_id: toId, relation: relationType }]);
            if (error) throw error;
        } else if (relationType === 'ลูก') {
            // ตั้งค่า parent_id ของสมาชิกเป้าหมาย
            const { error } = await _supabase
                .from('profiles')
                .update({ parent_id: fromId })
                .eq('id', toId);
            if (error) throw error;
        } else {
            // พี่ น้อง สามี/ภรรยา — บันทึกลงตาราง relationships
            const { error } = await _supabase
                .from('relationships')
                .insert([{ from_id: fromId, to_id: toId, relation: relationType }]);
            if (error) throw error;
        }

        showToast('✅ บันทึกความสัมพันธ์สำเร็จ');
        await fetchFamilyMembers();
    } catch (err) {
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message, true);
    }
}

/**
 * ลบความสัมพันธ์
 */
async function deleteRelationship(relationId) {
    try {
        await ensureSignedIn();
        const { error } = await _supabase
            .from('relationships')
            .delete()
            .eq('id', relationId);
        if (error) throw error;
        showToast('✅ ลบความสัมพันธ์สำเร็จ');
        await fetchFamilyMembers();
    } catch (err) {
        showToast('❌ เกิดข้อผิดพลาด: ' + err.message, true);
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

    const identityId = window._identityId || null;

    // สร้าง lookup map สำหรับ relationships เพื่อประสิทธิภาพในการแสดงผล
    const relsByMember = {};
    (window._relationships || []).forEach(r => {
        if (!relsByMember[r.from_id]) relsByMember[r.from_id] = [];
        if (!relsByMember[r.to_id])   relsByMember[r.to_id]   = [];
        relsByMember[r.from_id].push(r);
        relsByMember[r.to_id].push(r);
    });

    // สร้าง lookup map สำหรับสมาชิก
    const memberById = {};
    members.forEach(m => { memberById[m.id] = m; });

    containerEl.innerHTML = members.map(member => {
        const fullName    = [member.first_name, member.last_name].filter(Boolean).join(' ');
        const displayName = fullName + (member.nickname ? ` (${member.nickname})` : '');
        const searchName  = `${member.first_name} ${member.last_name || ''}`.trim();
        const accentColor = member.gender === 'ชาย' ? '#2563eb' : (member.gender === 'หญิง' ? '#db2777' : '#059669');

        // ชื่อเดิม-นามสกุลเดิม
        const formerName = [member.former_first_name, member.former_last_name].filter(Boolean).join(' ');

        // สถานะมีชีวิต/เสียชีวิต
        const isAlive = member.is_alive !== false;
        const aliveText = isAlive
            ? '🟢 มีชีวิต'
            : `⚫ เสียชีวิต${member.death_date ? ' เมื่อวันที่ ' + formatThaiDate(member.death_date) : ''}`;

        // สีพื้นหลังตามเพศ (ฟ้าอ่อน=ชาย, ชมพูอ่อน=หญิง)
        const cardBgColor = member.gender === 'ชาย'
            ? (isAlive ? '#eff6ff' : '#dce8f5')
            : member.gender === 'หญิง'
            ? (isAlive ? '#fdf2f8' : '#eedbe8')
            : (isAlive ? '#ffffff' : '#e5e7eb');

        // อายุ (แสดงเฉพาะกรณีมีชีวิตและมีวันเกิด)
        const age = (isAlive && member.birth_date) ? calcAge(member.birth_date) : null;

        // พ่อและแม่ (จากตาราง relationships)
        let parentText = '';
        const memberRels = relsByMember[member.id] || [];
        const fatherRel = memberRels.find(r => r.from_id === member.id && r.relation === 'พ่อ');
        const motherRel = memberRels.find(r => r.from_id === member.id && r.relation === 'แม่');
        if (fatherRel) {
            const father = memberById[fatherRel.to_id];
            if (father) {
                const fName = [father.prefix, father.first_name, father.last_name].filter(Boolean).join(' ');
                parentText += `<div><strong>พ่อ:</strong> ${escapeHtml(fName)}</div>`;
            }
        }
        if (motherRel) {
            const mother = memberById[motherRel.to_id];
            if (mother) {
                const mName = [mother.prefix, mother.first_name, mother.last_name].filter(Boolean).join(' ');
                parentText += `<div><strong>แม่:</strong> ${escapeHtml(mName)}</div>`;
            }
        }
        // backward compat: แสดง parent_id ถ้ายังไม่มีข้อมูลพ่อ/แม่จาก relationships
        if (!fatherRel && !motherRel && member.parent_id) {
            const parent = memberById[member.parent_id];
            if (parent) {
                const parentName = [parent.prefix, parent.first_name, parent.last_name].filter(Boolean).join(' ');
                parentText = `<div><strong>ผู้ปกครอง:</strong> ${escapeHtml(parentName)}</div>`;
            }
        }

        // แสดงความสัมพันธ์เพิ่มเติม (จากตาราง relationships)
        const relTags = memberRels
            .map(r => {
                const isFrom = r.from_id === member.id;
                const otherId = isFrom ? r.to_id : r.from_id;
                const other = memberById[otherId];
                if (!other) return '';
                const otherName = [other.prefix, other.first_name, other.last_name].filter(Boolean).join(' ');
                const label = isFrom ? r.relation : _reverseRelation(r.relation);
                return `<span class="rel-tag">${escapeHtml(label)}: ${escapeHtml(otherName)}</span>`;
            })
            .filter(Boolean)
            .join('');

        // ป้ายแสดงความสัมพันธ์กับตัวตน
        let kinshipHtml = '';
        if (identityId && identityId !== member.id) {
            const k = computeKinship(identityId, member.id);
            if (k) kinshipHtml = `<div class="kinship-label">${escapeHtml(k)}</div>`;
        } else if (identityId && identityId === member.id) {
            kinshipHtml = '<div class="kinship-label kinship-self">👤 ตัวเอง</div>';
        }

        // รูปภาพ (แสดงด้านขวา)
        const photoHtml = member.photo_url
            ? `<img src="${escapeHtml(member.photo_url)}" class="member-photo-right" alt="รูป" onerror="this.style.display='none'">`
            : `<div class="member-photo-placeholder-right">👤</div>`;

        return `
            <div class="member-card${isAlive ? '' : ' deceased'}" data-id="${escapeHtml(member.id)}" data-name="${escapeHtml(searchName.toLowerCase())}" style="border-left-color:${accentColor};background-color:${cardBgColor};">
                <div class="member-card-header">
                    <div class="member-card-title">
                        <h3 class="member-card-name">${escapeHtml(displayName)}</h3>
                        ${kinshipHtml}
                    </div>
                    ${photoHtml}
                </div>
                <div class="member-card-info">
                    ${formerName ? `<div><strong>ชื่อเดิม:</strong> ${escapeHtml(formerName)}</div>` : ''}
                    ${member.marital_status ? `<div><strong>สถานะสมรส:</strong> ${escapeHtml(member.marital_status)}</div>` : ''}
                    <div><strong>เพศ:</strong> ${escapeHtml(member.gender) || 'ไม่ระบุ'}</div>
                    ${member.birth_date ? `<div><strong>วันเกิด:</strong> ${formatThaiDate(member.birth_date)}</div>` : ''}
                    <div><strong>สถานะ:</strong> ${aliveText}</div>
                    ${age ? `<div><strong>อายุ:</strong> ${age} ปี</div>` : ''}
                    ${member.phone ? `<div><strong>เบอร์โทร:</strong> ${escapeHtml(member.phone)}</div>` : ''}
                    ${member.workplace ? `<div><strong>สถานที่ทำงาน:</strong> ${escapeHtml(member.workplace)}</div>` : ''}
                    ${member.address ? `<div><strong>ที่อยู่:</strong> ${escapeHtml(member.address)}</div>` : ''}
                    ${member.line_id ? `<div><strong>ไลน์:</strong> ${escapeHtml(member.line_id)}</div>` : ''}
                    ${parentText}
                    ${relTags ? `<div class="rel-tags-wrap">${relTags}</div>` : ''}
                    ${member.bio ? `<div class="member-bio">"${escapeHtml(member.bio)}"</div>` : ''}
                </div>
                <div class="member-card-footer">
                    <span class="card-hint">🔗 คลิกเพื่อจัดการความสัมพันธ์</span>
                    <div class="card-btn-group">
                        <button class="btn-card-edit" data-member-id="${escapeHtml(member.id)}" title="แก้ไขสมาชิก">✏️ แก้ไข</button>
                        <button class="btn-card-delete" data-member-id="${escapeHtml(member.id)}" title="ลบสมาชิก">🗑️ ลบ</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

/**
 * แปลงความสัมพันธ์เป็นมุมมองของอีกฝ่าย
 */
function _reverseRelation(relation) {
    const map = {
        'พ่อ': 'ลูก', 'แม่': 'ลูก', 'ลูก': 'พ่อ/แม่',
        'พี่': 'น้อง', 'น้อง': 'พี่',
        'สามี/ภรรยา': 'สามี/ภรรยา',
        'สามี': 'ภรรยา', 'ภรรยา': 'สามี',
    };
    return map[relation] || relation;
}

/**
 * ย่อรูปภาพด้วย Canvas แล้วแปลงเป็น data URL (JPEG, max 400px, quality 0.82)
 * ใช้เป็น fallback เมื่อ Supabase Storage upload ไม่สำเร็จ
 */
function resizeImageToDataUrl(file, maxDim = 400, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const blobUrl = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(blobUrl);
            const maxSide = Math.max(img.width, img.height);
            const scale = (maxSide > 0) ? Math.min(1, maxDim / maxSide) : 1;
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round((img.width  || maxDim) * scale);
            canvas.height = Math.round((img.height || maxDim) * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('โหลดรูปภาพไม่สำเร็จ')); };
        img.src = blobUrl;
    });
}

/**
 * อัปโหลดรูปภาพสมาชิกไปยัง Supabase Storage (bucket: avatars)
 * หากการอัปโหลดไม่สำเร็จ จะใช้ data URL ที่ย่อขนาดแล้วแทน
 */
async function uploadMemberPhoto(file) {
    await ensureSignedIn();

    const parts  = file.name.split('.');
    const rawExt = parts.length > 1 ? parts.pop().toLowerCase() : '';
    const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(rawExt) ? rawExt : 'jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${safeExt}`;
    const contentType = file.type || 'image/jpeg';

    const { error } = await _supabase.storage
        .from('avatars')
        .upload(fileName, file, { contentType, upsert: true, cacheControl: '3600' });

    if (!error) {
        const { data: urlData } = _supabase.storage.from('avatars').getPublicUrl(fileName);
        if (urlData?.publicUrl) return urlData.publicUrl;
    }

    // Fallback: ย่อรูปและเก็บเป็น data URL ในฐานข้อมูลโดยตรง
    console.warn('Supabase Storage upload ไม่สำเร็จ — ใช้ data URL แทน:', error?.message);
    return await resizeImageToDataUrl(file);
}

/**
 * อัปเดตข้อมูลสมาชิกในฐานข้อมูล
 */
async function updateMember(memberId, payload) {
    await ensureSignedIn();
    const { error } = await _supabase.from('profiles').update(payload).eq('id', memberId);
    if (error) throw error;
    showToast('✅ แก้ไขข้อมูลสำเร็จ!');
    await fetchFamilyMembers();
}

/**
 * คำนวณความสัมพันธ์ (ภาษาไทย) ระหว่างตัวตน (identityId) กับบุคคลเป้าหมาย (targetId)
 * โดยใช้ BFS ผ่านกราฟความสัมพันธ์ในครอบครัว
 */
function computeKinship(identityId, targetId) {
    const members      = window._familyMembers  || [];
    const relationships = window._relationships || [];

    if (identityId === targetId) return '(ตัวเอง)';

    const byId = {};
    members.forEach(m => { byId[m.id] = m; });

    if (!byId[identityId] || !byId[targetId]) return null;

    // สร้าง adjacency graph
    const graph = {};
    members.forEach(m => { graph[m.id] = []; });

    members.forEach(m => {
        if (m.parent_id && graph[m.parent_id] !== undefined) {
            graph[m.id].push({ id: m.parent_id, dir: 'up' });
            graph[m.parent_id].push({ id: m.id, dir: 'down' });
        }
    });

    relationships.forEach(r => {
        if ((r.relation === 'พ่อ' || r.relation === 'แม่') && graph[r.from_id] !== undefined && graph[r.to_id] !== undefined) {
            // from_id คือลูก, to_id คือพ่อหรือแม่
            if (!graph[r.from_id].some(e => e.id === r.to_id && e.dir === 'up')) {
                graph[r.from_id].push({ id: r.to_id, dir: 'up' });
            }
            if (!graph[r.to_id].some(e => e.id === r.from_id && e.dir === 'down')) {
                graph[r.to_id].push({ id: r.from_id, dir: 'down' });
            }
        }
    });

    relationships.forEach(r => {
        const spouseTypes = ['สามี/ภรรยา', 'สามี', 'ภรรยา'];
        if (spouseTypes.includes(r.relation)) {
            if (graph[r.from_id] && graph[r.to_id]) {
                graph[r.from_id].push({ id: r.to_id, dir: 'spouse' });
                graph[r.to_id].push({ id: r.from_id, dir: 'spouse' });
            }
        }
    });

    // BFS
    const visited = new Set([identityId]);
    const queue   = [{ id: identityId, path: [] }];

    while (queue.length > 0) {
        const { id, path } = queue.shift();
        if (path.length >= 6) continue; // จำกัดความลึกเพื่อประสิทธิภาพ (ความสัมพันธ์เกิน 6 ชั้นหาได้ยากในทางปฏิบัติ)

        for (const edge of (graph[id] || [])) {
            if (visited.has(edge.id)) continue;
            visited.add(edge.id);

            const newPath = [...path, { dir: edge.dir, id: edge.id }];
            if (edge.id === targetId) return _pathToKinship(newPath, byId, identityId);
            queue.push({ id: edge.id, path: newPath });
        }
    }
    return null;
}

/**
 * แปลง path BFS เป็นคำเรียกความสัมพันธ์ภาษาไทย
 */
function _pathToKinship(path, byId, identityId) {
    const dirs   = path.map(p => p.dir).join('-');
    const target = byId[path[path.length - 1].id];
    const tGender  = target?.gender;
    const isMale   = tGender === 'ชาย';
    const isFemale = tGender === 'หญิง';
    const g = (m, f, n) => isMale ? m : (isFemale ? f : (n !== undefined ? n : m + '/' + f));

    switch (dirs) {
        case 'up':    return g('พ่อ', 'แม่');
        case 'down':  return 'ลูก';
        case 'spouse': return g('สามี', 'ภรรยา');

        case 'up-up': {
            const parent = byId[path[0].id];
            if (parent?.gender === 'ชาย') return g('ปู่', 'ย่า', 'ปู่/ย่า');
            if (parent?.gender === 'หญิง') return g('ตา', 'ยาย', 'ตา/ยาย');
            return g('ปู่/ตา', 'ย่า/ยาย', 'ปู่/ย่า/ตา/ยาย');
        }
        case 'down-down':  return 'หลาน';
        case 'up-up-up':   return 'ทวด';
        case 'down-down-down': return 'เหลน';

        case 'up-down': {
            const identity = byId[identityId];
            const tBirth = target?.birth_date, iBirth = identity?.birth_date;
            if (tBirth && iBirth) return tBirth < iBirth ? 'พี่' : 'น้อง';
            return 'พี่/น้อง';
        }

        case 'up-up-down': {
            const parent  = byId[path[0].id];
            const pBirth  = parent?.birth_date;
            const tBirth  = target?.birth_date;
            const isOlder = (pBirth && tBirth) ? (tBirth < pBirth) : null;
            if (isOlder === true)  return g('ลุง', 'ป้า', 'ลุง/ป้า');
            if (isOlder === false) {
                if (parent?.gender === 'หญิง') return g('น้าชาย', 'น้า', 'น้า');
                return 'อา';
            }
            return g('ลุง/อา', 'ป้า/น้า', 'ลุง/ป้า/น้า/อา');
        }

        case 'up-up-down-down': {
            const identity = byId[identityId];
            const tBirth = target?.birth_date, iBirth = identity?.birth_date;
            const prefix = (tBirth && iBirth) ? (tBirth < iBirth ? 'พี่' : 'น้อง') : '';
            return prefix + 'ลูกพี่ลูกน้อง';
        }

        case 'spouse-up': {
            const spouse = byId[path[0].id];
            if (spouse?.gender === 'หญิง') return g('พ่อตา', 'แม่ยาย', 'พ่อตา/แม่ยาย');
            if (spouse?.gender === 'ชาย')  return g('พ่อสามี', 'แม่สามี', 'พ่อสามี/แม่สามี');
            return g('พ่อตา/พ่อสามี', 'แม่ยาย/แม่สามี', 'พ่อ/แม่คู่สมรส');
        }

        case 'up-spouse':
            return g('พ่อเลี้ยง', 'แม่เลี้ยง', 'พ่อ/แม่เลี้ยง');

        case 'down-spouse': {
            const child = byId[path[0].id];
            if (child?.gender === 'ชาย')  return 'ลูกสะใภ้';
            if (child?.gender === 'หญิง') return 'ลูกเขย';
            return 'ลูกเขย/ลูกสะใภ้';
        }

        case 'up-down-spouse': {
            const sibling  = byId[path[1].id];
            const identity = byId[identityId];
            const sBirth   = sibling?.birth_date, iBirth = identity?.birth_date;
            const isOlder  = (sBirth && iBirth) ? sBirth < iBirth : null;
            const sibGender = sibling?.gender;
            if (sibGender === 'ชาย') {
                if (isOlder === true)  return 'พี่สะใภ้';
                if (isOlder === false) return 'น้องสะใภ้';
                return 'สะใภ้';
            }
            if (sibGender === 'หญิง') {
                if (isOlder === true)  return 'พี่เขย';
                if (isOlder === false) return 'น้องเขย';
                return 'เขย';
            }
            return 'คู่สมรสพี่น้อง';
        }

        case 'spouse-up-down': {
            const spouse = byId[path[0].id];
            const sBirth = spouse?.birth_date, tBirth = target?.birth_date;
            const isOlderThanSpouse = (sBirth && tBirth) ? tBirth < sBirth : null;
            const spouseGender = spouse?.gender;
            if (spouseGender === 'หญิง') {
                if (isOlderThanSpouse === true)  return 'พี่เมีย';
                if (isOlderThanSpouse === false) return 'น้องเมีย';
                return 'พี่/น้องเมีย';
            }
            if (spouseGender === 'ชาย') {
                if (isOlderThanSpouse === true)  return 'พี่ผัว';
                if (isOlderThanSpouse === false) return 'น้องผัว';
                return 'พี่/น้องผัว';
            }
            return 'พี่/น้องคู่สมรส';
        }

        case 'spouse-down': return 'ลูกเลี้ยง';

        default: {
            const parts = dirs.split('-');
            const upC   = parts.filter(d => d === 'up').length;
            const downC = parts.filter(d => d === 'down').length;
            if (upC > 0 && downC === 0) return 'บรรพบุรุษ';
            if (downC > 0 && upC === 0) return 'ลูกหลาน';
            return 'ญาติ';
        }
    }
}

/**
 * เติมตัวเลือกพ่อและแม่ในฟอร์มเพิ่มสมาชิก
 */
function populateParentDropdowns(members) {
    ['f-father', 'f-mother'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '<option value="">— ไม่ระบุ —</option>';
        (members || []).forEach(m => {
            const name = [m.prefix, m.first_name, m.last_name].filter(Boolean).join(' ');
            const opt  = document.createElement('option');
            opt.value       = m.id;
            opt.textContent = name;
            if (m.id === currentValue) opt.selected = true;
            select.appendChild(opt);
        });
    });
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

/**
 * แสดงแผนผังเครือญาติด้วย D3.js
 * รองรับ: parent-child, spouse, kinship labels จาก กำหนดตัวตน
 */
function renderFamilyTree() {
    const container = document.getElementById('tree-container');
    if (!container || !window.d3) return;

    // ล้าง SVG เดิม (คงปุ่มควบคุมและ legend ไว้)
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();

    const members       = window._familyMembers  || [];
    const relationships = window._relationships  || [];
    const identityId    = window._identityId     || null;

    if (members.length === 0) {
        const ph = document.createElement('div');
        ph.className = 'state-placeholder';
        ph.style.cssText = 'border:none;border-radius:0;';
        ph.innerHTML = '<div style="font-size:2.5rem;">🌱</div><p>ยังไม่มีข้อมูลสมาชิกในตระกูล</p><small>กดปุ่ม <strong>เพิ่มสมาชิก</strong> เพื่อเริ่มต้น</small>';
        container.appendChild(ph);
        return;
    }

    const d3 = window.d3;

    // ─── สร้าง lookup ───
    const byId = {};
    members.forEach(m => { byId[m.id] = m; });

    const fatherOf = {}, motherOf = {};
    const spousePairSet = new Set();
    const spousePairs   = [];

    relationships.forEach(r => {
        if (r.relation === 'พ่อ') {
            fatherOf[r.from_id] = r.to_id;
        } else if (r.relation === 'แม่') {
            motherOf[r.from_id] = r.to_id;
        } else if (['สามี/ภรรยา', 'สามี', 'ภรรยา'].includes(r.relation)) {
            const key = [r.from_id, r.to_id].sort().join('|');
            if (!spousePairSet.has(key) && byId[r.from_id] && byId[r.to_id]) {
                spousePairSet.add(key);
                spousePairs.push({ a: r.from_id, b: r.to_id });
            }
        }
    });

    // ─── สร้าง tree structure: พ่อ > แม่ > parent_id ───
    const primaryParentOf = {};
    const childrenOf = {};
    members.forEach(m => { childrenOf[m.id] = []; });

    members.forEach(m => {
        const p = fatherOf[m.id]
            || motherOf[m.id]
            || (m.parent_id && byId[m.parent_id] ? m.parent_id : null);
        if (p) primaryParentOf[m.id] = p;
    });
    members.forEach(m => {
        if (primaryParentOf[m.id]) childrenOf[primaryParentOf[m.id]].push(m.id);
    });

    // ─── หา root nodes ───
    let roots = members.filter(m => !primaryParentOf[m.id]);
    if (!roots.length) roots = [members[0]];

    // ─── build hierarchy (ป้องกัน cycle) ───
    const visitedBuild = new Set();
    function buildNode(id) {
        if (visitedBuild.has(id)) return null;
        visitedBuild.add(id);
        return {
            id,
            member: byId[id],
            children: (childrenOf[id] || []).map(buildNode).filter(Boolean)
        };
    }

    const treeData = roots.length === 1
        ? buildNode(roots[0].id)
        : { id: '__root__', member: null, children: roots.map(r => buildNode(r.id)).filter(Boolean) };

    // เพิ่มสมาชิกที่ยังไม่ได้เชื่อมโยง (disconnected)
    members.forEach(m => {
        if (!visitedBuild.has(m.id) && treeData) {
            treeData.children = treeData.children || [];
            const node = buildNode(m.id);
            if (node) treeData.children.push(node);
        }
    });

    // ─── D3 tree layout ───
    const NODE_W = 165, NODE_H = 110;
    const H_SEP  = 20,  V_SEP  = 56;
    // ─── Photo avatar constants ───
    const PHOTO_R  = 20;                  // รัศมีรูปโปรไฟล์ (px)
    const PHOTO_CX = NODE_W / 2;         // กึ่งกลาง x ของรูป
    const PHOTO_CY = 26;                 // กึ่งกลาง y ของรูป (จากบนสุดของ node)
    // Separation: 1 = พี่น้อง (siblings), 1.4 = ลูกพี่ลูกน้อง (cousins / different parent)
    const SIBLING_SEP = 1, COUSIN_SEP = 1.4;

    const root = d3.hierarchy(treeData);
    d3.tree()
        .nodeSize([NODE_W + H_SEP, NODE_H + V_SEP])
        .separation((a, b) => a.parent === b.parent ? SIBLING_SEP : COUSIN_SEP)(root);

    // คำนวณ bounds
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    root.each(d => {
        x0 = Math.min(x0, d.x - NODE_W / 2);
        x1 = Math.max(x1, d.x + NODE_W / 2);
        y0 = Math.min(y0, d.y - NODE_H / 2);
        y1 = Math.max(y1, d.y + NODE_H / 2);
    });

    const PAD  = 24;
    const svgW = x1 - x0 + PAD * 2;
    const svgH = y1 - y0 + PAD * 2;
    const ox   = -x0 + PAD;   // offset ให้ x อยู่ใน viewport
    const oy   = -y0 + PAD;

    // ─── สร้าง SVG ───
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.style.width  = '100%';
    svgEl.style.height = Math.min(svgH, 600) + 'px';
    container.insertBefore(svgEl, container.firstChild); // แทรกก่อนปุ่มควบคุม

    const svg  = d3.select(svgEl);
    const defs = svg.append('defs');
    // clipPath เดียวสำหรับทุก node (พิกัดอยู่ใน local space ของแต่ละ node เหมือนกัน)
    const AVATAR_CLIP_ID = 'clip-tree-avatar';
    defs.append('clipPath').attr('id', AVATAR_CLIP_ID)
        .append('circle')
        .attr('cx', NODE_W / 2).attr('cy', 26).attr('r', PHOTO_R);
    const g    = svg.append('g');

    // ─── Zoom / Pan ───
    const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on('zoom', ev => g.attr('transform', ev.transform));

    svg.call(zoom);

    // ตั้ง initial view ให้พอดีกับความกว้างของ container
    const CONTAINER_H_PADDING = 32; // ระยะห่างซ้าย-ขวาของ container
    const cw     = container.clientWidth || 800;
    const scale  = Math.min(1, (cw - CONTAINER_H_PADDING) / svgW);
    const initTx = (cw - svgW * scale) / 2;
    zoom.transform(svg, d3.zoomIdentity.translate(initTx, 16).scale(scale));

    // เก็บ reference สำหรับปุ่ม zoom controls (ใช้ใน index.html)
    window._treeSvg  = svg;
    window._treeZoom = zoom;

    // ─── ตำแหน่ง node แต่ละตัว (เทียบกับ offset) ───
    const posById = {};
    root.each(d => { posById[d.data.id] = { x: d.x + ox, y: d.y + oy }; });

    // ─── สร้าง couple → children map ───
    const coupleKey = (a, b) => [a, b].sort().join('|');
    const coupleChildren = {};
    members.forEach(m => {
        const fa = fatherOf[m.id];
        const mo = motherOf[m.id];
        if (fa && mo && posById[fa] && posById[mo]) {
            const key = coupleKey(fa, mo);
            if (spousePairSet.has(key)) {
                if (!coupleChildren[key]) coupleChildren[key] = [];
                coupleChildren[key].push(m.id);
            }
        }
    });
    const coupleConnectedChildren = new Set(Object.values(coupleChildren).flat());

    // ─── map: id → spouse id (ใช้หาจุดเริ่มต้นของเส้นพ่อ-แม่ → ลูก) ───
    const spouseOf = {};
    spousePairs.forEach(({ a, b }) => { spouseOf[a] = b; spouseOf[b] = a; });

    // ─── Edges: parent → child (ข้ามลูกที่มีพ่อ-แม่เป็นคู่สมรส) ───
    root.links()
        .filter(l => l.source.data.id !== '__root__' && l.target.data.id !== '__root__')
        .filter(l => !coupleConnectedChildren.has(l.target.data.id))
        .forEach(({ source: s, target: t }) => {
            const sx = s.x + ox, sy = s.y + oy;
            const tx = t.x + ox, ty = t.y + oy;

            // ถ้าพ่อ/แม่ (primary parent) มีคู่สมรสอยู่ในแผนผัง
            // ให้โยงเส้นจากจุดกึ่งกลางของเส้นแต่งงาน แทนที่จะโยงจาก node พ่อหรือแม่โดยตรง
            let startX = sx;
            const spouseId = spouseOf[s.data.id];
            if (spouseId && posById[spouseId]) {
                const spouseX = posById[spouseId].x;
                const [lx, rx] = sx <= spouseX
                    ? [sx + NODE_W / 2, spouseX - NODE_W / 2]
                    : [spouseX + NODE_W / 2, sx - NODE_W / 2];
                startX = (lx + rx) / 2;
            }

            const startY = sy + NODE_H / 2;
            const cy = (startY + ty) / 2;
            g.append('path')
                .attr('d', `M${startX},${startY} C${startX},${cy} ${tx},${cy} ${tx},${ty - NODE_H / 2}`)
                .attr('fill', 'none')
                .attr('stroke', '#86efac')
                .attr('stroke-width', 2);
        });

    // ─── Edges: พ่อ/แม่ที่สอง (เส้นประ) สำหรับลูกที่ไม่มีพ่อ-แม่เป็นคู่สมรส ───
    members.forEach(m => {
        if (coupleConnectedChildren.has(m.id)) return;
        const p1 = primaryParentOf[m.id];
        const p2 = (fatherOf[m.id] && fatherOf[m.id] !== p1) ? fatherOf[m.id]
                 : (motherOf[m.id] && motherOf[m.id] !== p1) ? motherOf[m.id] : null;
        if (!p2) return;
        const posM = posById[m.id], posP = posById[p2];
        if (!posM || !posP) return;
        const cy = (posM.y + posP.y) / 2;
        g.append('path')
            .attr('d', `M${posM.x},${posM.y - NODE_H / 2} C${posM.x},${cy} ${posP.x},${cy} ${posP.x},${posP.y + NODE_H / 2}`)
            .attr('fill', 'none')
            .attr('stroke', '#fbbf24')
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '5,3');
    });

    // ─── Edges: คู่สมรส — เส้นตรงแนวนอน + ลูกแตกจากจุดกึ่งกลาง ───
    spousePairs.forEach(({ a, b }) => {
        const posA = posById[a], posB = posById[b];
        if (!posA || !posB) return;

        // จัดซ้าย-ขวา
        const [leftPos, rightPos] = posA.x <= posB.x ? [posA, posB] : [posB, posA];
        const marriageY = (posA.y + posB.y) / 2;
        const lineX1    = leftPos.x  + NODE_W / 2;
        const lineX2    = rightPos.x - NODE_W / 2;
        const midX      = (lineX1 + lineX2) / 2;

        // เส้นแนวนอนแสดงการแต่งงาน (solid)
        g.append('line')
            .attr('x1', lineX1).attr('y1', marriageY)
            .attr('x2', lineX2).attr('y2', marriageY)
            .attr('stroke', '#f59e0b')
            .attr('stroke-width', 2);

        // ลูกของคู่สมรสนี้
        const key      = coupleKey(a, b);
        const children = (coupleChildren[key] || []).filter(cid => posById[cid]);

        if (children.length > 0) {
            children.sort((x, y) => posById[x].x - posById[y].x);

            const dropStartY  = marriageY;
            const firstChildY = posById[children[0]].y;
            const junctionY   = firstChildY - NODE_H / 2 - Math.max((firstChildY - NODE_H / 2 - (marriageY + NODE_H / 2)) * 0.4, 10);

            // เส้นตั้งจากกึ่งกลางเส้นแต่งงานลงสู่จุดแยก
            g.append('line')
                .attr('x1', midX).attr('y1', dropStartY + NODE_H / 2)
                .attr('x2', midX).attr('y2', junctionY)
                .attr('stroke', '#86efac')
                .attr('stroke-width', 2);

            if (children.length > 1) {
                // เส้นแนวนอนเชื่อมลูกทั้งหมด (ขยายถึง midX ถ้าจำเป็น)
                const leftChildX  = posById[children[0]].x;
                const rightChildX = posById[children[children.length - 1]].x;
                const sibLineX1   = Math.min(leftChildX, midX);
                const sibLineX2   = Math.max(rightChildX, midX);
                g.append('line')
                    .attr('x1', sibLineX1).attr('y1', junctionY)
                    .attr('x2', sibLineX2).attr('y2', junctionY)
                    .attr('stroke', '#86efac')
                    .attr('stroke-width', 2);
            }

            // เส้นตั้งจากจุดแยกลงหาลูกแต่ละคน
            children.forEach(cid => {
                const posC = posById[cid];
                g.append('line')
                    .attr('x1', posC.x).attr('y1', junctionY)
                    .attr('x2', posC.x).attr('y2', posC.y - NODE_H / 2)
                    .attr('stroke', '#86efac')
                    .attr('stroke-width', 2);
            });
        }
    });

    // ─── Nodes ───
    root.descendants()
        .filter(d => d.data.id !== '__root__')
        .forEach(d => {
            const member = d.data.member;
            const pos    = posById[d.data.id];
            if (!pos || !member) return;

            const isAlive  = member.is_alive !== false;
            const isMale   = member.gender === 'ชาย';
            const isFemale = member.gender === 'หญิง';

            const strokeColor = isMale   ? '#2563eb'
                              : isFemale ? '#db2777'
                              : '#059669';
            // สีพื้นหลังตามเพศ: ฟ้าอ่อน=ชาย, ชมพูอ่อน=หญิง
            const fillColor = isMale
                ? (isAlive ? '#eff6ff' : '#dce8f5')
                : isFemale
                ? (isAlive ? '#fdf2f8' : '#eedbe8')
                : (isAlive ? '#ffffff' : '#e5e7eb');
            const textColor   = isAlive ? '#1e293b' : '#6b7280';

            const ng = g.append('g')
                .attr('class', 'tree-node')
                .attr('transform', `translate(${pos.x - NODE_W / 2},${pos.y - NODE_H / 2})`)
                .style('cursor', 'pointer')
                .on('click', () => {
                    if (typeof openRelationModal === 'function') openRelationModal(d.data.id);
                });

            // Card background
            ng.append('rect')
                .attr('width', NODE_W).attr('height', NODE_H).attr('rx', 10)
                .attr('fill', fillColor)
                .attr('stroke', strokeColor).attr('stroke-width', 2)
                .style('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.09))');

            // ─── รูปโปรไฟล์วงกลม ───
            // วงกลมพื้นหลัง
            ng.append('circle')
                .attr('cx', PHOTO_CX).attr('cy', PHOTO_CY).attr('r', PHOTO_R)
                .attr('fill', fillColor)
                .attr('stroke', strokeColor).attr('stroke-width', 1.5);

            if (member.photo_url) {
                // แสดงรูปจริง (ถูก clip เป็นวงกลม)
                ng.append('image')
                    .attr('href', member.photo_url)
                    .attr('x', PHOTO_CX - PHOTO_R).attr('y', PHOTO_CY - PHOTO_R)
                    .attr('width', PHOTO_R * 2).attr('height', PHOTO_R * 2)
                    .attr('clip-path', `url(#${AVATAR_CLIP_ID})`);
            } else {
                // Placeholder: ตัวอักษรแรกของชื่อ
                const initial = member.first_name ? member.first_name.charAt(0) : '?';
                ng.append('text')
                    .attr('x', PHOTO_CX).attr('y', PHOTO_CY + 6)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '15px').attr('font-weight', '700')
                    .attr('fill', strokeColor)
                    .text(initial);
            }

            // Line 1: first_name - last_name (ไม่มี emoji เพศ)
            const fullName = [member.first_name, member.last_name].filter(Boolean).join(' - ');
            ng.append('text')
                .attr('x', NODE_W / 2).attr('y', 60)
                .attr('text-anchor', 'middle')
                .attr('font-size', '12px').attr('font-weight', '700').attr('fill', textColor)
                .text(fullName.length > 22 ? fullName.slice(0, 22) + '…' : fullName);

            // Line 2: (nickname)
            if (member.nickname) {
                ng.append('text')
                    .attr('x', NODE_W / 2).attr('y', 76)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '11px').attr('fill', textColor)
                    .text(`(${member.nickname})`);
            }

            // ─── Kinship badge (จาก กำหนดตัวตน) ───
            if (identityId) {
                const isSelf  = identityId === member.id;
                const kinship = isSelf
                    ? 'ตัวเอง'
                    : (typeof computeKinship === 'function'
                        ? (computeKinship(identityId, member.id) || '')
                        : '');

                if (kinship) {
                    const BADGE_CHAR_W   = 7;  // ความกว้างโดยประมาณต่อตัวอักษร (px)
                    const BADGE_PADDING  = 14; // padding ซ้าย-ขวารวม (px)
                    const BADGE_MIN_W    = 44; // ความกว้างขั้นต่ำ (px)
                    const bw  = Math.max(kinship.length * BADGE_CHAR_W + BADGE_PADDING, BADGE_MIN_W);
                    const bx  = (NODE_W - bw) / 2;
                    const by  = NODE_H - 17;
                    ng.append('rect')
                        .attr('x', bx).attr('y', by)
                        .attr('width', bw).attr('height', 14).attr('rx', 7)
                        .attr('fill',   isSelf ? '#d1fae5' : '#fef3c7')
                        .attr('stroke', isSelf ? '#6ee7b7' : '#fde68a')
                        .attr('stroke-width', 1);
                    ng.append('text')
                        .attr('x', NODE_W / 2).attr('y', by + 10)
                        .attr('text-anchor', 'middle')
                        .attr('font-size', '9px').attr('font-weight', '700')
                        .attr('fill', isSelf ? '#065f46' : '#92400e')
                        .text(kinship);
                }
            }
        });
}
