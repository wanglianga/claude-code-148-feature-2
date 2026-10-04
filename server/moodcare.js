// 产妇情绪异常关怀：敏感记录的双来源采集、社区安排、回访追踪与权限保护
// 可见范围约定：护士/社区医生可见全部字段；家属端仅见必要提醒（familyMoodReminder），
// 量表分、自伤想法、风险来源与双来源冲突从不下发给家属端。
import db, { addEvent } from './db.js'

export const MOOD_ACTIONS = ['心理咨询', '增加电话回访', '转妇保门诊']
export const RISK_FACTORS = ['照护压力', '睡眠不足', '家庭支持不足']

// 敏感事件类型：家属端查询档案时间线时过滤
export const SENSITIVE_EVENT_KINDS = ['情绪关怀', '情绪回访', '心理咨询', '转妇保门诊']

const CRYING_SEV = { 无: 0, 偶尔: 1, 持续: 2 }
const MOOD_TEXT_SEV = { 平稳: 0, 烦躁: 1, 低落: 2, 经常哭泣: 2 }
const SLEEP_SEV = { 正常: 0, 入睡困难: 1, 易醒: 2, 严重失眠: 3 }
const SUPPORT_SEV = { 良好: 0, 一般: 1, 不足: 2, 充足: 0, 紧张: 1 }

/** 风险来源推断：照护压力 / 睡眠不足 / 家庭支持不足 */
export function inferRiskFactors(c) {
  const out = new Set(Array.isArray(c.risk_factors) ? c.risk_factors : [])
  const crying = c.persistent_crying || '无'
  const sleep = c.sleep_quality || '正常'
  const support = c.family_support || ''
  const hands = c.care_hands || ''
  const moodText = c.mood_text || ''
  if (crying !== '无' || ['烦躁', '低落', '经常哭泣'].includes(moodText)) out.add('照护压力')
  if (sleep !== '正常') out.add('睡眠不足')
  if (support === '不足' || hands === '不足') out.add('家庭支持不足')
  return [...out].filter((x) => RISK_FACTORS.includes(x))
}

/** 敏感等级：用于列表徽标与自动安排强度 */
export function careSeverity(c) {
  if (c.self_harm === '持续') return 3
  if (c.self_harm === '偶有') return 2
  const epds = c.epds_score ?? 0
  if (epds >= 13) return 2
  if (epds >= 10 || c.persistent_crying === '持续' || c.sleep_quality === '严重失眠') return 1
  return 0
}
export const SEVERITY_LABEL = ['低', '中', '高', '危急']

function openSensitiveFollowup(archiveId, type, title, detail, visitId, createdBy) {
  db.prepare(`INSERT INTO followups (archive_id, visit_id, type, title, detail, created_by, sensitive)
              VALUES (?,?,?,?,?,?,1)`).run(archiveId, visitId ?? null, type, title, detail, createdBy)
  // 事件类型统一归入敏感类（情绪回访/心理咨询/转妇保门诊），家属端时间线不可见
  const kind = ['心理咨询', '转妇保门诊'].includes(type) ? type : '情绪回访'
  addEvent(archiveId, kind, title, detail, createdBy)
}

/** 按严重程度自动安排社区关怀措施（敏感随访事项） */
function autoArrange(care, actor) {
  const sev = careSeverity(care)
  const actions = []
  if (sev >= 3) actions.push('转妇保门诊', '心理咨询', '增加电话回访')
  else if (sev >= 2) actions.push('心理咨询', '增加电话回访')
  else if (sev >= 1) actions.push('增加电话回访')
  for (const a of actions) arrangeOne(care, a, '系统按情绪关怀风险自动生成', actor)
  return actions
}

function arrangeOne(care, action, note, actor) {
  const typeMap = { 心理咨询: '心理咨询', 增加电话回访: '电话随访', 转妇保门诊: '转妇保门诊' }
  const titleMap = {
    心理咨询: '安排心理咨询（产妇情绪关怀）',
    增加电话回访: '增加电话回访（产妇情绪关怀）',
    转妇保门诊: '转妇幼保健门诊（产妇情绪关怀）',
  }
  db.prepare(`INSERT INTO mood_care_logs (care_id, kind, action, note, created_by) VALUES (?,?,?,?,?)`)
    .run(care.id, '安排', action, note || '', actor)
  openSensitiveFollowup(care.archive_id, typeMap[action], titleMap[action],
    note || `情绪关怀 #${care.id} 安排：${action}`, care.visit_id, actor)
}

