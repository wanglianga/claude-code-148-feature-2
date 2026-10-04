// 产妇情绪异常关怀：EPDS 量表评分、双来源（产妇自述/家属代述）冲突核对、
// 风险归因、处置行动（心理咨询/增加电话回访/转妇保门诊）、回访追踪与按角色脱敏
// 前端 client/src/mood.ts 与本文件同构（家属代述端实时给出反馈）
import db, { addEvent } from './db.js'

// EPDS（爱丁堡产后抑郁量表）10 题，每题 0~3 分
export const EPDS_QUESTIONS = [
  '我能看到事情有趣的一面，并能开怀大笑',
  '我怀着愉快的心情期待事情',
  '当事情出错时，我会毫无必要地责备自己',
  '我会无缘无故地感到焦虑或担心',
  '我会无缘无故地感到害怕或惊慌',
  '很多事情涌向我，使我透不过气来',
  '我难以入睡，因为心里总想着事',
  '我感到悲伤或痛苦',
  '我很不开心，甚至哭泣',
  '我曾想过要伤害自己',
]
// 第 3、4、5、6、7、8、9、10 题为反向计分（选项按严重度排列），1、2 题为正向
const POSITIVE_ITEMS = new Set([1, 2])

export function epdsScore(detail) {
  const arr = Array.isArray(detail) ? detail : []
  let total = 0
  for (const { q, a } of arr) {
    const n = Number(a)
    if (!Number.isInteger(n) || n < 0 || n > 3) continue
    total += POSITIVE_ITEMS.has(Number(q)) ? 3 - n : n
  }
  return total
}

export function selfHarmFrom(detail) {
  const item = (Array.isArray(detail) ? detail : []).find((x) => Number(x.q) === 10)
  if (!item) return 0
  // 第 10 题反向计分：选 1/2/3（偶尔/有时/经常）均提示有自伤想法
  return Number(item.a) >= 1 ? 1 : 0
}

// 评分 → 分级与处置建议
export function epdsLevel(score, selfHarm) {
  if (selfHarm || score >= 13) {
    return {
      level: '高',
      summary: selfHarm
        ? `EPDS ${score} 分，第 10 题提示有自伤想法（紧急风险）`
        : `EPDS ${score} 分，达到 13 分高分线`,
      advice: selfHarm
        ? '产妇存在自伤想法，属紧急心理关怀风险：确保 24 小时有人陪伴、移除危险物品，立即联系妇保门诊/心理危机干预热线，必要时转精神专科评估。'
        : 'EPDS 评分偏高，建议安排心理咨询并转妇保门诊进一步评估，本周内增加电话回访。',
      plans: selfHarm ? ['转妇保门诊', '增加电话回访', '心理咨询'] : ['心理咨询', '增加电话回访', '转妇保门诊'],
    }
  }
  if (score >= 9) {
    return {
      level: '中',
      summary: `EPDS ${score} 分，提示产后情绪困扰（9~12 分）`,
      advice: 'EPDS 提示产后情绪困扰，建议安排心理咨询并增加电话回访，1~2 周后复评。',
      plans: ['心理咨询', '增加电话回访'],
    }
  }
  return {
    level: '低',
    summary: `EPDS ${score} 分，暂未见明显抑郁倾向（0~8 分）`,
    advice: 'EPDS 在正常范围，结合持续哭泣/睡眠情况给予情绪疏导与家庭支持指导，常规回访观察。',
    plans: ['增加电话回访'],
  }
}

export const RISK_FACTOR_LABELS = ['照护压力', '睡眠不足', '家庭支持不足']
export const PLAN_LABELS = ['心理咨询', '增加电话回访', '转妇保门诊']

const WRITE_FIELDS = ['recorded_at', 'epds_detail', 'crying', 'sleep_quality', 'family_support',
  'self_harm', 'self_harm_note', 'care_pressure', 'risk_factors', 'suggestion', 'family_notice',
  'nurse_note', 'followup_plan', 'care_status', 'mood_trend', 'source', 'reporter_id',
  'reporter_name', 'recorded_by', 'visit_id']

