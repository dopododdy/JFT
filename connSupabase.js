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
 * แสดงสมาชิกในรูปแบบ Vertical Waterfall (Indented List)
 * — คู่สมรสแสดงในการ์ดเดียว (couple card)
 * — ลูกแสดงซ้อนอยู่ใต้พ่อ-แม่ พับ/ขยายได้
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
    const rels = window._relationships || [];

    // ── Build lookup maps ──────────────────────────────────────────────────
    const memberById = {};
    members.forEach(m => { memberById[m.id] = m; });

    // spouseOf[id] = [spouseId, ...]
    const spouseOf = {};
    rels.forEach(r => {
        if (['สามี', 'ภรรยา', 'สามี/ภรรยา'].includes(r.relation)) {
            (spouseOf[r.from_id] = spouseOf[r.from_id] || []).push(r.to_id);
            (spouseOf[r.to_id]   = spouseOf[r.to_id]   || []).push(r.from_id);
        }
    });

    // parentOf[childId] = { father: id, mother: id }
    const parentOf = {};
    rels.forEach(r => {
        if ((r.relation === 'พ่อ' || r.relation === 'แม่') && memberById[r.to_id]) {
            if (!parentOf[r.from_id]) parentOf[r.from_id] = {};
            parentOf[r.from_id][r.relation === 'พ่อ' ? 'father' : 'mother'] = r.to_id;
        }
    });
    // รองรับ parent_id แบบ legacy
    members.forEach(m => {
        if (m.parent_id && memberById[m.parent_id] && !parentOf[m.id]) {
            parentOf[m.id] = { legacy: m.parent_id };
        }
    });

    // childrenOf[parentId] = [childId, ...]
    const childrenOf = {};
    members.forEach(m => {
        const p = parentOf[m.id];
        if (!p) return;
        [p.father, p.mother, p.legacy].filter(Boolean).forEach(pid => {
            (childrenOf[pid] = childrenOf[pid] || []).push(m.id);
        });
    });

    // รากของต้นไม้ = สมาชิกที่ไม่มีข้อมูลพ่อ-แม่ในระบบ
    const hasParent = new Set(Object.keys(parentOf));

    // ผู้ที่ไม่มีพ่อ-แม่ในระบบ แต่มีคู่สมรสที่มีพ่อ-แม่ ต้อง render อยู่ใต้พ่อ-แม่ของคู่สมรสนั้น
    const spouseOfPersonWithParent = new Set();
    members.forEach(m => {
        if (hasParent.has(m.id)) {
            (spouseOf[m.id] || []).forEach(sid => {
                if (!hasParent.has(sid)) spouseOfPersonWithParent.add(sid);
            });
        }
    });

    const roots = members.filter(m => !hasParent.has(m.id) && !spouseOfPersonWithParent.has(m.id));

    // ── Render helpers ──────────────────────────────────────────────────────

    const _hasComputeKinship = typeof computeKinship === 'function';

    function _kinshipHtml(memberId) {
        if (!identityId) return '';
        if (identityId === memberId) return '<span class="kinship-label kinship-self">👤 ตัวเอง</span>';
        const k = _hasComputeKinship ? computeKinship(identityId, memberId) : null;
        return k ? `<span class="kinship-label">${escapeHtml(k)}</span>` : '';
    }

    function _photoHtml(m, size) {
        return m.photo_url
            ? `<img src="${escapeHtml(m.photo_url)}" class="wf-photo" style="width:${size}px;height:${size}px;" alt="" onerror="this.style.display='none'">`
            : `<div class="wf-photo wf-photo-ph" style="width:${size}px;height:${size}px;">👤</div>`;
    }

    // การ์ดสมาชิก (ใช้สำหรับทั้งด้านหน้าและด้านหลังของ flip card)
    function _memberCardHtml(member, opts) {
        opts = opts || {};
        const alive   = member.is_alive !== false;
        const accent  = member.gender === 'ชาย' ? '#2563eb' : member.gender === 'หญิง' ? '#db2777' : '#059669';
        const bg      = alive
            ? (member.gender === 'ชาย' ? '#eff6ff' : member.gender === 'หญิง' ? '#fdf2f8' : '#ffffff')
            : '#f3f4f6';
        const name    = [member.prefix, member.first_name, member.last_name].filter(Boolean).join(' ');
        const display = name + (member.nickname ? ` (${member.nickname})` : '');
        const search  = `${member.first_name || ''} ${member.last_name || ''}`.trim();
        const age     = (alive && member.birth_date) ? calcAge(member.birth_date) : null;
        const aliveText = alive
            ? '🟢 มีชีวิต'
            : `⚫ เสียชีวิต${member.death_date ? ' ' + formatThaiDate(member.death_date) : ''}`;
        const former  = [member.former_first_name, member.former_last_name].filter(Boolean).join(' ');

        const genderEmoji = member.gender === 'ชาย' ? '👨' : member.gender === 'หญิง' ? '👩' : '👤';
        const nickLabel   = escapeHtml(member.nickname || member.first_name || '');
        const statusDot   = alive ? '🟢' : '⚫';

        const fRel = rels.find(r => r.from_id === member.id && r.relation === 'พ่อ'  && memberById[r.to_id]);
        const mRel = rels.find(r => r.from_id === member.id && r.relation === 'แม่' && memberById[r.to_id]);
        let parentText = '';
        if (fRel) {
            const f = memberById[fRel.to_id];
            parentText += `<div><strong>พ่อ:</strong> ${escapeHtml([f.prefix, f.first_name, f.last_name].filter(Boolean).join(' '))}</div>`;
        }
        if (mRel) {
            const mo = memberById[mRel.to_id];
            parentText += `<div><strong>แม่:</strong> ${escapeHtml([mo.prefix, mo.first_name, mo.last_name].filter(Boolean).join(' '))}</div>`;
        }
        if (!fRel && !mRel && member.parent_id) {
            const par = memberById[member.parent_id];
            if (par) parentText = `<div><strong>ผู้ปกครอง:</strong> ${escapeHtml([par.prefix, par.first_name, par.last_name].filter(Boolean).join(' '))}</div>`;
        }

        // ป้ายความสัมพันธ์อื่นๆ (ยกเว้น พ่อ/แม่/สามี/ภรรยา)
        const relTags = rels
            .filter(r => (r.from_id === member.id || r.to_id === member.id) &&
                         !['พ่อ','แม่','ลูก','สามี','ภรรยา','สามี/ภรรยา'].includes(r.relation))
            .map(r => {
                const isFrom = r.from_id === member.id;
                const o = memberById[isFrom ? r.to_id : r.from_id];
                if (!o) return '';
                const oName  = [o.prefix, o.first_name, o.last_name].filter(Boolean).join(' ');
                const label  = isFrom ? r.relation : _reverseRelation(r.relation);
                return `<span class="rel-tag">${escapeHtml(label)}: ${escapeHtml(oName)}</span>`;
            })
            .filter(Boolean).join('');

        const footer = opts.isBack
            ? `<div class="member-card-footer">
                <button class="btn-card-back-flip">◀ กลับ</button>
                <div class="card-btn-group">
                    <button class="btn-card-edit"   data-member-id="${escapeHtml(member.id)}">✏️ แก้ไข</button>
                    <button class="btn-card-delete" data-member-id="${escapeHtml(member.id)}">🗑️ ลบ</button>
                </div>
              </div>`
            : `<div class="member-card-footer">
                <span class="card-hint">🔗 คลิกเพื่อจัดการความสัมพันธ์</span>
                <div class="card-btn-group">
                    ${opts.showSpouseBtn ? `<button class="btn-card-spouse">💑 คู่สมรส</button>` : ''}
                    <button class="btn-card-edit"   data-member-id="${escapeHtml(member.id)}">✏️ แก้ไข</button>
                    <button class="btn-card-delete" data-member-id="${escapeHtml(member.id)}">🗑️ ลบ</button>
                </div>
              </div>`;

        return `<div class="member-card${alive ? '' : ' deceased'}" data-id="${escapeHtml(member.id)}" data-name="${escapeHtml(search.toLowerCase())}" style="border-left-color:${accent};background-color:${bg};">
            <div class="member-card-summary">
                <span class="member-summary-gender">${genderEmoji}</span>
                <span class="member-summary-nick">${nickLabel}</span>
                <span class="member-summary-status">${statusDot}</span>
                <span class="member-summary-arrow">▾</span>
            </div>
            <div class="member-card-body">
                ${opts.isBack ? `<div class="card-spouse-label">💑 คู่สมรส</div>` : ''}
                <div class="member-card-header">
                    <div class="member-card-title">
                        <h3 class="member-card-name">${escapeHtml(display)}</h3>
                        ${_kinshipHtml(member.id)}
                    </div>
                    ${_photoHtml(member, 56)}
                </div>
                <div class="member-card-info">
                    ${former ? `<div><strong>ชื่อเดิม:</strong> ${escapeHtml(former)}</div>` : ''}
                    ${member.marital_status ? `<div><strong>สถานะสมรส:</strong> ${escapeHtml(member.marital_status)}</div>` : ''}
                    <div><strong>เพศ:</strong> ${escapeHtml(member.gender) || 'ไม่ระบุ'}</div>
                    ${member.birth_date ? `<div><strong>วันเกิด:</strong> ${formatThaiDate(member.birth_date)}</div>` : ''}
                    <div><strong>สถานะ:</strong> ${aliveText}</div>
                    ${age ? `<div><strong>อายุ:</strong> ${age} ปี</div>` : ''}
                    ${member.phone     ? `<div><strong>โทร:</strong> ${escapeHtml(member.phone)}</div>`               : ''}
                    ${member.workplace ? `<div><strong>สถานที่ทำงาน:</strong> ${escapeHtml(member.workplace)}</div>` : ''}
                    ${member.address   ? `<div><strong>ที่อยู่:</strong> ${escapeHtml(member.address)}</div>`         : ''}
                    ${member.line_id   ? `<div><strong>ไลน์:</strong> ${escapeHtml(member.line_id)}</div>`            : ''}
                    ${parentText}
                    ${relTags ? `<div class="rel-tags-wrap">${relTags}</div>` : ''}
                    ${member.bio ? `<div class="member-bio">"${escapeHtml(member.bio)}"</div>` : ''}
                </div>
                ${footer}
            </div>
        </div>`;
    }

    // การ์ดสมาชิกเดี่ยว — ถ้ามีคู่สมรสจะห่อด้วย flip card
    function _singleCard(m, spouse) {
        const frontHtml = _memberCardHtml(m, { showSpouseBtn: !!spouse });
        if (!spouse) return frontHtml;

        const backHtml = _memberCardHtml(spouse, { isBack: true });
        return `<div class="card-flip-wrap">
            <div class="card-flip-inner">
                <div class="card-face card-face-front">${frontHtml}</div>
                <div class="card-face card-face-back">${backHtml}</div>
            </div>
        </div>`;
    }

    // ── Recursive tree renderer ─────────────────────────────────────────────
    const rendered = new Set();
    let nodeCounter = 0;

    function _renderNode(memberId) {
        if (rendered.has(memberId)) return '';
        const m = memberById[memberId];
        if (!m) return '';
        rendered.add(memberId);

        // หาคู่สมรสที่ยังไม่ได้แสดง
        let spouse = null;
        for (const sid of (spouseOf[memberId] || [])) {
            if (!rendered.has(sid) && memberById[sid]) {
                spouse = memberById[sid];
                rendered.add(sid);
                break;
            }
        }

        // รวมลูกของสมาชิกและคู่สมรส
        const childIds = new Set(childrenOf[memberId] || []);
        if (spouse) (childrenOf[spouse.id] || []).forEach(cid => childIds.add(cid));
        const children = [...childIds].filter(cid => !rendered.has(cid));
        const hasChildren = children.length > 0;
        const nid = `wf-${++nodeCounter}`;

        const card = _singleCard(m, spouse);

        let toggleHtml = '';
        let childrenHtml = '';
        if (hasChildren) {
            toggleHtml = `<div class="wf-toggle-bar">
                <button class="children-toggle open" data-target="${nid}-ch" onclick="toggleFamilyChildren(this)">
                    <span class="toggle-arrow">▶</span> ลูก ${children.length} คน
                </button>
            </div>`;
            const childNodes = children.map(cid => _renderNode(cid)).join('');
            childrenHtml = `<div class="family-children" id="${nid}-ch">${childNodes}</div>`;
        }

        return `<div class="family-node">${card}${toggleHtml}${childrenHtml}</div>`;
    }

    // สร้าง HTML ทั้งหมด
    const parts = [];
    roots.forEach(root => {
        const h = _renderNode(root.id);
        if (h) parts.push(h);
    });
    // แสดงสมาชิกที่เหลือซึ่งยังไม่ถูก render (ไม่มีความเชื่อมโยงในระบบ)
    members.forEach(m => {
        if (!rendered.has(m.id)) {
            const h = _renderNode(m.id);
            if (h) parts.push(h);
        }
    });

    containerEl.innerHTML = `<div class="family-waterfall">${parts.join('')}</div>`;
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
 * แสดงแผนผังเครือญาติแบบ Full-Tree View ด้วย D3.js
 * Root (บุคคลที่เลือกจาก "กำหนดตัวตน") อยู่กึ่งกลาง ลูกหลานแผ่ไปทางซ้าย บรรพบุรุษแผ่ไปทางขวา
 * แสดงทุกคนที่มีความสัมพันธ์เชื่อมถึงกัน (ทั้งบรรพบุรุษ ลูกหลาน และพี่น้อง)
 * รองรับ Zoom / Pan บน Mobile และเส้นเชื่อมแบบหักมุม (Orthogonal Elbow Lines)
 */
