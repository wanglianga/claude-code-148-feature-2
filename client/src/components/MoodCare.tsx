// 产妇情绪异常关怀共享组件：EPDS 量表录入、关怀字段、记录卡片（按角色脱敏）、双来源对照、回访弹窗
import { useMemo, useState } from 'react'
import { api } from '../api'
import type { MoodCarePayload, MoodRecord, MoodGrade } from '../types'
import { EPDS_QUESTIONS, EPDS_OPTIONS, epdsScore, selfHarmFrom, epdsLevel, RISK_FACTORS, MOOD_PLANS } from '../mood'
import { Badge, Modal, RiskBadge, fmtTime, toast } from './ui'
import { useAuth } from '../store/auth'

export const SLEEP_OPTS = ['良好', '间断', '严重不足']
export const SUPPORT_OPTS = ['充分', '一般', '不足']

function MultiPill({ options, value, onChange, tone = 'teal' }: { options: string[]; value: string[]; onChange: (v: string[]) => void; tone?: 'teal' | 'red' }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <span key={o} className={`opt ${value.includes(o) ? 'on' : ''} ${tone === 'red' && value.includes(o) ? 'danger-on' : ''}`}
          style={tone === 'red' && value.includes(o) ? { background: 'var(--red-soft)', borderColor: 'var(--red)', color: 'var(--red)' } : undefined}
          onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>{o}</span>
      ))}
    </div>
  )
}

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <span key={o} className={`opt ${value === o ? 'on' : ''}`} onClick={() => onChange(value === o ? '' : o)}>{o}</span>)}
    </div>
  )
}