function normalizePayload(p = {}) {
  const detail = Array.isArray(p.epds_detail)
    ? p.epds_detail.map((x) => ({ q: Number(x.q), a: Number(x.a) })).filter((x) => x.q >= 1 && x.q <= 10)
    : []
  const factors = (Array.isArray(p.risk_factors) ? p.risk_factors : []).filter((x) => RISK_FACTOR_LABELS.includes(x) || x === '其他')
  const plans = (Array.isArray(p.followup_plan) ? p.followup_plan : []).filter((x) => PLAN_LABELS.includes(x))
  return {
    recorded_at: p.recorded_at ? String(p.recorded_at).replace('T', ' ').slice(0, 16) : null,
    epds_detail: JSON.stringify(detail),
    epds_score: detail.length ? epdsScore(detail) : (p.epds_score != null ? Number(p.epds_score) : null),
    self_harm: p.self_harm ? 1 : selfHarmFrom(detail),
    crying: p.crying ? 1 : 0,
    sleep_quality: p.sleep_quality || '',
    family_support: p.family_support || '',
    self_harm_note: String(p.self_harm_note || ''),
    care_pressure: String(p.care_pressure || ''),
    risk_factors: JSON.stringify(factors),
    suggestion: String(p.suggestion || ''),
    family_notice: String(p.family_notice || ''),
    nurse_note: String(p.nurse_note || ''),
    followup_plan: JSON.stringify(plans),
    care_status: p.care_status || '',
    mood_trend: p.mood_trend || '',
    source: p.source === '家属代述' ? '家属代述' : '产妇自述',
    reporter_id: p.reporter_id ?? null,
    reporter_name: String(p.reporter_name || ''),
    recorded_by: String(p.recorded_by || ''),
    visit_id: p.visit_id ?? null,
    detail, factors, plans,
  }
}

function hydrate(row) {
  if (!row) return row
  const parseArr = (s) => { try { return JSON.parse(s || '[]') } catch { return [] } }
  return {
    ...row,
    epds_detail: parseArr(row.epds_detail),
    risk_factors: parseArr(row.risk_factors),
    followup_plan: parseArr(row.followup_plan),
  }
}

// 双来源冲突核对：同档案内、采集时间相差 ≤7 天的跨来源记录，关键字段不一致即标记
export function detectConflicts(archiveId, selfId) {
  const all = db.prepare('SELECT * FROM mood_records WHERE archive_id=? ORDER BY recorded_at').all(archiveId).map(hydrate)
  for (const r of all) db.prepare('UPDATE mood_records SET conflict_with=NULL, conflict_note=? WHERE id=?').run('', r.id)
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]
      if (a.source === b.source) continue
      const dayGap = Math.abs(new Date(b.recorded_at.replace(' ', 'T')) - new Date(a.recorded_at.replace(' ', 'T'))) / 86400000
      if (dayGap > 7) continue
      const diffs = conflictDiffs(a, b)
      if (diffs.length) {
        db.prepare('UPDATE mood_records SET conflict_with=?, conflict_note=? WHERE id=?')
          .run(b.id, `与${a.source}（${a.recorded_at}）存在不一致：${diffs.join('、')}`, a.id)
        db.prepare('UPDATE mood_records SET conflict_with=?, conflict_note=? WHERE id=?')
          .run(a.id, `与${b.source}（${b.recorded_at}）存在不一致：${diffs.join('、')}`, b.id)
      }
    }
  }
  return selfId ? hydrate(db.prepare('SELECT * FROM mood_records WHERE id=?').get(selfId)) : null
}

function conflictDiffs(a, b) {
  const diffs = []
  if (a.self_harm !== b.self_harm) diffs.push('自伤想法')
  if (a.crying !== b.crying) diffs.push('持续哭泣')
  if (!!a.epds_score !== !!b.epds_score ? false : a.epds_score != null && b.epds_score != null && Math.abs(a.epds_score - b.epds_score) >= 5) {
    diffs.push(`EPDS 评分差 ${Math.abs(a.epds_score - b.epds_score)} 分`)
  }
  if (a.family_support && b.family_support && a.family_support !== b.family_support) diffs.push('家属支持评价')
  if (a.sleep_quality && b.sleep_quality && a.sleep_quality !== b.sleep_quality) diffs.push('睡眠情况')
  return diffs
}

/**
 * 护士在访视/关怀中心创建一条产妇自述情绪记录：评分 → 落库 → 生成处置行动随访事项 → 冲突核对 → 时间线
 */