function renderFamilyTree() {
    const container = document.getElementById('tree-container');
    if (!container || !window.d3) return;

    // ล้าง SVG เดิมและ placeholder เดิม (คงปุ่มควบคุมไว้)
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();
    container.querySelectorAll('.state-placeholder').forEach(el => el.remove());

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

    if (!identityId) {
        const ph = document.createElement('div');
        ph.className = 'state-placeholder';
        ph.style.cssText = 'border:none;border-radius:0;';
        ph.innerHTML = '<div style="font-size:2.5rem;">👤</div><p>กรุณากำหนดตัวตนก่อน</p><small>เพื่อการแสดงผลแผนผังที่ถูกต้อง</small><br><button class="btn btn-primary" style="margin-top:1rem;" onclick="openIdentityModal()">🔍 สืบลำดับญาติ</button>';
        container.appendChild(ph);
        return;
    }

    const d3 = window.d3;

    // ─── สร้าง lookup map ───
    const byId = {};
    members.forEach(m => { byId[m.id] = m; });

    // fatherOf[childId] = fatherId, motherOf[childId] = motherId
    // childrenOf[parentId] = [childId, ...]
    const fatherOf = {}, motherOf = {}, childrenOf = {};
    relationships.forEach(r => {
        if (!byId[r.from_id] || !byId[r.to_id]) return;
        if (r.relation === 'พ่อ')      fatherOf[r.from_id] = r.to_id;
        else if (r.relation === 'แม่') motherOf[r.from_id] = r.to_id;
    });
    members.forEach(m => {
        [fatherOf[m.id], motherOf[m.id]].filter(Boolean).forEach(pid => {
            if (!childrenOf[pid]) childrenOf[pid] = [];
            childrenOf[pid].push(m.id);
        });
    });

    // ─── กำหนด Root ───
    const rootId = (identityId && byId[identityId]) ? identityId : members[0].id;

    // ─── BFS เฉพาะสายตรง: บรรพบุรุษและลูกหลานโดยตรงของ identity เท่านั้น ───
    // gen 0 = root, gen บวก = บรรพบุรุษ (ทางขวา), gen ลบ = ลูกหลาน (ทางซ้าย)
    // direction: 'up' = ขึ้นหาบรรพบุรุษเท่านั้น, 'down' = ลงหาลูกหลานเท่านั้น, 'both' = root (ขึ้นลงได้ทั้งคู่)
    const MAX_ANCESTOR_DEPTH   = 5;
    const MAX_DESCENDANT_DEPTH = 5;
    const genOf = {};
    genOf[rootId] = 0;
    const bfsQueue   = [{ id: rootId, dir: 'both' }];
    const bfsVisited = new Set([rootId]);

    while (bfsQueue.length > 0) {
        const { id, dir } = bfsQueue.shift();
        const gen = genOf[id];

        // พ่อ/แม่ → gen + 1 (บรรพบุรุษ) — เฉพาะเมื่อทิศทางเป็น 'up' หรือ 'both'
        if (dir !== 'down' && gen < MAX_ANCESTOR_DEPTH) {
            [fatherOf[id], motherOf[id]].filter(Boolean).forEach(pid => {
                if (!bfsVisited.has(pid)) {
                    bfsVisited.add(pid);
                    genOf[pid] = gen + 1;
                    bfsQueue.push({ id: pid, dir: 'up' });
                }
            });
        }

        // ลูก → gen - 1 (ลูกหลาน) — เฉพาะเมื่อทิศทางเป็น 'down' หรือ 'both'
        if (dir !== 'up' && gen > -MAX_DESCENDANT_DEPTH) {
            (childrenOf[id] || []).forEach(cid => {
                if (!bfsVisited.has(cid)) {
                    bfsVisited.add(cid);
                    genOf[cid] = gen - 1;
                    bfsQueue.push({ id: cid, dir: 'down' });
                }
                // เพิ่มพ่อ/แม่อีกฝ่ายของลูก (คู่สมรส) ในลำดับเดียวกับ node ปัจจุบัน
                [fatherOf[cid], motherOf[cid]].filter(pid => pid && pid !== id).forEach(pid => {
                    if (!bfsVisited.has(pid)) {
                        bfsVisited.add(pid);
                        genOf[pid] = gen;
                        // ไม่เพิ่มลงคิว — แสดงเฉพาะ node ไม่ขยายต่อ
                    }
                });
            });
        }
    }

    // ─── สร้าง node objects และเชื่อมโยงความสัมพันธ์ ───
    const nodeMap = new Map(); // id → node
    bfsVisited.forEach(id => {
        nodeMap.set(id, { id, gen: genOf[id], slot: 0, father: null, mother: null, children: [] });
    });
    nodeMap.forEach((node, id) => {
        if (fatherOf[id] && nodeMap.has(fatherOf[id])) node.father = nodeMap.get(fatherOf[id]);
        if (motherOf[id] && nodeMap.has(motherOf[id])) node.mother = nodeMap.get(motherOf[id]);
        (childrenOf[id] || []).forEach(cid => {
            if (nodeMap.has(cid)) node.children.push(nodeMap.get(cid));
        });
    });

    // ─── กำหนด slot (ตำแหน่ง Y) โดยประมวลผลจาก generation ลูกหลาน → root → บรรพบุรุษ ───
    // ลูกหลานได้ slot ก่อน แล้วบรรพบุรุษจะได้ค่าเฉลี่ยจากลูก
    const allGens  = [...new Set(Object.values(genOf))].sort((a, b) => a - b);
    let leafSlot   = 0;
    const slotDone = new Set();

    allGens.forEach(gen => {
        nodeMap.forEach(node => {
            if (node.gen !== gen || slotDone.has(node.id)) return;
            slotDone.add(node.id);

            const slots = [];
            // รวม slot ของลูกที่ประมวลผลแล้ว (gen ต่ำกว่า → ประมวลผลก่อน)
            node.children.forEach(c => { if (slotDone.has(c.id)) slots.push(c.slot); });
            // รวม slot ของพ่อแม่ที่ประมวลผลแล้วด้วย (เช่น กรณีประมวลผลบรรพบุรุษก่อน)
            if (node.father && slotDone.has(node.father.id)) slots.push(node.father.slot);
            if (node.mother && slotDone.has(node.mother.id)) slots.push(node.mother.slot);

            node.slot = slots.length > 0
                ? slots.reduce((s, v) => s + v, 0) / slots.length
                : leafSlot++;
        });
    });

    // ─── แก้ไข slot ซ้ำกันภายใน generation เดียวกัน ───
    // จัดเรียง node ในแต่ละ gen ตาม slot แล้วให้ระยะห่างขั้นต่ำ 1 ระหว่างกัน
    const genGroups = {};
    nodeMap.forEach(n => {
        if (!genGroups[n.gen]) genGroups[n.gen] = [];
        genGroups[n.gen].push(n);
    });
    Object.values(genGroups).forEach(nodes => {
        nodes.sort((a, b) => a.slot - b.slot);
        for (let i = 1; i < nodes.length; i++) {
            if (nodes[i].slot < nodes[i - 1].slot + 1) {
                nodes[i].slot = nodes[i - 1].slot + 1;
            }
        }
    });

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

    // ─── แปลง gen / slot → พิกัด pixel ───
    // offset minGen เพื่อให้ gen ลบ (ลูกหลาน) อยู่ทางซ้ายและ X ไม่ติดลบ
    let minGen = 0;
    nodeMap.forEach(n => { if (n.gen < minGen) minGen = n.gen; });

    const genToX  = gen => PAD + (gen - minGen) * GEN_W;
    const slotToY = s   => PAD + s * SLOT_H;

    nodeMap.forEach(node => {
        node.x = genToX(node.gen);
        node.y = slotToY(node.slot);
    });

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
    svgEl.style.height = '100%';
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

    const cw    = container.clientWidth  || 800;
    const ch    = container.clientHeight || 600;
    const scale = (svgW > 0 && svgH > 0)
        ? Math.min(1, (cw - 2 * PAD) / svgW, (ch - 2 * PAD) / svgH)
        : 1;
    zoom.transform(svg, d3.zoomIdentity.translate(PAD, PAD).scale(scale));

    // เก็บ reference สำหรับปุ่ม zoom controls (treeZoomIn / treeZoomOut / treeZoomReset)
    window._treeSvg  = svg;
    window._treeZoom = zoom;

    // ─── วาด Elbow Lines (เส้นหักมุม) ก่อนวาดการ์ด เพื่อให้อยู่ด้านหลัง ───
    // เส้นเชื่อมจะลาก: ขอบขวาของ node (gen ต่ำ) → ขอบซ้ายของพ่อ/แม่ (gen สูงกว่า)
    const drawnLines = new Set();

    function drawLines(node) {
        if (!node || drawnLines.has(node.id)) return;
        drawnLines.add(node.id);

        const parents = [node.father, node.mother].filter(Boolean);
        if (parents.length) {
            const srcX = node.x + NODE_W;     // ขอบขวาของการ์ด
            const srcY = node.y + NODE_H / 2; // กึ่งกลาง Y ของการ์ด
            const jctX = srcX + H_GAP / 2;    // X จุดเชื่อม (junction) กึ่งกลางช่องว่าง

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
        }

        node.children.forEach(c => drawLines(c));
        drawLines(node.father);
        drawLines(node.mother);
    }

    nodeMap.forEach(node => drawLines(node));

    // ─── วาด Node Cards ───
    const drawnNodes = new Set();

    function drawNode(node) {
        if (!node || drawnNodes.has(node.id)) return;
        drawnNodes.add(node.id);

        const member = byId[node.id];
        if (!member) return;

        const isRoot   = node.id === rootId;
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

        node.children.forEach(c => drawNode(c));
        drawNode(node.father);
        drawNode(node.mother);
    }

    nodeMap.forEach(node => drawNode(node));
}