// EPDS 10 题量表；第 10 题（自伤）红色醒目
export function EpdsForm({ detail, onChange }: { detail: { q: number; a: number }[]; onChange: (d: { q: number; a: number }[]) => void }) {
  const ans = (q: number) => detail.find((x) => x.q === q)?.a
  const set = (q: number, a: number) => {
    const rest = detail.filter((x) => x.q !== q)
    onChange([...rest, { q, a }].sort((x, y) => x.q - y.q))
  }
  return (
    <div>
      {EPDS_QUESTIONS.map((text, i) => {
        const q = i + 1
        const a = ans(q)
        const harm = q === 10
        return (
          <div key={q} className="epds-item" style={harm ? { background: 'var(--red-soft)', borderColor: '#efc3c3' } : undefined}>
            <div className="small strong">第 {q} 题{harm ? '（安全题）' : ''}：{text}</div>
            <div className="seg mt8">
              {EPDS_OPTIONS.map((label, k) => (
                <span key={k} className={`opt ${a === k ? 'on' : ''}`}
                  style={harm && a === k && k >= 1 ? { background: 'var(--red)', borderColor: 'var(--red)', color: '#fff' } : undefined}
                  onClick={() => set(q, k)}>{label}</span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface FormProps {
  value: MoodCarePayload
  onChange: (v: MoodCarePayload) => void
  pendingReports?: MoodRecord[]
}

// 访视中的情绪关怀录入卡片（含离线草稿：数据随访视草稿一起本地持久化）
export function MoodCareForm({ value, onChange, pendingReports = [] }: FormProps) {
  const [open, setOpen] = useState(false)
  const [showEpds, setShowEpds] = useState(false)
  const set = (patch: Partial<MoodCarePayload>) => onChange({ ...value, ...patch })
  const detail = value.epds_detail || []
  const answered = detail.length
  const score = useMemo(() => (answered ? epdsScore(detail) : null), [detail])
  const harm = useMemo(() => (answered ? selfHarmFrom(detail) : !!value.self_harm), [detail, value.self_harm])
  const grade = score != null ? epdsLevel(score, harm) : null

  return (
    <div className="mood-care">
      <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} style={{ width: 'auto' }} />
        产妇表达持续哭泣、睡眠差或情绪异常 —— 展开情绪关怀记录（EPDS 量表 / 家属支持 / 自伤想法 / 建议）
      </label>

      {pendingReports.length > 0 && (
        <div className="alert-box warn mt8" style={{ marginBottom: open ? 8 : 0 }}>
          <b>待核实的家属代述 {pendingReports.length} 条</b>，请与产妇当面表述核对：
          {pendingReports.map((r) => (
            <div key={r.id} className="small mt8" style={{ borderTop: '1px dashed #f3d9ae', paddingTop: 6 }}>
              {r.reporter_name || '家属'} · 观察于 {fmtTime(r.recorded_at)}：
              {r.crying ? '持续哭泣 ' : ''}睡眠{r.sleep_quality || '未填'} · 家属支持评价「{r.family_support || '未填'}」
              {r.self_harm ? <b style={{ color: 'var(--red)' }}> · 家属担心其有伤害自己的念头</b> : null}
              {r.care_pressure ? <div className="muted">代述内容：{r.care_pressure}</div> : null}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="mt8">
          <div className="field">
            <label>EPDS 爱丁堡产后抑郁量表</label>
            <button type="button" className="btn ghost sm" onClick={() => setShowEpds(!showEpds)}>
              {showEpds ? '收起量表' : `展开量表逐题填写（已答 ${answered}/10）`}
            </button>
            {showEpds && <div className="mt8"><EpdsForm detail={detail} onChange={(d) => set({ epds_detail: d })} /></div>}
            {score != null && (
              <div className="mt8 row between">
                <span className="strong">EPDS 总分：<span style={{ color: grade?.level === '高' ? 'var(--red)' : grade?.level === '中' ? 'var(--amber)' : 'var(--green)' }}>{score} / 30</span></span>
                <RiskBadge level={grade?.level === '高' ? '高' : grade?.level === '中' ? '中' : '低'} />
              </div>
            )}
            {grade && <div className="hint" style={{ color: grade.level === '高' ? 'var(--red)' : 'var(--muted)' }}>{grade.summary}</div>}
          </div>

          <div className="grid2">
            <label className="field row small" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!value.crying} onChange={(e) => set({ crying: e.target.checked })} style={{ width: 'auto' }} />
              持续哭泣
            </label>
            <div className="field">
              <label>产妇睡眠</label>
              <Seg options={SLEEP_OPTS} value={value.sleep_quality || ''} onChange={(v) => set({ sleep_quality: v })} />
            </div>
          </div>
          <div className="field">
            <label>家属支持（产妇评价）</label>
            <Seg options={SUPPORT_OPTS} value={value.family_support || ''} onChange={(v) => set({ family_support: v })} />
          </div>

          <label className="field" style={{ background: harm ? 'var(--red-soft)' : undefined, borderRadius: 10, padding: harm ? 10 : 0 }}>
            <span className="small strong" style={{ color: harm ? 'var(--red)' : undefined }}>是否有自伤/伤害宝宝的想法</span>
            <label className="row small" style={{ gap: 6, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={!!harm} onChange={(e) => set({ self_harm: e.target.checked })} style={{ width: 'auto' }} />
              产妇表达过自伤想法（或 EPDS 第 10 题阳性）——<b style={{ color: 'var(--red)' }}>紧急风险，立即按危机流程处置</b>
            </label>
            {harm && (
              <textarea className="mt8" rows={2} placeholder="想法出现的时间/频率/具体内容、是否有计划、当前陪伴情况（仅护士与社区医生可见）"
                value={value.self_harm_note || ''} onChange={(e) => set({ self_harm_note: e.target.value })} />
            )}
          </label>

          <div className="field">
            <label>照护压力与来源（帮助后续判断风险来自照护压力、睡眠不足还是家庭支持不足）</label>
            <textarea rows={2} placeholder="如：夜间独自喂奶、丈夫加班、与长辈育儿冲突、病耻感等"
              value={value.care_pressure || ''} onChange={(e) => set({ care_pressure: e.target.value })} />
          </div>
          <div className="field">
            <label>风险归因（可多选）</label>
            <MultiPill options={[...RISK_FACTORS, '其他']} value={value.risk_factors || []} onChange={(v) => set({ risk_factors: v })} />
          </div>
          <div className="field">
            <label>社区处置（可多选）</label>
            <MultiPill options={MOOD_PLANS} tone="red" value={value.followup_plan?.length ? value.followup_plan : (grade?.plans || [])} onChange={(v) => set({ followup_plan: v })} />
            <div className="hint">心理咨询 / 增加电话回访 / 转妇保门诊，将生成敏感随访事项并跟踪闭环</div>
          </div>
          <div className="field">
            <label>护士建议（临床记录：家属端不展示）</label>
            <textarea rows={2} placeholder="陪伴要求、转诊安排、复评计划等"
              value={value.suggestion || ''} onChange={(e) => set({ suggestion: e.target.value })} />
          </div>
          <div className="field">
            <label>给家属的温和提醒（家属端仅展示这段，不含分数与敏感内容）</label>
            <textarea rows={2} placeholder="如：妈妈产后情绪脆弱较常见，请多分担夜间照护、多倾听陪伴，社区提供免费心理咨询"
              value={value.family_notice || ''} onChange={(e) => set({ family_notice: e.target.value })} />
          </div>
          <div className="field">
            <label>内部备注（仅护士可见，社区医生与家属均不可见）</label>
            <textarea rows={2} placeholder="如：家属病耻感强、产妇要求对分数保密、上门沟通注意事项"
              value={value.nurse_note || ''} onChange={(e) => set({ nurse_note: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = { 待核实: 'amber', 进行中: 'coral', 已结束: 'green' }

// 单条情绪关怀记录卡片；viewer 角色控制字段可见性
export function MoodRecordCard({ rec, onChanged }: { rec: MoodRecord; onChanged?: () => void }) {
  const user = useAuth((s) => s.user)
  const isNurse = user?.role === 'nurse'
  const [follow, setFollow] = useState(false)
  return (
    <div className="card" style={rec.self_harm ? { borderColor: '#efc3c3' } : undefined}>
      <div className="row between">
        <span className="strong">
          {rec.source === '家属代述' ? '👪 家属代述' : '🩺 产妇自述'} · {fmtTime(rec.recorded_at)}
        </span>
        <div className="row">
          {rec.self_harm ? <Badge color="red">有自伤想法</Badge> : null}
          {rec.epds_score != null && <Badge color={rec.epds_score >= 13 ? 'red' : rec.epds_score >= 9 ? 'amber' : 'green'}>EPDS {rec.epds_score}</Badge>}
          <Badge color={STATUS_COLOR[rec.status] || 'gray'}>{rec.status}</Badge>
        </div>
      </div>
      <div className="small muted mt8">
        采集时间 {fmtTime(rec.recorded_at)} · {rec.source === '家属代述' ? `代述人 ${rec.reporter_name || '家属'}` : `录入 ${rec.recorded_by}`}
      </div>

      <div className="grid2 mt8 small">
        <div>持续哭泣：{rec.crying ? <b style={{ color: 'var(--amber)' }}>是</b> : '否'}</div>
        <div>睡眠：{rec.sleep_quality || '-'}</div>
        <div>家属支持：{rec.family_support || '-'}</div>
        <div>风险归因：{rec.risk_factors.length ? rec.risk_factors.join('、') : '-'}</div>
      </div>

      {rec.care_pressure && <div className="small mt8">📝 {rec.care_pressure}</div>}
      {rec.self_harm && rec.self_harm_note && (
        <div className="alert-box danger mt8" style={{ marginBottom: 8 }}>自伤想法记录：{rec.self_harm_note}</div>
      )}
      {rec.epds_detail.length > 0 && (
        <details className="mt8 small">
          <summary style={{ cursor: 'pointer' }}>EPDS 答题明细（{rec.epds_detail.length}/10）</summary>
          <div className="muted mt8">
            {rec.epds_detail.sort((a, b) => a.q - b.q).map((x) => (
              <span key={x.q} className="badge gray" style={{ margin: 2 }}>第{x.q}题→{x.a}</span>
            ))}
          </div>
        </details>
      )}
      {rec.followup_plan.length > 0 && (
        <div className="row wrap mt8">{rec.followup_plan.map((p) => <Badge key={p} color="red">{p}</Badge>)}</div>
      )}
      {rec.suggestion && <div className="advice-pre mt8">{rec.suggestion}</div>}
      {rec.family_notice && (
        <div className="alert-box info mt8" style={{ marginBottom: 8 }}>
          <b>给家属的提醒（家属端可见）：</b>{rec.family_notice}
        </div>
      )}
      {isNurse && rec.nurse_note && (
        <div className="alert-box warn mt8" style={{ marginBottom: 8 }}>
          <b>🔒 内部备注（仅护士）：</b><span style={{ whiteSpace: 'pre-wrap' }}>{rec.nurse_note}</span>
        </div>
      )}
      {rec.conflict_with && (
        <div className="alert-box danger mt8" style={{ marginBottom: 8 }}>
          <b>⚠ 来源冲突：</b>{rec.conflict_note}（两份来源均已保留，供心理咨询/妇保门诊综合判断）
        </div>
      )}
      {(rec.care_status || rec.mood_trend) && (
        <div className="small mt8">
          最近回访：情绪<b>{rec.mood_trend || '-'}</b> · 帮助接受情况<b>{rec.care_status || '-'}</b>
        </div>
      )}
      {isNurse && rec.status !== '已结束' && onChanged && (
        <div className="row mt8">
          <button className="btn teal sm" onClick={() => setFollow(true)}>📞 记录回访</button>
        </div>
      )}
      {follow && <FollowUpModal rec={rec} onClose={() => setFollow(false)} onDone={() => { setFollow(false); onChanged!(); toast('回访已记录') }} />}
    </div>
  )
}

export function FollowUpModal({ rec, onClose, onDone }: { rec: MoodRecord; onClose: () => void; onDone: () => void }) {
  const [trend, setTrend] = useState(rec.mood_trend || '持平')
  const [accept, setAccept] = useState(rec.care_status || '未联系')
  const [note, setNote] = useState('')
  const [plans, setPlans] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try {
      await api.post(`/api/mood/records/${rec.id}/followup`, { mood_trend: trend, care_status: accept, note, followup_plan: plans })
      onDone()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`情绪关怀回访 · ${fmtTime(rec.recorded_at)}`} onClose={onClose}>
      <div className="field">
        <label>情绪变化</label>
        <div className="seg">{['好转', '持平', '加重'].map((t) => <span key={t} className={`opt ${trend === t ? 'on' : ''}`} onClick={() => setTrend(t)}>{t}</span>)}</div>
      </div>
      <div className="field">
        <label>是否接受帮助（心理咨询/妇保门诊/热线）</label>
        <div className="seg">{['未联系', '已拒绝', '考虑中', '已接受'].map((t) => <span key={t} className={`opt ${accept === t ? 'on' : ''}`} onClick={() => setAccept(t)}>{t}</span>)}</div>
      </div>
      <div className="field">
        <label>追加处置（可选）</label>
        <MultiPill options={MOOD_PLANS} tone="red" value={plans} onChange={setPlans} />
      </div>
      <div className="field">
        <label>回访记录（追加到内部备注）</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="回访方式、产妇表达、睡眠变化、家属配合情况等" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '保存回访'}</button>
    </Modal>
  )
}

// 双来源对照：同档案内产妇自述与家属代述并排展示，冲突高亮
export function SourceCompare({ records }: { records: MoodRecord[] }) {
  const mother = records.filter((r) => r.source === '产妇自述')
  const family = records.filter((r) => r.source === '家属代述')
  if (!family.length) return null
  return (
    <div className="card">
      <div className="card-title"><span className="dot" style={{ background: 'var(--red)' }} />双来源核对（产妇表述 vs 家属代述）</div>
      <div className="small muted mb8">两份来源及各自采集时间均保留；不一致处以红色标出，供后续心理咨询或妇保门诊判断风险来源。</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="cmp-table">
          <thead><tr><th>采集时间</th><th>来源</th><th>持续哭泣</th><th>睡眠</th><th>家属支持评价</th><th>自伤想法</th></tr></thead>
          <tbody>
            {[...family, ...mother].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).map((r) => (
              <tr key={r.id} style={r.conflict_with ? { background: 'var(--red-soft)' } : undefined}>
                <td>{fmtTime(r.recorded_at)}</td>
                <td>{r.source === '家属代述' ? `👪 ${r.reporter_name || '家属'}代述` : '🩺 产妇自述'}</td>
                <td>{r.crying ? '是' : '否'}</td>
                <td>{r.sleep_quality || '-'}</td>
                <td>{r.family_support || '-'}</td>
                <td>{r.self_harm ? <b style={{ color: 'var(--red)' }}>是</b> : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.some((r) => r.conflict_with) && (
        <div className="alert-box danger mt8" style={{ marginBottom: 0 }}>
          {records.filter((r) => r.conflict_with).map((r) => <div key={r.id}>⚠ {r.conflict_note}</div>)}
        </div>
      )}
    </div>
  )
}

export type { MoodGrade }