export function createMoodRecord(archiveId, payload, nurse) {
  const archive = db.prepare('SELECT * FROM archives WHERE id=?').get(archiveId)
  if (!archive) throw Object.assign(new Error('母婴档案不存在'), { status: 404 })
  const v = normalizePayload({ ...payload, source: '产妇自述', reporter_id: null, recorded_by: nurse?.name || payload.recorded_by || '护士' })
  if (!v.recorded_at) throw Object.assign(new Error('缺少采集时间'), { status: 400 })

  const score = v.epds_score
  const grade = score != null ? epdsLevel(score, v.self_harm) : null
  const plans = v.plans.length ? v.plans : (grade ? grade.plans : [])
  const factorsTxt = v.factors.length ? `风险归因：${v.factors.join('、')}。` : ''
  const sleepTxt = v.sleep_quality ? `睡眠${v.sleep_quality}。` : ''
  const supportTxt = v.family_support ? `家属支持${v.family_support}。` : ''
  const cryTxt = v.crying ? '持续哭泣。' : ''

  const info = db.prepare(`INSERT INTO mood_records
    (archive_id, visit_id, source, reporter_id, reporter_name, recorded_by, recorded_at,
     epds_score, epds_detail, crying, sleep_quality, family_support, self_harm, self_harm_note,
     care_pressure, risk_factors, suggestion, family_notice, nurse_note, status, followup_plan)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    archiveId, v.visit_id, v.source, null, '', v.recorded_by, v.recorded_at,
    score, v.epds_detail, v.crying, v.sleep_quality, v.family_support, v.self_harm, v.self_harm_note,
    v.care_pressure, v.risk_factors, v.suggestion, v.family_notice, v.nurse_note, '进行中', JSON.stringify(plans))
  const id = info.lastInsertRowid

  // 处置行动 → 敏感随访事项（家属端仅展示 family_title 的温和提醒）
  const clinical = `${grade ? grade.summary + '。' : ''}${cryTxt}${sleepTxt}${supportTxt}${factorsTxt}` +
    (v.self_harm_note ? `自伤想法说明：${v.self_harm_note}。` : '')
  for (const plan of plans) openMoodFollowup(archiveId, id, plan, clinical.trim(), v.recorded_by, v.self_harm)

  const saved = detectConflicts(archiveId, id)
  // 护士已上门核实：7 天内的待核实家属代述并入本轮关怀
  db.prepare(`UPDATE mood_records SET status='进行中' WHERE archive_id=? AND source='家属代述'
              AND status='待核实' AND abs(julianday(recorded_at)-julianday(COALESCE(?, recorded_at)))<=7`)
    .run(archiveId, v.recorded_at)
  addEvent(archiveId, '情绪关怀', `记录产妇情绪关怀（${grade ? grade.level : '未评分'}风险${v.self_harm ? '·有自伤想法' : ''}）`,
    clinical, v.recorded_by)
  return { mood: serializeFor(saved, 'nurse'), grade: grade ? { ...grade, plans } : null }
}

// 家属代述：护士上门前家属通过家属端反馈的观察，等待护士核实
export function createFamilyReport(archiveId, payload, familyUser) {
  const v = normalizePayload({
    ...payload,
    source: '家属代述',
    reporter_id: familyUser.id,
    reporter_name: familyUser.name,
    recorded_by: familyUser.name,
    family_notice: '', nurse_note: '', suggestion: '', followup_plan: [],
  })
  if (!v.recorded_at) v.recorded_at = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const info = db.prepare(`INSERT INTO mood_records
    (archive_id, source, reporter_id, reporter_name, recorded_by, recorded_at,
     epds_score, epds_detail, crying, sleep_quality, family_support, self_harm, self_harm_note,
     care_pressure, risk_factors, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    archiveId, v.source, v.reporter_id, v.reporter_name, v.recorded_by, v.recorded_at,
    v.epds_score, v.epds_detail, v.crying, v.sleep_quality, v.family_support, v.self_harm, v.self_harm_note,
    v.care_pressure, v.risk_factors, '待核实')
  const id = info.lastInsertRowid
  const saved = detectConflicts(archiveId, id)
  addEvent(archiveId, '情绪关怀', '家属代述产妇情绪观察（待护士核实）',
    `持续哭泣${v.crying ? '是' : '否'}，睡眠${v.sleep_quality || '未填'}，家属支持${v.family_support || '未填'}`, v.recorded_by)
  return { mood: serializeFor(saved, 'family') }
}

const PLAN_FOLLOWUP = {
  心理咨询: { title: '安排产妇心理咨询', familyTitle: '社区可为妈妈安排免费心理咨询，如有需要请向护士报名' },
  增加电话回访: { title: '增加产妇情绪电话回访', familyTitle: '' }, // 纯内部关怀动作，不打扰家属
  转妇保门诊: { title: '转妇保门诊情绪关怀评估', familyTitle: '建议陪同妈妈到妇保门诊做一次产后情绪关怀评估' },
}
export const MOOD_PLAN_TYPES = Object.keys(PLAN_FOLLOWUP)

export function isMoodPlan(type) { return !!PLAN_FOLLOWUP[type] }
export function planFamilyTitle(type) { return PLAN_FOLLOWUP[type]?.familyTitle || '' }

// 医生决策等场景：按情绪处置行动补开敏感随访事项（已存在同类型开放事项则跳过）
export function ensurePlanFollowup(archiveId, plan, createdBy, detail = '', moodId = null, urgent = false) {
  const conf = PLAN_FOLLOWUP[plan]
  if (!conf) return null
  const exists = db.prepare(`SELECT id FROM followups WHERE archive_id=? AND type=? AND status!='已闭环'`).get(archiveId, plan)
  if (exists) return exists
  const info = db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by, sensitive, family_title)
              VALUES (?,?,?,?,?,?,?)`)
    .run(archiveId, plan, (urgent ? '【紧急】' : '') + conf.title,
      detail || `来源：情绪关怀${moodId ? ' #' + moodId : ''}`, createdBy, 1, conf.familyTitle)
  return db.prepare('SELECT * FROM followups WHERE id=?').get(info.lastInsertRowid)
}

function openMoodFollowup(archiveId, moodId, plan, clinical, createdBy, urgent) {
  const conf = PLAN_FOLLOWUP[plan]
  if (!conf) return
  const exists = db.prepare(`SELECT id FROM followups WHERE archive_id=? AND type=? AND status!='已闭环'`).get(archiveId, plan)
  if (exists) return
  db.prepare(`INSERT INTO followups (archive_id, type, title, detail, created_by, sensitive, family_title)
              VALUES (?,?,?,?,?,?,?)`)
    .run(archiveId, plan, (urgent && plan === '转妇保门诊' ? '【紧急】' : '') + conf.title,
      `来源情绪关怀记录 #${moodId}。${clinical}`, createdBy, 1, conf.familyTitle)
}

