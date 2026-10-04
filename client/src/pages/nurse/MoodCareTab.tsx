// 产妇情绪关怀（敏感）：双来源记录、冲突比对、社区安排、回访追踪与闭环
// 仅护士/社区医生可见本页全部内容；家属端只收到必要提醒
import { useState } from 'react'
import { api } from '../../api'
import type { ArchiveDetail, MoodCare } from '../../types'
import { Badge, Empty, Modal, fmtTime, toast } from '../../components/ui'

const SOURCE_LABEL: Record<string, string> = {
  nurse_visit: '护士访视·产妇自述',
  family_report: '家属代填',
}
const SEV_COLOR: Record<string, string> = { 低: 'green', 中: 'amber', 高: 'coral', 危急: 'red' }

export default function MoodCareTab({ d, onChanged }: { d: ArchiveDetail; onChanged: () => void }) {
  const cares = d.moodCares || []
  const conflicts = d.moodConflicts || []
  const riskSources = d.moodRiskSources || []
  const [arranging, setArranging] = useState<MoodCare | null>(null)
  const [tracking, setTracking] = useState<MoodCare | null>(null)
  const [closing, setClosing] = useState<MoodCare | null>(null)

  return (
    <div>
      <div className="alert-box info">
        🔒 敏感记录可见范围：<b>护士</b>与<b>社区医生</b>可见全部内容（量表分、自伤想法、风险来源、双来源冲突）；
        <b>家属端</b>仅显示必要提醒，不展示敏感明细。
      </div>

      {conflicts.length > 0 && (
        <div className="alert-box danger">
          <b>⚠ 家属代填与产妇自述存在出入（双来源并列保留，供心理咨询/妇保门诊研判）</b>
          {conflicts.map((c, i) => (
            <div key={i} className="mt8" style={{ background: '#fff', borderRadius: 10, padding: '8px 10px' }}>
              <div className="strong small">{c.dimension}</div>
              <div className="small mt8">
                👩 产妇自述（{c.nurseSource} · {fmtTime(c.nurseTime)}）：<b>{c.nurseValue}</b>
              </div>
              <div className="small" style={{ marginTop: 2 }}>
                👪 家属代填（{c.familySource} · {fmtTime(c.familyTime)}）：<b>{c.familyValue}</b>
              </div>
            </div>
          ))}
          {riskSources.length > 0 && (
            <div className="row wrap mt8">
              <span className="small strong">风险来源：</span>
              {riskSources.map((x) => <Badge key={x} color="red">{x}</Badge>)}
            </div>
          )}
        </div>
      )}

      {cares.length === 0 && <Empty text="暂无情绪关怀记录，可在访视表单中开启「产妇情绪关怀」建档" icon="🌿" />}

      {cares.map((c) => (
        <div key={c.id} className="card">
          <div className="row between">
            <span className="strong">{SOURCE_LABEL[c.source] || c.source}</span>
            <div className="row">
              <Badge color={SEV_COLOR[c.severity] || 'gray'}>敏感等级 {c.severity}</Badge>
              <Badge color={c.status === '已闭环' ? 'green' : 'amber'}>{c.status}</Badge>
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>
            采集 {fmtTime(c.created_at)} · {c.created_by}
            {c.visit_id ? ` · 关联访视 #${c.visit_id}` : ''}
          </div>

          <div className="grid2 mt8 small">
            {c.source === 'nurse_visit' ? (
              <>
                <div>😢 持续哭泣：<b>{c.persistent_crying}</b></div>
                <div>🌙 睡眠：<b>{c.sleep_quality}</b></div>
                <div>📋 EPDS 量表：<b>{c.epds_score ?? '未评'}</b>{c.epds_score != null && c.epds_score >= 13 ? '（≥13 抑郁风险）' : c.epds_score != null && c.epds_score >= 10 ? '（≥10 需关注）' : ''}</div>
                <div>👪 家属支持：<b>{c.family_support}</b></div>
                <div style={{ gridColumn: '1 / -1' }}>
                  ⚠️ 自伤想法：
                  <b style={{ color: c.self_harm !== '无' ? 'var(--red)' : undefined }}>{c.self_harm}</b>
                  {c.self_harm !== '无' && <span className="muted">（高敏感，家属端不可见）</span>}
                </div>
              </>
            ) : (
              <>
                <div>🙂 情绪（家属代填）：<b>{c.mood_text}</b></div>
                <div>🌙 睡眠：<b>{c.sleep_quality}</b></div>
                <div>👪 照护人手：<b>{c.care_hands}</b></div>
                <div className="muted">家属代填不含量表与自伤评估，待护士核对</div>
              </>
            )}
          </div>

          {c.risk_factors.length > 0 && (
            <div className="row wrap mt8">
              <span className="small muted">风险来源：</span>
              {c.risk_factors.map((x) => <Badge key={x} color="coral">{x}</Badge>)}
            </div>
          )}
          {c.advice && <div className="advice-pre mt8">{c.advice}</div>}
          {c.note && <div className="small muted mt8">备注：{c.note}</div>}

          {c.logs.length > 0 && (
            <div className="mt8">
              {c.logs.map((l) => (
                <div key={l.id} className="small" style={{ padding: '5px 0', borderTop: '1px dashed var(--line)' }}>
                  {l.kind === '安排' ? (
                    <span>📌 安排 <b>{l.action}</b>{l.note ? `（${l.note}）` : ''} · {fmtTime(l.created_at)} · {l.created_by}</span>
                  ) : (
                    <span>📞 回访：情绪<b>{l.mood_change}</b> · 帮助<b>{l.help_accepted}</b>{l.note ? ` · ${l.note}` : ''} · {fmtTime(l.created_at)} · {l.created_by}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {c.status === '已闭环' && (
            <div className="small mt8" style={{ color: 'var(--green)' }}>
              ✔ {fmtTime(c.closed_at)} 由 {c.closed_by} 闭环{c.close_note ? `：${c.close_note}` : ''}
              <span className="muted">（敏感记录保留，仍仅护士/社区医生可见）</span>
            </div>
          )}

          {c.status !== '已闭环' && (
            <div className="row wrap mt8">
              <button className="btn primary sm" onClick={() => setArranging(c)}>安排措施</button>
              <button className="btn teal sm" onClick={() => setTracking(c)}>回访追踪</button>
              <button className="btn ghost sm" onClick={() => setClosing(c)}>完成闭环</button>
            </div>
          )}
        </div>
      ))}

      {arranging && <ArrangeModal c={arranging} onClose={() => setArranging(null)}
        onDone={() => { setArranging(null); onChanged(); toast('已安排关怀措施') }} />}
      {tracking && <TrackModal c={tracking} onClose={() => setTracking(null)}
        onDone={() => { setTracking(null); onChanged(); toast('已记录回访') }} />}
      {closing && <CloseCareModal c={closing} onClose={() => setClosing(null)}
        onDone={() => { setClosing(null); onChanged(); toast('情绪关怀已闭环') }} />}
    </div>
  )
}

function ArrangeModal({ c, onClose, onDone }: { c: MoodCare; onClose: () => void; onDone: () => void }) {
  const [actions, setActions] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (a: string) => setActions((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]))
  async function ok() {
    if (actions.length === 0) return toast('请选择至少一项关怀措施')
    setBusy(true)
    try { await api.post(`/api/mood-cares/${c.id}/actions`, { actions, note }); onDone() }
    catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`安排关怀措施 - ${SOURCE_LABEL[c.source]}`} onClose={onClose}>
      <div className="field">
        <label>社区可安排的措施（生成敏感随访事项，家属端只见必要提醒）</label>
        <div className="seg">
          {['心理咨询', '增加电话回访', '转妇保门诊'].map((a) => (
            <span key={a} className={`opt ${actions.includes(a) ? 'on' : ''}`} onClick={() => toggle(a)}>{a}</span>
          ))}
        </div>
      </div>
      <div className="field">
        <label>安排说明</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：已联系社区心理咨询室，预约周三上午" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认安排'}</button>
    </Modal>
  )
}

function TrackModal({ c, onClose, onDone }: { c: MoodCare; onClose: () => void; onDone: () => void }) {
  const [moodChange, setMoodChange] = useState('平稳')
  const [helpAccepted, setHelpAccepted] = useState('已接受')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try { await api.post(`/api/mood-cares/${c.id}/tracks`, { mood_change: moodChange, help_accepted: helpAccepted, note }); onDone() }
    catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`回访追踪 - ${SOURCE_LABEL[c.source]}`} onClose={onClose}>
      <div className="field">
        <label>情绪变化</label>
        <div className="seg">
          {['好转', '平稳', '加重'].map((x) => (
            <span key={x} className={`opt ${moodChange === x ? 'on' : ''}`} onClick={() => setMoodChange(x)}>{x}</span>
          ))}
        </div>
      </div>
      <div className="field">
        <label>是否接受帮助</label>
        <div className="seg">
          {['已接受', '部分接受', '未接受'].map((x) => (
            <span key={x} className={`opt ${helpAccepted === x ? 'on' : ''}`} onClick={() => setHelpAccepted(x)}>{x}</span>
          ))}
        </div>
      </div>
      <div className="field">
        <label>回访记录</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：电话回访，产妇情绪好转，已同意心理咨询" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '保存回访'}</button>
    </Modal>
  )
}

function CloseCareModal({ c, onClose, onDone }: { c: MoodCare; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function ok() {
    setBusy(true)
    try { await api.post(`/api/mood-cares/${c.id}/close`, { note }); onDone() }
    catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`完成情绪关怀闭环 - ${SOURCE_LABEL[c.source]}`} onClose={onClose}>
      <div className="alert-box info">
        闭环后敏感记录仍保留：护士与社区医生可继续查看，家属端始终只见必要提醒。
      </div>
      <div className="field">
        <label>闭环说明（如：情绪好转已接受心理咨询 / 已转妇保门诊随诊）</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录关怀结果" />
      </div>
      <button className="btn primary block" disabled={busy} onClick={ok}>{busy ? '提交中…' : '确认闭环'}</button>
    </Modal>
  )
}