/**
 * 建立情绪关怀记录（双来源）：
 *  - 护士访视（source=nurse_visit）：量表分、家属支持、自伤想法、风险来源、建议
 *  - 家属代填（source=family_report）：情绪、睡眠、照护人手（不含量表/自伤等敏感评估）
 */
export function createMoodCare(payload, user, { source, visitId = null } = {}) {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(payload.archive_id)
  if (!archive) throw Object.assign(new Error('母婴档案不存在'), { status: 404 })

  const isFamily = source === 'family_report'
  const c = {
    archive_id: archive.id,
    visit_id: visitId,
    source,
    persistent_crying: isFamily
      ? (payload.mood_text === '经常哭泣' ? '持续' : '无')
      : (payload.persistent_crying || '无'),
    sleep_quality: payload.sleep_quality || '正常',
    epds_score: isFamily ? null : (payload.epds_score === '' || payload.epds_score == null ? null : Number(payload.epds_score)),
    family_support: isFamily ? '' : (payload.family_support || '良好'),
    care_hands: isFamily ? (payload.care_hands || '充足') : '',
    self_harm: isFamily ? '无' : (payload.self_harm || '无'),
    risk_factors: '[]',
    mood_text: isFamily ? (payload.mood_text || '平稳') : (payload.mood_text || ''),
    advice: isFamily ? '' : String(payload.advice || ''),
    note: String(payload.note || ''),
    created_by: user?.name || '系统',
  }
  c.risk_factors = JSON.stringify(inferRiskFactors({
    ...c,
    risk_factors: Array.isArray(payload.risk_factors) ? payload.risk_factors : [],
  }))

  const info = db.prepare(`INSERT INTO mood_cares
    (archive_id, visit_id, source, persistent_crying, sleep_quality, epds_score, family_support,
     care_hands, self_harm, risk_factors, mood_text, advice, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.archive_id, c.visit_id, c.source, c.persistent_crying, c.sleep_quality, c.epds_score,
      c.family_support, c.care_hands, c.self_harm, c.risk_factors, c.mood_text, c.advice, c.note, c.created_by)
  const care = db.prepare('SELECT * FROM mood_cares WHERE id=?').get(info.lastInsertRowid)

  const srcLabel = isFamily ? '家属代填' : '护士访视·产妇自述'
  addEvent(archive.id, '情绪关怀', `建立情绪关怀记录（${srcLabel}）`,
    isFamily
      ? `家属代填：情绪${c.mood_text}、睡眠${c.sleep_quality}、照护人手${c.care_hands}`
      : `量表 EPDS ${c.epds_score ?? '未评'}，睡眠${c.sleep_quality}，家属支持${c.family_support}，风险来源：${JSON.parse(c.risk_factors).join('、') || '无'}`,
    c.created_by)

  // 仅护士评估来源触发自动安排；家属代填不自动升级，待护士核对
  const auto = isFamily ? [] : autoArrange(care, c.created_by)
  return { care, autoActions: auto }
}

/** 社区安排：心理咨询 / 增加电话回访 / 转妇保门诊 */
export function arrangeActions(careId, actions, note, user) {
  const care = db.prepare('SELECT * FROM mood_cares WHERE id=?').get(careId)
  if (!care) throw Object.assign(new Error('情绪关怀记录不存在'), { status: 404 })
  const list = (Array.isArray(actions) ? actions : []).filter((a) => MOOD_ACTIONS.includes(a))
  if (!list.length) throw Object.assign(new Error('请选择至少一项关怀措施'), { status: 400 })
  for (const a of list) arrangeOne(care, a, note, user?.name || '系统')
  addEvent(care.archive_id, '情绪关怀', `社区安排：${list.join('、')}`, note || '', user?.name || '系统')
  return list
}

/** 回访追踪：情绪变化（好转/平稳/加重）+ 是否接受帮助 */
export function addTrack(careId, payload, user) {
  const care = db.prepare('SELECT * FROM mood_cares WHERE id=?').get(careId)
  if (!care) throw Object.assign(new Error('情绪关怀记录不存在'), { status: 404 })
  const moodChange = payload.mood_change || ''
  const helpAccepted = payload.help_accepted || ''
  if (!['好转', '平稳', '加重'].includes(moodChange)) throw Object.assign(new Error('请选择情绪变化'), { status: 400 })
  if (!['已接受', '部分接受', '未接受'].includes(helpAccepted)) throw Object.assign(new Error('请选择是否接受帮助'), { status: 400 })
  db.prepare(`INSERT INTO mood_care_logs (care_id, kind, mood_change, help_accepted, note, created_by)
              VALUES (?,?,?,?,?,?)`)
    .run(careId, '回访', moodChange, helpAccepted, String(payload.note || ''), user?.name || '系统')
  addEvent(care.archive_id, '情绪回访', `情绪关怀回访：情绪${moodChange}，帮助${helpAccepted}`,
    String(payload.note || ''), user?.name || '系统')
}

/** 关怀闭环：敏感记录保留，按角色区分可见范围 */
export function closeMoodCare(careId, note, user) {
  const care = db.prepare('SELECT * FROM mood_cares WHERE id=?').get(careId)
  if (!care) throw Object.assign(new Error('情绪关怀记录不存在'), { status: 404 })
  if (care.status !== '已闭环') {
    db.prepare(`UPDATE mood_cares SET status='已闭环', closed_at=datetime('now','localtime'),
                closed_by=?, close_note=? WHERE id=?`).run(user?.name || '系统', String(note || ''), careId)
    addEvent(care.archive_id, '情绪关怀', '情绪关怀已闭环', String(note || ''), user?.name || '系统')
  }
  return db.prepare('SELECT * FROM mood_cares WHERE id=?').get(careId)
}

/** 查询某档案的全部关怀记录（含过程日志）+ 双来源冲突检测 —— 仅护士/社区医生 */
export function listMoodCares(archiveId) {
  const cares = db.prepare('SELECT * FROM mood_cares WHERE archive_id=? ORDER BY created_at DESC, id DESC').all(archiveId)
    .map((c) => ({
      ...c,
      risk_factors: JSON.parse(c.risk_factors || '[]'),
      severity: SEVERITY_LABEL[careSeverity(c)],
      logs: db.prepare('SELECT * FROM mood_care_logs WHERE care_id=? ORDER BY created_at, id').all(c.id),
    }))
  return { cares, conflicts: detectConflicts(cares), riskSources: collectRiskSources(cares) }
}

function collectRiskSources(cares) {
  const set = new Set()
  for (const c of cares) for (const f of c.risk_factors) set.add(f)
  return [...set]
}

/**
 * 家属代填与产妇自述冲突检测：保留两份来源与采集时间，
 * 供后续心理咨询 / 妇保门诊判断风险来自照护压力、睡眠不足还是家庭支持不足。
 */
export function detectConflicts(cares) {
  const nurse = cares.find((c) => c.source === 'nurse_visit')
  const family = cares.find((c) => c.source === 'family_report')
  if (!nurse || !family) return []
  const conflicts = []
  const dim = (dimension, nurseValue, familyValue, sevA, sevB) => {
    const a = sevA[nurseValue] ?? 0
    const b = sevB[familyValue] ?? 0
    if ((Math.min(a, b) === 0 && Math.max(a, b) >= 1) || Math.abs(a - b) >= 2) {
      conflicts.push({
        dimension,
        nurseValue, nurseTime: nurse.created_at, nurseSource: '护士访视·产妇自述',
        familyValue, familyTime: family.created_at, familySource: '家属代填',
      })
    }
  }
  dim('情绪状态', nurse.persistent_crying === '无' ? '无哭泣' : `${nurse.persistent_crying}哭泣`,
    family.mood_text || '平稳',
    { 无哭泣: 0, 偶尔哭泣: 1, 持续哭泣: 2 }, MOOD_TEXT_SEV)
  dim('睡眠情况', nurse.sleep_quality, family.sleep_quality, SLEEP_SEV, SLEEP_SEV)
  if (nurse.family_support && family.care_hands) {
    dim('家庭支持', nurse.family_support, family.care_hands, SUPPORT_SEV, SUPPORT_SEV)
  }
  return conflicts
}

/** 家属端唯一可见的情绪关怀内容：必要提醒（不含量表/自伤/冲突等敏感信息） */
export function familyMoodReminder(archiveId) {
  const active = db.prepare(`SELECT id FROM mood_cares WHERE archive_id=? AND status='关怀中'`).all(archiveId)
  if (!active.length) return null
  const actions = db.prepare(`
    SELECT DISTINCT l.action FROM mood_care_logs l JOIN mood_cares c ON c.id=l.care_id
    WHERE c.archive_id=? AND l.kind='安排'`).all(archiveId).map((r) => r.action)
  const parts = []
  if (actions.includes('心理咨询')) parts.push('社区已为您预约心理咨询，请留意电话通知')
  if (actions.includes('增加电话回访')) parts.push('社区护士会增加电话回访，请保持电话畅通')
  if (actions.includes('转妇保门诊')) parts.push('建议按约定时间到妇幼保健门诊就诊')
  return {
    active: true,
    actions,
    reminder: `妈妈最近辛苦了，请家人多陪伴、多分担夜间照护，保证妈妈休息与营养。${parts.join('；')}`,
  }
}