/** 回访追踪：记录情绪变化与是否接受帮助；可追加行动；末次回访后可结束关怀 */
export function followUpMood(id, payload, nurse) {
  const row = db.prepare('SELECT * FROM mood_records WHERE id=?').get(id)
  if (!row) throw Object.assign(new Error('情绪关怀记录不存在'), { status: 404 })
  const careStatus = ['未联系', '已拒绝', '考虑中', '已接受'].includes(payload.care_status) ? payload.care_status : row.care_status
  const trend = ['好转', '持平', '加重'].includes(payload.mood_trend) ? payload.mood_trend : row.mood_trend
  const addPlans = (Array.isArray(payload.followup_plan) ? payload.followup_plan : []).filter((x) => PLAN_LABELS.includes(x))
  const existPlans = JSON.parse(row.followup_plan || '[]')
  const plans = [...new Set([...existPlans, ...addPlans])]
  let nurseNote = row.nurse_note || ''
  const note = String(payload.note || '').trim()
  if (note) {
    const stamp = `${nurse?.name || '护士'} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    nurseNote = `${nurseNote}${nurseNote ? '\n' : ''}${note}【${stamp}】`
  }
  db.prepare(`UPDATE mood_records SET care_status=?, mood_trend=?, followup_plan=?, nurse_note=?, status='进行中' WHERE id=?`)
    .run(careStatus, trend, JSON.stringify(plans), nurseNote, id)

  const archiveId = row.archive_id
  for (const plan of addPlans) {
    const exists = db.prepare(`SELECT id FROM followups WHERE archive_id=? AND type=? AND status!='已闭环'`).get(archiveId, plan)
    if (!exists) {
      openMoodFollowup(archiveId, id, plan, `回访 #${id} 追加行动：${trend}/${careStatus}`, nurse?.name || '护士', 0)
    }
  }
  addEvent(archiveId, '情绪关怀', `情绪关怀回访：情绪${trend || '-'}，帮助接受情况${careStatus || '-'}`,
    String(payload.note || ''), nurse?.name || '护士')
  return { mood: serializeFor(hydrate(db.prepare('SELECT * FROM mood_records WHERE id=?').get(id)), 'nurse') }
}

export function closeMoodCare(id, nurse, note = '') {
  const row = db.prepare('SELECT * FROM mood_records WHERE id=?').get(id)
  if (!row) return null
  // 同档案 7 天窗口内、同一关怀轮次的记录一并结束（保留双来源历史，状态置为已结束）
  db.prepare(`UPDATE mood_records SET status='已结束'
              WHERE id=? OR (archive_id=? AND status!='已结束'
                AND abs(julianday(recorded_at)-julianday(?))<=7)`)
    .run(id, row.archive_id, row.recorded_at)
  // 同步闭环本轮情绪处置行动（不含通用的黄疸「电话随访」）
  for (const f of db.prepare(`SELECT * FROM followups WHERE archive_id=? AND status!='已闭环' AND type IN (?,?,?)`)
    .all(row.archive_id, ...MOOD_PLAN_TYPES)) {
    db.prepare(`UPDATE followups SET status='已闭环', closed_at=datetime('now','localtime'), closed_by=?, close_note=? WHERE id=?`)
      .run(nurse?.name || '护士', `本轮情绪关怀结束：${note}`, f.id)
  }
  addEvent(row.archive_id, '情绪关怀', '结束本轮情绪关怀', note, nurse?.name || '护士')
  return hydrate(row)
}

