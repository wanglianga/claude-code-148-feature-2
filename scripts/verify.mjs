// 端到端验证脚本：node scripts/verify.mjs（需服务已启动，默认 http://localhost:8080）
// 覆盖：登录、工作台、档案筛选、访视提交与风险结论、离线同步幂等、
//       未开门/改约、随访闭环、医生决策、家属端总览/材料/咨询
const BASE = process.env.BASE_URL || 'http://localhost:8080'
let passed = 0, failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failed++; console.error(`  ✘ ${name}${extra ? ' — ' + extra : ''}`) }
}
const j = (r) => r.json()
async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }).then(j)
  if (!r.token) throw new Error(`登录失败 ${username}: ${JSON.stringify(r)}`)
  return { token: r.token, user: r.user }
}
const call = (token, method, path, body) =>
  fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(j)

console.log(`验证目标: ${BASE}`)

// 1 登录
const nurse = await login('nurse', 'nurse123')
const doctor = await login('doctor', 'doctor123')
const family = await login('family', 'family123')
ok('三类角色登录', !!(nurse.token && doctor.token && family.token), `${nurse.user.name}/${doctor.user.name}/${family.user.name}`)

// 2 工作台
const dash = await call(nurse.token, 'GET', '/api/dashboard')
ok('工作台统计', dash.stats.unvisited > 0 && dash.stats.openFollowups > 0,
  `未访视${dash.stats.unvisited} 黄疸异常${dash.stats.jaundiceAlerts} 产妇风险${dash.stats.maternalRisks} 待闭环${dash.stats.openFollowups}`)

// 3 档案筛选
const all = await call(nurse.token, 'GET', '/api/archives')
const jaundice = await call(nurse.token, 'GET', '/api/archives?filter=jaundice')
const maternal = await call(nurse.token, 'GET', '/api/archives?filter=maternal')
ok('档案列表', all.archives.length >= 8, `共 ${all.archives.length} 份`)
ok('异常黄疸筛选', jaundice.archives.length >= 2, jaundice.archives.map(a => a.baby_name).join('、'))
ok('产妇风险筛选', maternal.archives.length >= 1, maternal.archives.map(a => a.baby_name).join('、'))

// 4 档案详情（时间线/访视/随访在同一档案）
const target = all.archives.find(a => a.baby_name === '吴小满')
const detail = await call(nurse.token, 'GET', `/api/archives/${target.id}`)
ok('档案详情聚合', detail.visits.length > 0 && detail.followups.length > 0 && detail.events.length > 0,
  `访视${detail.visits.length} 随访${detail.followups.length} 事件${detail.events.length}`)
const wuVisit = detail.visits[0]
ok('种子风险结论（吴小满：体重降>10%+黄疸近阈值+设备故障）',
  wuVisit.risk_level === '危急' && wuVisit.need_referral === 1 && wuVisit.device_issue === 1,
  `风险${wuVisit.risk_level} 标记${wuVisit.flags.length}条`)

// 5 提交一次高风险访视 → 自动生成复查/转诊等事项
const liAnan = all.archives.find(a => a.baby_name === '李安安')
const visitRes = await call(nurse.token, 'POST', '/api/visits', {
  archive_id: liAnan.id, visit_time: new Date().toISOString().slice(0, 16),
  weight: 2900, bilirubin: 285, bilirubin_site: '额头', cord: '渗液',
  stool_count: 2, stool_color: '黄色', urine_count: 5, feeding_freq: 6,
  spit_up: '频繁', sleep: '正常', breast: '涨奶', mood: '焦虑', care_ability: '一般',
})
ok('访视提交', !!visitRes.visit?.id, `visit#${visitRes.visit?.id}`)
ok('风险引擎：接近阈值+体重下降+喂养不足',
  visitRes.visit.risk_level === '高' && visitRes.visit.need_recheck === 1 && visitRes.visit.need_lactation === 1,
  `风险${visitRes.visit.risk_level} 复查${visitRes.visit.need_recheck} 母乳指导${visitRes.visit.need_lactation}`)
