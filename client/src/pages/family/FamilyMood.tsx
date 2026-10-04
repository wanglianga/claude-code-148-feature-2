// 家属端·情绪关怀：查看社区提醒（脱敏）、代填产妇情绪/睡眠/照护人手
// 代填内容将与护士访视记录（产妇自述）并列保留双来源与采集时间，供社区核对
import { useEffect, useState } from 'react'
import { api } from '../../api'
import type { FamilyOverview } from '../../types'
import { Badge, Empty, fmtTime, toast } from '../../components/ui'

export default function FamilyMood() {
  const [d, setD] = useState<FamilyOverview | null>(null)
  const [mood, setMood] = useState('平稳')
  const [sleep, setSleep] = useState('正常')
  const [hands, setHands] = useState('充足')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  function load() { api.get<FamilyOverview>('/api/family/overview').then(setD) }
  useEffect(() => { load() }, [])
  if (!d) return <Empty text="加载中…" icon="⏳" />

  async function submit() {
    setBusy(true)
    try {
      await api.post('/api/mood-cares/family-report', { mood_text: mood, sleep_quality: sleep, care_hands: hands, note })
      toast('已提交，社区护士会核对并跟进')
      setNote(''); load()
    } catch (e: any) { toast(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-title">情绪关怀</div>
      <div className="page-sub">妈妈产后的情绪与睡眠同样需要照顾，有任何担心都可以告诉我们</div>

      {d.moodCare?.active && (
        <div className="alert-box info">
          <b>🌿 社区关怀提醒：</b>{d.moodCare.reminder}
        </div>
      )}

      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: 'var(--teal)' }} />代填妈妈近况</div>
        <div className="small muted mb12">
          您填写的内容会与护士上门访视时妈妈的自述一起核对；如有出入，社区会进一步了解情况，请尽量如实填写。
        </div>
        <div className="field">
          <label>妈妈最近的情绪</label>
          <div className="seg teal">
            {['平稳', '烦躁', '低落', '经常哭泣'].map((x) => (
              <span key={x} className={`opt ${mood === x ? 'on' : ''}`} onClick={() => setMood(x)}>{x}</span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>妈妈最近的睡眠</label>
          <div className="seg teal">
            {['正常', '入睡困难', '易醒', '严重失眠'].map((x) => (
              <span key={x} className={`opt ${sleep === x ? 'on' : ''}`} onClick={() => setSleep(x)}>{x}</span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>家里照护人手</label>
          <div className="seg teal">
            {['充足', '紧张', '不足'].map((x) => (
              <span key={x} className={`opt ${hands === x ? 'on' : ''}`} onClick={() => setHands(x)}>{x}</span>
            ))}
          </div>
        </div>
        <div className="field">
          <label>补充说明（选填）</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="如：最近夜里都是妈妈一个人带娃，睡得不太好" />
        </div>
        <button className="btn primary block" disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交给社区'}</button>
      </div>

      <div className="card">
        <div className="card-title"><span className="dot" />我的代填记录</div>
        {(d.moodReports || []).length === 0 && <Empty text="还没有代填记录" icon="🌿" />}
        {(d.moodReports || []).map((r) => (
          <div key={r.id} className="small" style={{ padding: '7px 0', borderBottom: '1px dashed var(--line)' }}>
            <div className="row between">
              <span>情绪 <b>{r.mood_text}</b> · 睡眠 <b>{r.sleep_quality}</b> · 人手 <b>{r.care_hands}</b></span>
              <Badge color={r.status === '已闭环' ? 'green' : 'teal'}>{r.status === '已闭环' ? '已跟进' : '跟进中'}</Badge>
            </div>
            {r.note && <div className="muted" style={{ marginTop: 2 }}>{r.note}</div>}
            <div className="muted" style={{ marginTop: 2 }}>{fmtTime(r.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