export function getMoodRecords(archiveId) {
  return db.prepare('SELECT * FROM mood_records WHERE archive_id=? ORDER BY recorded_at DESC, id DESC').all(archiveId).map(hydrate)
}

// 护士关怀中心列表
export function moodCareList() {
  const rows = db.prepare(`
    SELECT m.*, ar.mother_name, ar.baby_name, ar.address, ar.contact_name, ar.contact_phone
    FROM mood_records m JOIN archives ar ON ar.id=m.archive_id
    WHERE m.status!='已结束'
    ORDER BY (m.recorded_at) DESC`).all()
  // 按档案聚合，保留每份记录（双来源都要看到）
  const groups = new Map()
  for (const r of rows) {
    const key = r.archive_id
    if (!groups.has(key)) {
      groups.set(key, {
        archive_id: r.archive_id, mother_name: r.mother_name, baby_name: r.baby_name,
        address: r.address, contact_name: r.contact_name, contact_phone: r.contact_phone,
        records: [], latest: null,
      })
    }
    const g = groups.get(key)
    g.records.push(hydrate(r))
  }
  for (const g of groups.values()) {
    // 待核实的家属代述优先；否则取最新产妇自述
    g.latest = g.records.find((x) => x.status === '待核实') ||
      g.records.find((x) => x.source === '产妇自述') || g.records[0]
    g.hasSelfHarm = g.records.some((x) => x.self_harm && x.status !== '已结束')
    g.pendingVerify = g.records.some((x) => x.status === '待核实')
  }
  return [...groups.values()].sort((a, b) => (b.hasSelfHarm - a.hasSelfHarm) || (b.pendingVerify - a.pendingVerify) ||
    String(b.latest?.recorded_at || '').localeCompare(String(a.latest?.recorded_at || '')))
}

/**
 * 按角色序列化：
 *  - nurse：全部字段（含 nurse_note 内部备注）
 *  - doctor：临床内容可见（量表/自伤/归因/建议），nurse_note 不可见
 *  - family：仅必要提醒（分数、自伤、临床建议、内部备注均隐藏），家属代述本人记录可见其填报内容与状态
 */
export function serializeFor(row, role, viewerFamilyUserId = null) {
  if (!row) return row
  const r = hydrate(row)
  const base = {
    id: r.id, archive_id: r.archive_id, visit_id: r.visit_id, source: r.source,
    reporter_name: r.reporter_name, recorded_by: r.recorded_by, recorded_at: r.recorded_at,
    status: r.status, conflict_with: r.conflict_with, conflict_note: r.conflict_note,
    care_status: r.care_status, mood_trend: r.mood_trend, created_at: r.created_at,
    crying: r.crying, sleep_quality: r.sleep_quality, family_support: r.family_support,
    care_pressure: r.care_pressure, risk_factors: r.risk_factors,
  }
  if (role === 'family') {
    const own = r.source === '家属代述' // 仅本人代述记录回显
    return {
      ...base,
      // 跨来源冲突与临床追踪状态不对家属展示（避免泄露产妇隐私表述）
      conflict_with: null, conflict_note: '', care_status: own ? r.care_status : '', mood_trend: '',
      // 护士临床记录对家属只保留温和提醒；家属自己的代述回显其填报
      own_report: own,
      epds_score: null, epds_detail: [], self_harm: 0, self_harm_note: '',
      suggestion: '', nurse_note: '', followup_plan: [], risk_factors: [],
      family_notice: own ? '' : r.family_notice,
      crying: own ? r.crying : 0, sleep_quality: own ? r.sleep_quality : '',
      family_support: own ? r.family_support : '', care_pressure: own ? r.care_pressure : '',
    }
  }
  return {
    ...base,
    epds_score: r.epds_score, epds_detail: r.epds_detail, self_harm: r.self_harm,
    self_harm_note: r.self_harm_note, suggestion: r.suggestion,
    followup_plan: r.followup_plan, family_notice: r.family_notice,
    nurse_note: role === 'nurse' ? r.nurse_note : '',
  }
}