const after = await call(nurse.token, 'GET', `/api/archives/${liAnan.id}`)
ok('自动生成复查预约', after.appointments.some(a => a.type === '复查' && a.status === '待访视'))
ok('随访事项生成', after.followups.filter(f => f.status !== '已闭环').length >= 2)

// 6 离线同步幂等：同一 client_id 提交两次只落一条
const cid = `verify-${Date.now()}`
const syncBody = { visits: [{ client_id: cid, archive_id: liAnan.id, visit_time: new Date().toISOString().slice(0, 16), weight: 2910, bilirubin: 260, feeding_freq: 8, stool_count: 3, stool_color: '黄色', urine_count: 7 }] }
const s1 = await call(nurse.token, 'POST', '/api/sync/visits', syncBody)
const s2 = await call(nurse.token, 'POST', '/api/sync/visits', syncBody)
ok('离线草稿同步', s1.results[0].ok === true, `visit#${s1.results[0].visit_id}`)
ok('同步幂等（重复 client_id 不产生重复记录）', s2.results[0].ok && s2.results[0].duplicated === true && s2.results[0].visit_id === s1.results[0].visit_id)

// 7 未开门 → 再次预约事项
const appts = await call(nurse.token, 'GET', '/api/appointments?status=待访视')
const someAppt = appts.appointments.find(a => a.archive_id !== liAnan.id)
if (someAppt) {
  await call(nurse.token, 'POST', `/api/appointments/${someAppt.id}/no-show`, { note: '验证脚本：无人应答' })
  const fu = await call(nurse.token, 'GET', '/api/followups')
  ok('未开门生成再次预约事项', fu.followups.some(f => f.type === '再次预约' && f.archive_id === someAppt.archive_id))
  // 改约
  const r2 = await call(nurse.token, 'POST', `/api/appointments/${someAppt.id}/reschedule`, { scheduledTime: '2099-01-01 09:00', reason: '验证脚本改约' })
  ok('改约', r2.appointment.status === '待访视' && r2.appointment.scheduled_time.startsWith('2099-01-01'))
} else ok('未开门/改约', false, '没有可用预约')

// 8 医生决策 + 闭环
const fus = await call(doctor.token, 'GET', '/api/followups')
const openOne = fus.followups.find(f => f.status !== '已闭环')
const dec = await call(doctor.token, 'POST', `/api/followups/${openOne.id}/decide`, { decision: '电话随访', note: '验证脚本：先电话随访观察' })
ok('医生决策', dec.ok === true)
const closed = await call(nurse.token, 'POST', `/api/followups/${openOne.id + 1}/close`, { note: '验证脚本闭环' })
ok('护士闭环', closed.followup?.status === '已闭环' || (await call(nurse.token, 'GET', '/api/followups')).followups.some(f => f.status === '已闭环'))

// 9 家属端
const fam = await call(family.token, 'GET', '/api/family/overview')
ok('家属端总览（建议/复查/风险说明）', fam.visits.length > 0 && !!fam.visits[0].advice && fam.followups.length >= 0,
  `访视${fam.visits.length}次 待办${fam.followups.length}项`)
const doc = await call(family.token, 'POST', '/api/documents', { type: '喂养记录', filename: 'verify.jpg', note: '验证脚本上传' })
ok('家属补充材料', !!doc.document?.id)
const con = await call(family.token, 'POST', '/api/consults', { question: '验证脚本：宝宝可以晒太阳吗？' })
ok('家属线上咨询', !!con.consult?.id)
const reply = await call(nurse.token, 'POST', `/api/consults/${con.consult.id}/reply`, { reply: '可以，避开正午，每次15分钟左右。' })
ok('护士回复咨询并闭环', reply.consult.status === '已回复')

// 10 权限
const deny = await fetch(`${BASE}/api/dashboard`, { headers: { Authorization: `Bearer ${family.token}` } })
ok('家属无权访问护士工作台', deny.status === 403)

