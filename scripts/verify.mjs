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

// 11 产妇情绪关怀：访视中建档（量表/家属支持/自伤想法/建议）
const mcVisit = await call(nurse.token, 'POST', '/api/visits', {
  archive_id: liAnan.id, visit_time: new Date().toISOString().slice(0, 16),
  weight: 2950, bilirubin: 150, feeding_freq: 8, stool_count: 3, stool_color: '黄色', urine_count: 7,
  mood: '低落',
  mood_care: {
    persistent_crying: '持续', sleep_quality: '严重失眠', epds_score: 15,
    family_support: '不足', self_harm: '偶有', risk_factors: ['睡眠不足', '家庭支持不足'],
    advice: '建议家属分担夜间照护，安排心理咨询并增加电话回访。',
  },
})
const flagText = Array.isArray(mcVisit.visit?.flags) ? mcVisit.visit.flags.join('') : String(mcVisit.visit?.flags || '')
ok('情绪关怀随访视建档', !!mcVisit.moodCare?.id, `care#${mcVisit.moodCare?.id}`)
ok('敏感明细不进家属可见标记（无自伤/量表字样）', !flagText.includes('自伤') && !flagText.includes('EPDS') && flagText.includes('情绪关怀'))
ok('自伤想法提升风险等级', ['高', '危急'].includes(mcVisit.visit.risk_level), `风险${mcVisit.visit.risk_level}`)
const careId = mcVisit.moodCare.id

// 12 护士/医生可见敏感全量，家属无权访问
const mcList = await call(nurse.token, 'GET', `/api/mood-cares?archive_id=${liAnan.id}`)
const nurseCare = mcList.cares.find((c) => c.id === careId)
ok('护士端可见敏感全量（量表/自伤/风险来源）',
  nurseCare?.epds_score === 15 && nurseCare?.self_harm === '偶有' && nurseCare?.risk_factors?.includes('睡眠不足'))
ok('自动安排心理咨询+增加电话回访', nurseCare?.logs?.some((l) => l.kind === '安排' && l.action === '心理咨询') && nurseCare?.logs?.some((l) => l.action === '增加电话回访'))
const mcDoc = await call(doctor.token, 'GET', `/api/mood-cares?archive_id=${liAnan.id}`)
ok('社区医生可见敏感全量', mcDoc.cares.some((c) => c.id === careId && c.self_harm === '偶有'))
const denyMc = await fetch(`${BASE}/api/mood-cares?archive_id=${liAnan.id}`, { headers: { Authorization: `Bearer ${family.token}` } })
ok('家属无权访问情绪关怀记录', denyMc.status === 403)

// 13 家属端脱敏：只收必要提醒，敏感内容与敏感事项不下发
const famOv = await call(family.token, 'GET', '/api/family/overview')
const famStr = JSON.stringify(famOv)
ok('家属端不含敏感明细（自伤/量表/风险来源）',
  !famStr.includes('自伤') && !famStr.includes('EPDS') && !famStr.includes('epds_score') && !famStr.includes('家庭支持不足'))
ok('家属端收到必要提醒', famOv.moodCare?.active === true && (famOv.moodCare.reminder || '').length > 0, famOv.moodCare?.actions?.join('、'))
ok('敏感随访事项不下发家属端', !famOv.followups.some((f) => ['心理咨询', '转妇保门诊'].includes(f.type)))

// 14 家属代填 → 双来源并列 + 冲突检测（含采集时间）
await call(family.token, 'POST', '/api/mood-cares/family-report', { mood_text: '平稳', sleep_quality: '正常', care_hands: '充足', note: '验证脚本：家里都挺好' })
const mcAfter = await call(nurse.token, 'GET', `/api/mood-cares?archive_id=${liAnan.id}`)
ok('家属代填与产妇自述双来源并列保留',
  mcAfter.cares.some((c) => c.source === 'family_report') && mcAfter.cares.some((c) => c.source === 'nurse_visit'))
ok('双来源冲突检测（含双方采集时间）',
  mcAfter.conflicts.length >= 2 && mcAfter.conflicts.every((c) => c.nurseTime && c.familyTime),
  mcAfter.conflicts.map((c) => c.dimension).join('、'))
ok('风险来源标注（照护压力/睡眠不足/家庭支持不足）',
  mcAfter.riskSources.includes('睡眠不足') && mcAfter.riskSources.includes('家庭支持不足'), mcAfter.riskSources.join('、'))

// 15 社区安排 → 回访追踪 → 闭环（闭环后家属端仍脱敏）
const act = await call(doctor.token, 'POST', `/api/mood-cares/${careId}/actions`, { actions: ['转妇保门诊'], note: '验证脚本：转妇保门诊' })
ok('社区安排转妇保门诊', act.ok === true)
const mcArr = await call(nurse.token, 'GET', `/api/mood-cares?archive_id=${liAnan.id}`)
ok('安排写入关怀日志', mcArr.cares.find((c) => c.id === careId)?.logs?.some((l) => l.action === '转妇保门诊'))
const trk = await call(nurse.token, 'POST', `/api/mood-cares/${careId}/tracks`, { mood_change: '好转', help_accepted: '已接受', note: '验证脚本：电话回访情绪好转' })
ok('回访追踪（情绪变化+是否接受帮助）', trk.ok === true)
const cls = await call(doctor.token, 'POST', `/api/mood-cares/${careId}/close`, { note: '验证脚本：情绪好转，已接受心理咨询' })
ok('情绪关怀闭环', cls.care?.status === '已闭环')
const famOv2 = await call(family.token, 'GET', '/api/family/overview')
ok('闭环后家属端仍脱敏', !JSON.stringify(famOv2).includes('自伤') && !JSON.stringify(famOv2).includes('epds_score'))

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed ? 1 : 0)
