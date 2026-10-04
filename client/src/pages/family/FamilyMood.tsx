// 家属端·妈妈情绪关怀：只展示必要的温和提醒；家属可代述观察（不含量表/评分/产妇敏感临床记录）
import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { FamilyOverview } from '../../types'
import { Badge, Empty, fmtTime, toast } from '../../components/ui'

const STATUS_TEXT: Record<string, { c: string; t: string }> = {
  待核实: { c: 'amber', t: '待护士上门核实' },
  进行中: { c: 'teal', t: '护士已核实，关怀跟进中' },
  已结束: { c: 'green', t: '本轮关怀已结束' },
}

export default function FamilyMood() {
  const [d, setD] = useState<FamilyOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ crying: true, sleep_quality: '间断', family_support: '一般', care_pressure: '', self_harm_concern: false })

  function load() { api.get<FamilyOverview>('/api/family/overview').then(setD) }
  useEffect(load, [])
  if (!d) return <Empty text="加载中…" icon="⏳" />

  const own = (d.mood_records || []).filter((r) => r.own_report)
  const notices = d.mood_notices || []

  async function submit() {
    if (!f.crying && f.sleep_quality === '良好' && !f.care_pressure.trim() && !f.self_harm_concern) {
      return toast('请至少填写一项观察（哭泣 / 睡眠 / 照护压力）')
    }
    setBusy(true)
    try {
      await api.post('/api/family/mood-report', f)
      toast('已提交，社区护士会在上门时与妈妈当面核实并跟进')
      setF({ crying: false, sleep_quality: '良好', family_support: '充分', care_pressure: '', self_harm_concern: false })
      load()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-title">妈妈情绪关怀</div>
      <div className="page-sub">产后情绪低落、哭泣、睡不好较常见，家人的陪伴最重要。您的观察只有社区护士可见，护士会在上门时单独与妈妈沟通</div>

      {f.self_harm_concern && (
        <div className="alert-box danger">
          <b>如果妈妈表达过伤害自己或宝宝的想法：</b>请不要让她或宝宝独处、收好危险物品，
          立即拨打<b>全国心理援助热线 12356</b>，并尽快联系社区护士陪同就医。您提交后护士端将收到紧急提醒。
        </div>
      )}

      {notices.length > 0 && (
        <div className="card">
          <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />社区给您的关怀提醒</div>
          {notices.map((n, i) => <div key={i} className="alert-box info" style={{ marginBottom: 8 }}>{n}</div>)}
          <div className="small muted">如需报名免费心理咨询或妇保门诊，可在「咨询改约」页告诉护士，或等待护士电话回访。</div>
        </div>
      )}

      <div className="card">
        <div className="card-title"><span className="dot" />我观察到的情况（代妈妈反馈）</div>
        <div className="small muted mb8">护士上门前可先在这里反馈，护士会结合妈妈当面表述分别记录、核对</div>

        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.crying} onChange={(e) => setF({ ...f, crying: e.target.checked })} style={{ width: 'auto' }} />
          妈妈最近经常哭泣或情绪低落
        </label>

        <div className="field">
          <label>妈妈的睡眠</label>
          <Pills options={['良好', '间断', '严重不足']} value={f.sleep_quality} onChange={(v) => setF({ ...f, sleep_quality: v })} />
        </div>
        <div className="field">
          <label>家里对妈妈的支持（您的评价）</label>
          <Pills options={['充分', '一般', '不足']} value={f.family_support} onChange={(v) => setF({ ...f, family_support: v })} />
        </div>
        <div className="field">
          <label>具体情况（可选）</label>
          <textarea rows={3} placeholder="如：夜间喂奶无人替换、与长辈育儿观念不一致、总担心奶水不足…"
            value={f.care_pressure} onChange={(e) => setF({ ...f, care_pressure: e.target.value.slice(0, 500) })} />
        </div>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.self_harm_concern} onChange={(e) => setF({ ...f, self_harm_concern: e.target.checked })} style={{ width: 'auto' }} />
          <span style={{ color: 'var(--red)' }}><b>我担心妈妈有伤害自己（或宝宝）的念头</b></span>
        </label>

        <button className="btn primary block mt12" disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交给社区护士'}</button>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />我的反馈记录</div>
        {own.length === 0 && <Empty text="还没有反馈记录" icon="💌" />}
        {own.map((r) => (
          <div key={r.id} className="mb12" style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 8 }}>
            <div className="row between">
              <Badge color={STATUS_TEXT[r.status]?.c || 'gray'}>{STATUS_TEXT[r.status]?.t || r.status}</Badge>
              <span className="small muted">观察于 {fmtTime(r.recorded_at)}</span>
            </div>
            <div className="small mt8">
              {r.crying ? '持续哭泣 · ' : ''}睡眠{r.sleep_quality || '未填'} · 支持评价「{r.family_support || '未填'}」
            </div>
            {r.care_pressure && <div className="small muted mt8">{r.care_pressure}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--amber)' }} />家人可以做的事</div>
        <ul className="flag-list">
          <li>夜间主动分担喂奶、换尿布，让妈妈有连续睡眠</li>
          <li>多倾听、少评判，避免“别人都这样过来的”一类说法</li>
          <li>肯定妈妈的付出，关注她而不只是宝宝</li>
          <li>鼓励并陪同妈妈参加社区免费心理咨询或妇保门诊</li>
        </ul>
      </div>
    </div>
  )
}

function Pills({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <span key={o} className={`opt ${value === o ? 'on' : ''}`} onClick={() => onChange(o)}>{o}</span>)}
    </div>
  )
}