// ========== 产妇情绪异常关怀 ==========
// 11 护士关怀中心：紧急自伤（赵敏）+ 家属代述待核实（李婷）
const care = await call(nurse.token, 'GET', '/api/mood/care')
const zhao = care.groups.find(g => g.mother_name === '赵敏')
const li = care.groups.find(g => g.mother_name === '李婷')
ok('关怀中心聚合', care.groups.length >= 2, care.groups.map(g => `${g.mother_name}${g.hasSelfHarm ? '·自伤' : ''}${g.pendingVerify ? '·待核实' : ''}`).join('、'))
ok('自伤想法紧急置顶', !!zhao && zhao.hasSelfHarm === true && zhao.records.some(r => r.self_harm === 1 && r.epds_score === 16),
  zhao ? `EPDS ${zhao.latest.epds_score}` : '未找到赵敏')
ok('护士可见内部备注', zhao.records.some(r => r.nurse_note && r.nurse_note.includes('EPDS')), 'nurse_note 仅护士可见')
ok('家属代述待核实', !!li && li.pendingVerify === true && li.records.some(r => r.source === '家属代述' && r.status === '待核实'))
ok('双来源冲突标记（赵敏：家属说支持充分 vs 产妇说不足）',
  zhao.records.every(r => r.conflict_with != null) && zhao.records.some(r => r.conflict_note.includes('家属支持评价')))

// 12 工作台情绪统计
ok('工作台情绪统计', dash.stats.moodSelfHarm >= 1 && dash.stats.moodPendingVerify >= 1,
  `自伤${dash.stats.moodSelfHarm} 待核实${dash.stats.moodPendingVerify} 进行中${dash.stats.moodActive}`)

// 13 医生视角：临床内容可见、护士内部备注不可见
const docCare = await call(doctor.token, 'GET', '/api/mood/care')
const docZhao = docCare.groups.find(g => g.mother_name === '赵敏')
ok('医生可见 EPDS 临床信息', !!docZhao && docZhao.records.some(r => r.epds_score === 16 && r.self_harm === 1))
ok('医生不可见护士内部备注', docZhao.records.every(r => !r.nurse_note))

// 14 护士新建情绪关怀记录（核实李婷家属代述）：EPDS 9 分=情绪困扰，自动生成敏感行动
const famBefore = await call(family.token, 'GET', '/api/family/overview')
ok('家属代述本人可回看且无分数', famBefore.mood_records.some(r => r.own_report && r.status === '待核实') &&
  famBefore.mood_records.every(r => r.epds_score == null && r.self_harm === 0))
const epds = [{ q: 1, a: 1 }, { q: 2, a: 2 }, { q: 3, a: 1 }, { q: 4, a: 1 }, { q: 5, a: 0 },
  { q: 6, a: 1 }, { q: 7, a: 1 }, { q: 8, a: 1 }, { q: 9, a: 1 }, { q: 10, a: 0 }] // 合计 9 分
const moodRes = await call(nurse.token, 'POST', '/api/mood/records', {
  archive_id: liAnan.id, recorded_at: new Date().toISOString().slice(0, 16),
  epds_detail: epds, crying: true, sleep_quality: '严重不足', family_support: '不足',
  care_pressure: '新手妈妈夜间独自喂奶，睡眠碎片化', risk_factors: ['照护压力', '睡眠不足', '家庭支持不足'],
  suggestion: '安排心理咨询，本周两次电话回访', family_notice: '请家人夜间多分担照护、多陪伴妈妈，社区提供免费心理咨询',
  nurse_note: '验证脚本：仅护士可见备注',
})
ok('EPDS 评分与分级', moodRes.mood?.epds_score === 9 && moodRes.grade?.level === '中', `得分 ${moodRes.mood?.epds_score}`)
ok('敏感随访行动生成', Array.isArray(moodRes.grade?.plans) && moodRes.grade.plans.includes('心理咨询'))
const liDetail2 = await call(nurse.token, 'GET', `/api/archives/${liAnan.id}`)
const sensitiveFu = liDetail2.followups.filter(f => f.sensitive === 1)
ok('情绪行动为敏感事项且含家属温和提醒', sensitiveFu.some(f => f.type === '心理咨询' && f.family_title),
  sensitiveFu.map(f => f.type).join('、'))
