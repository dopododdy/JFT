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
// ตัวเลือกซ่อนคู่สมรสที่ไม่มีเส้นสายพ่อ/แม่ในแผนผัง
window._treeHideMarriedIn = false;

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

        // สีพื้นหลังตามเพศ (ฟ้าอ่อน=ชาย, ชมพูอ่อน=หญิง) และเทาเข้มเมื่อเสียชีวิต
        const cardBgColor = isAlive
            ? (member.gender === 'ชาย' ? '#eff6ff' : member.gender === 'หญิง' ? '#fdf2f8' : '#ffffff')
            : '#9ca3af';

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
 * แสดงแผนผังเครือญาติแบบ Pedigree View ด้วย D3.js
 * Root (บุคคลที่เลือกจาก "กำหนดตัวตน") อยู่ซ้ายสุด บรรพบุรุษแผ่ไปทางขวา
 * รองรับ Zoom / Pan บน Mobile และเส้นเชื่อมแบบหักมุม (Orthogonal Elbow Lines)
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

    // ─── สร้าง lookup map ───
    const byId = {};
    members.forEach(m => { byId[m.id] = m; });

    // fatherOf[childId] = fatherId, motherOf[childId] = motherId
    // (from_id = ลูก, to_id = พ่อหรือแม่)
    const fatherOf = {}, motherOf = {};
    relationships.forEach(r => {
        if (!byId[r.from_id] || !byId[r.to_id]) return;
        if (r.relation === 'พ่อ')      fatherOf[r.from_id] = r.to_id;
        else if (r.relation === 'แม่') motherOf[r.from_id] = r.to_id;
    });

    // ─── กำหนด Root ───
    // (members.length === 0 ถูกตรวจสอบแล้วด้านบน จึงเข้าถึง members[0] ได้อย่างปลอดภัย)
    const rootId = (identityId && byId[identityId]) ? identityId : members[0].id;

    // ─── สร้าง Pedigree Tree แบบ Recursive (บรรพบุรุษเท่านั้น) ───
    // MAX_ANCESTOR_DEPTH: depth 0 = Root, depth N = รุ่นบรรพบุรุษที่ N (ไม่เกิน 5 รุ่น)
    const MAX_ANCESTOR_DEPTH = 5;
    const nodeMap   = new Map(); // "id@depth" → node

    function buildAncestor(personId, depth) {
        if (!personId || !byId[personId] || depth > MAX_ANCESTOR_DEPTH) return null;
        const key = `${personId}@${depth}`;
        if (nodeMap.has(key)) return nodeMap.get(key);

        const node = { id: personId, depth, slot: 0, father: null, mother: null };
        nodeMap.set(key, node);
        node.father = buildAncestor(fatherOf[personId] || null, depth + 1);
        node.mother = buildAncestor(motherOf[personId] || null, depth + 1);
        return node;
    }

    const rootNode = buildAncestor(rootId, 0);

    // ─── กำหนด slot (ตำแหน่ง Y) ด้วย DFS ───
    // ใบสุดท้าย (บรรพบุรุษที่ไม่มีข้อมูลพ่อแม่) จะได้ slot ต่อเนื่อง
    // โหนดพ่อแม่จะได้ slot = ค่าเฉลี่ยของลูก
    let leafSlot = 0;

    function assignSlots(node) {
        if (!node) return;
        const hasFather = !!node.father;
        const hasMother = !!node.mother;
        if (!hasFather && !hasMother) {
            node.slot = leafSlot++;
        } else {
            assignSlots(node.father);
            assignSlots(node.mother);
            const slots = [];
            if (hasFather) slots.push(node.father.slot);
            if (hasMother) slots.push(node.mother.slot);
            node.slot = slots.reduce((s, v) => s + v, 0) / slots.length;
        }
    }

    assignSlots(rootNode);

    // ─── Layout constants ───
    const NODE_W  = 145, NODE_H  = 90;
    const H_GAP   = 36,  V_GAP   = 18;
    const GEN_W   = NODE_W + H_GAP;   // ระยะห่างแต่ละ generation แนวนอน
    const SLOT_H  = NODE_H + V_GAP;   // ระยะห่างแต่ละ slot แนวตั้ง
    const PAD     = 20;
    const PHOTO_R = 15, PHOTO_CX = NODE_W / 2, PHOTO_CY = 20;
    const CLIP_ID = 'clip-ped-avatar';
    // Badge sizing
    const BADGE_CHAR_W = 7, BADGE_PAD = 12, BADGE_MIN_W = 40;
    // Shadow opacity
    const SHADOW_ROOT = 0.15, SHADOW_DEFAULT = 0.09;

    // ─── แปลง slot / depth → พิกัด pixel ───
    const slotToY  = s => PAD + s * SLOT_H;
    const depthToX = d => PAD + d * GEN_W;

    function assignPositions(node) {
        if (!node) return;
        node.x = depthToX(node.depth);
        node.y = slotToY(node.slot);
        assignPositions(node.father);
        assignPositions(node.mother);
    }

    assignPositions(rootNode);

    // คำนวณขนาด SVG จากโหนดทั้งหมด
    let maxX = 0, maxY = 0;
    nodeMap.forEach(n => {
        maxX = Math.max(maxX, n.x + NODE_W);
        maxY = Math.max(maxY, n.y + NODE_H);
    });
    const svgW = maxX + PAD;
    const svgH = maxY + PAD;

    // ─── สร้าง SVG ───
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.style.width  = '100%';
    svgEl.style.height = Math.min(svgH, 600) + 'px';
    container.insertBefore(svgEl, container.firstChild);

    const svg  = d3.select(svgEl);
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', CLIP_ID)
        .append('circle')
        .attr('cx', PHOTO_CX).attr('cy', PHOTO_CY).attr('r', PHOTO_R);

    const g = svg.append('g');

    // ─── Zoom / Pan (รองรับ Mobile) ───
    const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on('zoom', ev => g.attr('transform', ev.transform));
    svg.call(zoom);

    const cw    = container.clientWidth || 800;
    const scale = Math.min(1, (cw - 32) / svgW);
    zoom.transform(svg, d3.zoomIdentity.translate(PAD, 16).scale(scale));

    // เก็บ reference สำหรับปุ่ม zoom controls (treeZoomIn / treeZoomOut / treeZoomReset)
    window._treeSvg  = svg;
    window._treeZoom = zoom;

    // ─── วาด Elbow Lines (เส้นหักมุม) ก่อนวาดการ์ด เพื่อให้อยู่ด้านหลัง ───
    const drawnLines = new Set();

    function drawLines(node) {
        if (!node) return;
        const parents = [node.father, node.mother].filter(Boolean);
        if (!parents.length) return;

        const lineKey = `${node.id}@${node.depth}`;
        if (drawnLines.has(lineKey)) return;
        drawnLines.add(lineKey);

        const srcX = node.x + NODE_W;          // ขอบขวาของการ์ด
        const srcY = node.y + NODE_H / 2;      // กึ่งกลาง Y ของการ์ด
        const jctX = srcX + H_GAP / 2;         // X จุดเชื่อม (junction) กึ่งกลางช่องว่าง

        // เส้นแนวนอนจากการ์ดถึง junction
        g.append('line')
            .attr('x1', srcX).attr('y1', srcY)
            .attr('x2', jctX).attr('y2', srcY)
            .attr('stroke', '#86efac').attr('stroke-width', 2);

        if (parents.length === 2) {
            // เส้นแนวตั้งที่ junction เชื่อมระดับพ่อ-แม่
            const topY = Math.min(node.father.y, node.mother.y) + NODE_H / 2;
            const botY = Math.max(node.father.y, node.mother.y) + NODE_H / 2;
            g.append('line')
                .attr('x1', jctX).attr('y1', topY)
                .attr('x2', jctX).attr('y2', botY)
                .attr('stroke', '#86efac').attr('stroke-width', 2);
        }

        // เส้นแนวนอนจาก junction ถึงขอบซ้ายของการ์ดพ่อ/แม่แต่ละคน
        parents.forEach(p => {
            const pY = p.y + NODE_H / 2;
            g.append('line')
                .attr('x1', jctX).attr('y1', pY)
                .attr('x2', p.x).attr('y2', pY)
                .attr('stroke', '#86efac').attr('stroke-width', 2);
        });

        drawLines(node.father);
        drawLines(node.mother);
    }

    drawLines(rootNode);

    // ─── วาด Node Cards ───
    const drawnNodes = new Set();

    function drawNode(node) {
        if (!node) return;
        const nodeKey = `${node.id}@${node.depth}`;
        if (drawnNodes.has(nodeKey)) return;
        drawnNodes.add(nodeKey);

        const member = byId[node.id];
        if (!member) return;

        const isRoot   = node.id === rootId && node.depth === 0;
        const isAlive  = member.is_alive !== false;
        const isMale   = member.gender === 'ชาย';
        const isFemale = member.gender === 'หญิง';

        const strokeColor = isRoot   ? '#059669'
                          : isMale   ? '#2563eb'
                          : isFemale ? '#db2777'
                          : '#059669';

        const fillColor = isRoot
            ? '#d1fae5'
            : isMale   ? (isAlive ? '#eff6ff' : '#dce8f5')
            : isFemale ? (isAlive ? '#fdf2f8' : '#eedbe8')
            :             (isAlive ? '#ffffff'  : '#e5e7eb');

        const textColor = isAlive ? '#1e293b' : '#6b7280';

        const ng = g.append('g')
            .attr('class', 'tree-node')
            .attr('transform', `translate(${node.x},${node.y})`)
            .style('cursor', 'pointer')
            .on('click', () => {
                if (typeof openRelationModal === 'function') openRelationModal(member.id);
            });

        // การ์ดพื้นหลัง (Root เน้นด้วยเส้นขอบหนาและสีเขียว)
        ng.append('rect')
            .attr('width', NODE_W).attr('height', NODE_H).attr('rx', 10)
            .attr('fill', fillColor)
            .attr('stroke', strokeColor)
            .attr('stroke-width', isRoot ? 3 : 2)
            .style('filter', `drop-shadow(0 2px 6px rgba(0,0,0,${isRoot ? SHADOW_ROOT : SHADOW_DEFAULT}))`);

        // วงกลมพื้นหลังรูปภาพ
        ng.append('circle')
            .attr('cx', PHOTO_CX).attr('cy', PHOTO_CY).attr('r', PHOTO_R)
            .attr('fill', fillColor)
            .attr('stroke', strokeColor).attr('stroke-width', 1.5);

        if (member.photo_url) {
            // แสดงรูปจริง (clip เป็นวงกลม)
            ng.append('image')
                .attr('href', member.photo_url)
                .attr('x', PHOTO_CX - PHOTO_R).attr('y', PHOTO_CY - PHOTO_R)
                .attr('width', PHOTO_R * 2).attr('height', PHOTO_R * 2)
                .attr('clip-path', `url(#${CLIP_ID})`);
        } else {
            // Placeholder: ตัวอักษรแรกของชื่อ
            const initial = member.first_name ? member.first_name.charAt(0) : '?';
            ng.append('text')
                .attr('x', PHOTO_CX).attr('y', PHOTO_CY + 5)
                .attr('text-anchor', 'middle')
                .attr('font-size', '13px').attr('font-weight', '700')
                .attr('fill', strokeColor)
                .text(initial);
        }

        // ชื่อ-นามสกุล
        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ');
        ng.append('text')
            .attr('x', NODE_W / 2).attr('y', 48)
            .attr('text-anchor', 'middle')
            .attr('font-size', '11px').attr('font-weight', '700').attr('fill', textColor)
            .text(fullName.length > 20 ? fullName.slice(0, 20) + '…' : fullName);

        // ชื่อเล่น
        if (member.nickname) {
            ng.append('text')
                .attr('x', NODE_W / 2).attr('y', 61)
                .attr('text-anchor', 'middle')
                .attr('font-size', '10px').attr('fill', textColor)
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
                const bw = Math.max(kinship.length * BADGE_CHAR_W + BADGE_PAD, BADGE_MIN_W);
                const bx = (NODE_W - bw) / 2;
                const by = NODE_H - 16;
                ng.append('rect')
                    .attr('x', bx).attr('y', by)
                    .attr('width', bw).attr('height', 13).attr('rx', 6.5)
                    .attr('fill',   isSelf ? '#d1fae5' : '#fef3c7')
                    .attr('stroke', isSelf ? '#6ee7b7' : '#fde68a')
                    .attr('stroke-width', 1);
                ng.append('text')
                    .attr('x', NODE_W / 2).attr('y', by + 9)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '9px').attr('font-weight', '700')
                    .attr('fill', isSelf ? '#065f46' : '#92400e')
                    .text(kinship);
            }
        }

        drawNode(node.father);
        drawNode(node.mother);
    }

    drawNode(rootNode);
}
