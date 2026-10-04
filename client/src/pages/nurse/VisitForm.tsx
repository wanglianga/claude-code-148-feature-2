// 上门访视记录：测量 + 观察 + 照片 + 建议，实时风险预评估；离线先存草稿，回社区后同步
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import type { Archive, ArchiveDetail, MoodCarePayload, VisitPayload } from '../../types'
import { assessVisit } from '../../risk'
import { Badge, Empty, RiskBadge, fmtTime, toast } from '../../components/ui'
import { isOfflineNow, useNet } from '../../store/net'
import { newClientId, useDrafts } from '../../store/drafts'

const now16 = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function VisitForm() {
  const [sp] = useSearchParams()
  const archiveId = Number(sp.get('archiveId'))
  const appointmentId = sp.get('appointmentId') ? Number(sp.get('appointmentId')) : null
  const [archive, setArchive] = useState<Archive | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const offline = useNet((s) => s.offline)
  const saveDraft = useDrafts((s) => s.save)

  const [f, setF] = useState<VisitPayload>({
    archive_id: archiveId,
    appointment_id: appointmentId,
    visit_time: now16(),
    weight: undefined, bilirubin: undefined, bilirubin_site: '额头',
    cord: '干燥', stool_count: 3, stool_color: '黄色', urine_count: 6,
    feeding_type: '', feeding_freq: 8, spit_up: '无', sleep: '正常',
    breast: '正常', mood: '平稳', wound_check: '', care_ability: '',
    device_issue: false, photos: [], advice: '',
  })
  const [adviceTouched, setAdviceTouched] = useState(false)
  const set = (k: keyof VisitPayload, v: any) => setF((s) => ({ ...s, [k]: v }))

  // 产妇情绪关怀（敏感）：量表、家属支持、自伤想法、风险来源、建议
  const [mcOn, setMcOn] = useState(false)
  const [mc, setMc] = useState<MoodCarePayload>({
    persistent_crying: '无', sleep_quality: '正常', epds_score: null,
    family_support: '良好', self_harm: '无', risk_factors: [], advice: '',
  })
  const setMcF = (k: keyof MoodCarePayload, v: any) => setMc((s) => ({ ...s, [k]: v }))
  const toggleFactor = (x: string) =>
    setMcF('risk_factors', (mc.risk_factors || []).includes(x)
      ? (mc.risk_factors || []).filter((f) => f !== x)
      : [...(mc.risk_factors || []), x])
  // 情绪选“低落/异常”时自动展开情绪关怀区
  useEffect(() => { if (['低落', '异常'].includes(f.mood || '')) setMcOn(true) }, [f.mood])
  // 按已填内容自动提示风险来源（可手动增删）
  useEffect(() => {
    if (!mcOn) return
    setMc((s) => {
      const auto = new Set(s.risk_factors || [])
      if (s.persistent_crying && s.persistent_crying !== '无') auto.add('照护压力')
      if (s.sleep_quality && s.sleep_quality !== '正常') auto.add('睡眠不足')
      if (s.family_support === '不足') auto.add('家庭支持不足')
      return { ...s, risk_factors: [...auto] }
    })
  }, [mcOn, mc.persistent_crying, mc.sleep_quality, mc.family_support])

  useEffect(() => {
    api.get<ArchiveDetail>(`/api/archives/${archiveId}`)
      .then((d) => {
        setArchive(d.archive)
        setF((s) => ({ ...s, feeding_type: s.feeding_type || d.archive.feeding_type, wound_check: s.wound_check || d.archive.maternal_wound, care_ability: s.care_ability || d.archive.care_ability }))
      })
      .catch((e) => setErr(`档案加载失败：${e.message}（离线状态下请回到社区网络环境再打开本页，或先在同步页处理草稿）`))
  }, [archiveId])

  // 实时风险预评估（与服务端同一套规则，含情绪关怀敏感项）
  const moodCarePayload = mcOn ? { ...mc, epds_score: mc.epds_score == null || (mc.epds_score as any) === '' ? null : Number(mc.epds_score) } : undefined
  const assess = useMemo(() => (archive ? assessVisit(archive, { ...f, mood_care: moodCarePayload }) : null), [archive, f, mcOn, mc])
  const advice = adviceTouched ? f.advice || '' : assess?.advice || ''

  if (err) return <div className="alert-box danger">{err}</div>
  if (!archive) return <Empty text="档案加载中…" icon="⏳" />

  function payload(): VisitPayload {
    return {
      ...f,
      archive_id: archiveId,
      appointment_id: appointmentId,
      advice,
      weight: f.weight ? Number(f.weight) : null,
      bilirubin: f.bilirubin != null && f.bilirubin !== ('' as any) ? Number(f.bilirubin) : null,
      stool_count: Number(f.stool_count || 0),
      urine_count: Number(f.urine_count || 0),
      feeding_freq: Number(f.feeding_freq || 0),
      ...(moodCarePayload ? { mood_care: moodCarePayload } : {}),
    }
  }

  function toDraft(clientId?: string) {
    const id = clientId || newClientId()
    saveDraft({
      clientId: id,
      label: `${archive!.baby_name}（${archive!.mother_name}）· ${f.visit_time.replace('T', ' ')}`,
      savedAt: new Date().toLocaleString('zh-CN'),
      status: '待同步',
      payload: { ...payload(), client_id: id },
    })
    return id
  }

  async function submit() {
    if (!f.weight && !f.bilirubin) return toast('请至少填写体重或黄疸值')
    setBusy(true)
    try {
      if (isOfflineNow()) {
        toDraft()
        toast('📵 当前离线：已保存为本地草稿，回到社区后在「同步」页上传')
        nav('/nurse/sync')
        return
      }
      try {
        await api.post('/api/visits', payload())
        toast('✔ 访视已提交，风险结论与随访事项已生成')
        nav(`/nurse/archives/${archiveId}`)
      } catch (e: any) {
        if (e instanceof TypeError || /fetch|网络/i.test(e.message)) {
          toDraft()
          toast('网络异常：已转存本地草稿，稍后在「同步」页上传')
          nav('/nurse/sync')
        } else {
          toast(e.message)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">记录访视</div>
      <div className="card">
        <div className="row between">
          <span className="strong">{archive.mother_name} · {archive.baby_name}</span>
          <Badge color={archive.jaundice_risk === '高' ? 'coral' : archive.jaundice_risk === '中' ? 'amber' : 'green'}>黄疸风险{archive.jaundice_risk}</Badge>
        </div>
        <div className="small muted mt8">
          出生 {fmtTime(archive.birth_date)} · {archive.birth_weight}g · {archive.delivery_mode} · {archive.feeding_type}
        </div>
        <div className="small muted">📍 {archive.address} · 📞 {archive.contact_name} {archive.contact_phone}</div>
        {assess && (
          <div className="small mt8" style={{ color: 'var(--teal)' }}>
            今天为出生第 {assess.ageDays + 1} 天，黄疸光疗参考阈值 {assess.threshold} µmol/L
          </div>
        )}
      </div>

      {offline && <div className="alert-box warn">📵 离线模式：提交将保存为本地草稿，不会上传服务器</div>}

      <div className="card">
        <div className="card-title"><span className="dot" />婴儿测量</div>
        <div className="grid2">
          <div className="field">
            <label>访视时间</label>
            <input type="datetime-local" value={f.visit_time} onChange={(e) => set('visit_time', e.target.value)} />
          </div>
          <div className="field">
            <label>体重（g）</label>
            <input type="number" inputMode="numeric" placeholder={`出生 ${archive.birth_weight}g`} value={f.weight ?? ''} onChange={(e) => set('weight', e.target.value)} />
            {assess?.weightLossPct != null && (
              <div className="hint" style={{ color: assess.weightLossPct > 7 ? 'var(--red)' : 'var(--muted)' }}>
                较出生 {assess.weightLossPct > 0 ? `下降 ${assess.weightLossPct}%` : `增长 ${-assess.weightLossPct}%`}
              </div>
            )}
          </div>
          <div className="field">
            <label>经皮黄疸值（µmol/L）</label>
            <input type="number" inputMode="decimal" placeholder="如 180" value={f.bilirubin ?? ''} onChange={(e) => set('bilirubin', e.target.value)} />
            {assess && f.bilirubin != null && f.bilirubin !== ('' as any) && (
              <div className="hint" style={{ color: Number(f.bilirubin) >= assess.threshold - 34 ? 'var(--red)' : 'var(--muted)' }}>
                距阈值 {assess.threshold - Number(f.bilirubin)} µmol/L
              </div>
            )}
          </div>
          <div className="field">
            <label>测量部位</label>
            <Seg options={['额头', '胸口', '大腿']} value={f.bilirubin_site!} onChange={(v) => set('bilirubin_site', v)} />
          </div>
        </div>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!f.device_issue} onChange={(e) => set('device_issue', e.target.checked)} style={{ width: 'auto' }} />
          社区测量设备故障，本次为手工记录（需复测核实）
        </label>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />排泄与脐带</div>
        <div className="grid2">
          <div className="field">
            <label>大便次数（次/日）</label>
            <input type="number" inputMode="numeric" value={f.stool_count ?? ''} onChange={(e) => set('stool_count', e.target.value)} />
          </div>
          <div className="field">
            <label>小便次数（次/日）</label>
            <input type="number" inputMode="numeric" value={f.urine_count ?? ''} onChange={(e) => set('urine_count', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>大便颜色</label>
          <Seg options={['黄色', '黄绿色', '墨绿色', '白陶土色', '血丝']} value={f.stool_color!} onChange={(v) => set('stool_color', v)} />
        </div>
        <div className="field">
          <label>脐带情况</label>
          <Seg options={['干燥', '结痂', '渗血', '渗液', '化脓', '异味', '已脱落']} value={f.cord!} onChange={(v) => set('cord', v)} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />喂养与一般状态</div>
        <div className="field">
          <label>喂养方式</label>
          <Seg options={['母乳喂养', '配方奶喂养', '混合喂养']} value={f.feeding_type!} onChange={(v) => set('feeding_type', v)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>喂养频次（次/日）</label>
            <input type="number" inputMode="numeric" value={f.feeding_freq ?? ''} onChange={(e) => set('feeding_freq', e.target.value)} />
            <div className="hint">建议 8~12 次/日</div>
          </div>
          <div className="field">
            <label>吐奶</label>
            <Seg options={['无', '偶尔', '频繁', '喷射性']} value={f.spit_up!} onChange={(v) => set('spit_up', v)} />
          </div>
        </div>
        <div className="field">
          <label>睡眠</label>
          <Seg options={['正常', '易惊', '嗜睡', '哭闹不安']} value={f.sleep!} onChange={(v) => set('sleep', v)} />
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />产妇情况</div>
        <div className="field">
          <label>乳房</label>
          <Seg options={['正常', '涨奶', '乳头皲裂', '红肿热痛']} value={f.breast!} onChange={(v) => set('breast', v)} />
        </div>
        <div className="field">
          <label>情绪状态</label>
          <Seg options={['平稳', '焦虑', '低落', '异常']} value={f.mood!} onChange={(v) => set('mood', v)} />
        </div>
        <div className="field">
          <label>伤口复查</label>
          <Seg options={['愈合良好', '红肿', '渗液']} value={f.wound_check!} onChange={(v) => set('wound_check', v)} />
        </div>
        <div className="field">
          <label>家庭照护能力（现场评估）</label>
          <Seg options={['良好', '一般', '薄弱']} value={f.care_ability!} onChange={(v) => set('care_ability', v)} />
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <div className="card-title" style={{ margin: 0 }}><span className="dot" style={{ background: 'var(--red)' }} />产妇情绪关怀（敏感）</div>
          <label className="row small" style={{ gap: 6, cursor: 'pointer', margin: 0 }}>
            <input type="checkbox" checked={mcOn} onChange={(e) => setMcOn(e.target.checked)} style={{ width: 'auto' }} />
            记录
          </label>
        </div>
        {!mcOn && <div className="small muted mt8">产妇表达持续哭泣、睡眠差等情况时开启记录；内容仅护士与社区医生可见，家属端不展示。</div>}
        {mcOn && (
          <div className="mt8">
            <div className="alert-box danger" style={{ marginBottom: 10 }}>
              🔒 敏感记录：量表分、自伤想法与风险来源仅护士/社区医生可见，家属端只下发必要提醒。
            </div>
            <div className="grid2">
              <div className="field">
                <label>持续哭泣</label>
                <Seg options={['无', '偶尔', '持续']} value={mc.persistent_crying!} onChange={(v) => setMcF('persistent_crying', v)} />
              </div>
              <div className="field">
                <label>睡眠情况</label>
                <Seg options={['正常', '入睡困难', '易醒', '严重失眠']} value={mc.sleep_quality!} onChange={(v) => setMcF('sleep_quality', v)} />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>EPDS 爱丁堡量表分（0~30，未评留空）</label>
                <input type="number" inputMode="numeric" min={0} max={30} placeholder="如 13"
                  value={mc.epds_score ?? ''} onChange={(e) => setMcF('epds_score', e.target.value === '' ? null : Number(e.target.value))} />
                <div className="hint">≥10 需关注，≥13 提示抑郁风险</div>
              </div>
              <div className="field">
                <label>家属支持</label>
                <Seg options={['良好', '一般', '不足']} value={mc.family_support!} onChange={(v) => setMcF('family_support', v)} />
              </div>
            </div>
            <div className="field">
              <label>自伤想法（高敏感）</label>
              <Seg options={['无', '偶有', '持续']} value={mc.self_harm!} onChange={(v) => setMcF('self_harm', v)} />
              {mc.self_harm !== '无' && (
                <div className="hint" style={{ color: 'var(--red)' }}>
                  ⚠ 存在自伤想法：请当面评估安全，必要时立即联系妇保门诊/心理危机干预；提交后系统自动安排心理咨询与转妇保门诊。
                </div>
              )}
            </div>
            <div className="field">
              <label>风险来源（供心理咨询/妇保门诊研判）</label>
              <div className="seg">
                {['照护压力', '睡眠不足', '家庭支持不足'].map((x) => (
                  <span key={x} className={`opt ${(mc.risk_factors || []).includes(x) ? 'on' : ''}`} onClick={() => toggleFactor(x)}>{x}</span>
                ))}
              </div>
              <div className="hint">按填写内容自动提示，可手动增删</div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>关怀建议（敏感，仅医护可见）</label>
              <textarea rows={3} value={mc.advice || ''} onChange={(e) => setMcF('advice', e.target.value)}
                placeholder="如：建议家属分担夜间照护，安排心理咨询并增加电话回访" />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />现场照片（黄疸/脐部/伤口）</div>
        <PhotoPicker photos={f.photos || []} onChange={(p) => set('photos', p)} />
      </div>

      {assess && (
        <div className="card">
          <div className="row between mb8">
            <div className="card-title" style={{ margin: 0 }}><span className="dot" style={{ background: 'var(--red)' }} />风险预评估</div>
            <RiskBadge level={assess.riskLevel} />
          </div>
          {assess.flags.length > 0 && (
            <ul className="flag-list mb8">{assess.flags.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          <div className="row wrap small mb8">
            {assess.needReferral ? <Badge color="red">建议转诊儿科</Badge> : null}
            {assess.needRecheck ? <Badge color="coral">建议 24~48h 复查</Badge> : null}
            {assess.needLactation ? <Badge color="teal">安排母乳指导</Badge> : null}
            {assess.needPhone ? <Badge color="amber">电话随访</Badge> : null}
            {!assess.needReferral && !assess.needRecheck && !assess.needLactation && !assess.needPhone && <Badge color="green">常规随访即可</Badge>}
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>护理建议（自动生成，可修改；家属端可见）</label>
            <textarea rows={4} value={advice} onChange={(e) => { setAdviceTouched(true); set('advice', e.target.value) }} />
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn ghost grow" onClick={() => { toDraft(); toast('已保存本地草稿'); nav('/nurse/sync') }}>存草稿</button>
        <button className="btn primary grow" disabled={busy} onClick={submit}>
          {busy ? '提交中…' : offline ? '📵 离线保存草稿' : '提交访视'}
        </button>
      </div>
    </div>
  )
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <span key={o} className={`opt ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</span>)}
    </div>
  )
}

function PhotoPicker({ photos, onChange }: { photos: string[]; onChange: (p: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length)
    let acc = [...photos]
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 480 / Math.max(img.width, img.height))
          canvas.width = img.width * scale; canvas.height = img.height * scale
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
          acc = [...acc, canvas.toDataURL('image/jpeg', 0.7)]
          onChange(acc)
        }
        img.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }
  return (
    <div>
      <div className="photo-row mb8">
        {photos.map((p, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <img src={p} alt={`照片${i + 1}`} />
            <button className="btn danger sm" style={{ position: 'absolute', top: -6, right: -6, padding: '1px 7px' }}
              onClick={() => onChange(photos.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      {photos.length < 3 && (
        <>
          <button className="btn ghost sm" onClick={() => ref.current?.click()}>📷 拍照/上传（最多 3 张）</button>
          <input ref={ref} type="file" accept="image/*" multiple hidden onChange={pick} />
        </>
      )}
    </div>
  )
}