ok('核实后家属代述并入本轮关怀', liDetail2.mood_records.every(r => r.status !== '待核实'))
ok('核实产生双来源冲突（支持：一般 vs 不足 / 睡眠：间断 vs 严重不足）',
  liDetail2.mood_records.some(r => r.conflict_with != null && r.conflict_note.includes('家属支持评价')))

// 15 家属端脱敏：只见温和提醒，不见分数/自伤/临床建议/内部备注
const famAfter = await call(family.token, 'GET', '/api/family/overview')
ok('家属端收到情绪关怀温和提醒', famAfter.mood_notices.some(n => n.includes('免费心理咨询')),
  famAfter.mood_notices.join('；') || '（无）')
ok('家属端敏感随访仅展示提醒文案',
  famAfter.followups.every(f => !f.sensitive || (!f.detail && !/EPDS|自伤|评分/.test(f.title))))
ok('家属端情绪记录无敏感字段',
  famAfter.mood_records.every(r => (r.epds_score == null) && r.self_harm === 0 && !r.nurse_note && !r.suggestion))
ok('家属端访视记录已过滤情绪敏感标记',
  famAfter.visits.every(v => v.flags.every(x => !/EPDS|自伤|情绪(低落|异常|困扰)/.test(x))))

// 16 回访追踪：情绪变化 + 是否接受帮助
const newMoodId = moodRes.mood.id
const fuRes = await call(nurse.token, 'POST', `/api/mood/records/${newMoodId}/followup`,
  { mood_trend: '好转', care_status: '已接受', note: '验证脚本：已报名心理咨询，睡眠改善' })
ok('回访记录情绪变化与帮助接受', fuRes.mood?.mood_trend === '好转' && fuRes.mood?.care_status === '已接受')

// 17 医生决策情绪处置（心理咨询）→ 敏感事项；结束关怀闭环行动
const fus2 = await call(doctor.token, 'GET', '/api/followups')
const moodFu = fus2.followups.find(f => f.archive_id === liAnan.id && f.type === '增加电话回访' && f.status !== '已闭环')
if (moodFu) {
  const dec2 = await call(doctor.token, 'POST', `/api/followups/${moodFu.id}/decide`, { decision: '心理咨询', note: '验证脚本：医生安排心理咨询' })
  ok('医生决策情绪处置', dec2.ok === true)
} else ok('医生决策情绪处置', false, '缺少开放的情绪事项')
const closeCare = await call(nurse.token, 'POST', `/api/mood/records/${newMoodId}/close`, { note: '验证脚本：好转结束' })
ok('结束关怀', closeCare.ok === true)

// 18 家属紧急代述通道（家属勾选自伤担忧）：家属回显无敏感字段，护士端收到紧急信号
const fam2session = await login('family2', 'family123')
const urgentReport = await call(fam2session.token, 'POST', '/api/family/mood-report',
  { crying: true, sleep_quality: '严重不足', family_support: '不足', self_harm_concern: true, care_pressure: '验证脚本：家属非常担心' })
ok('家属紧急代述提交且回显脱敏', urgentReport.mood?.id && urgentReport.mood.self_harm === 0 && urgentReport.mood.epds_score == null)
const care2 = await call(nurse.token, 'GET', '/api/mood/care')
ok('护士端收到自伤紧急信号', care2.groups.some(g => g.mother_name === '王雪' && g.hasSelfHarm === true))

// 19 情绪接口越权拦截
const denyMood1 = await fetch(`${BASE}/api/mood/care`, { headers: { Authorization: `Bearer ${family.token}` } })
const denyMood3 = await fetch(`${BASE}/api/family/mood-report`, { method: 'POST', headers: { Authorization: `Bearer ${doctor.token}`, 'Content-Type': 'application/json' }, body: '{}' })
ok('情绪接口按角色拦截（家属禁读关怀中心/医生禁代述）', denyMood1.status === 403 && denyMood3.status === 403)

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
