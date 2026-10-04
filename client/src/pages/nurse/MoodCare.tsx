// 产妇情绪关怀中心：紧急自伤风险优先、家属代述待核实、进行中关怀与回访追踪
// 医生以只读视角访问：可见临床内容（量表/自伤/归因/建议），护士内部备注与回访操作隐藏
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { MoodCareGroup } from '../../types'
import { useAuth } from '../../store/auth'
import { Badge, Empty } from '../../components/ui'
import { MoodRecordCard } from '../../components/MoodCare'

export default function MoodCare({ doctor }: { doctor?: boolean }) {
  const [groups, setGroups] = useState<MoodCareGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const nav = useNavigate()
  const user = useAuth((s) => s.user)
  const isDoctor = doctor || user?.role === 'doctor'

  function load() {
    setLoading(true)
    api.get<{ groups: MoodCareGroup[] }>('/api/mood/care')
      .then((r) => setGroups(r.groups))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const selfHarm = groups.filter((g) => g.hasSelfHarm)
  const pending = groups.filter((g) => !g.hasSelfHarm && g.pendingVerify)
  const active = groups.filter((g) => !g.hasSelfHarm && !g.pendingVerify)

  if (err) return <div className="alert-box danger">{err}</div>
  return (
    <div>
      <div className="page-title">产妇情绪关怀{isDoctor ? '（社区医生视角）' : ''}</div>
      <div className="page-sub">
        {isDoctor
          ? '可见 EPDS 评分、自伤风险与风险归因以辅助心理咨询/妇保门诊决策；护士内部备注不在医生可见范围'
          : 'EPDS 量表、持续哭泣与睡眠、家属支持、自伤想法；双来源核对；心理咨询 / 增加电话回访 / 转妇保门诊并追踪情绪变化'}
      </div>

      <div className="grid4 mb12">
        <div className="stat red"><div className="num">{selfHarm.length}</div><div className="label">自伤想法·紧急</div></div>
        <div className="stat amber"><div className="num">{pending.length}</div><div className="label">家属代述待核实</div></div>
        <div className="stat coral"><div className="num">{active.length}</div><div className="label">关怀进行中</div></div>
        <div className="stat teal"><div className="num">{groups.length}</div><div className="label">涉及家庭</div></div>
      </div>

      {loading && <Empty text="加载中…" icon="⏳" />}
      {!loading && groups.length === 0 && <Empty text="暂无情绪关怀中的家庭 🎉" icon="🌿" />}

      {selfHarm.length > 0 && <Section title="🚨 紧急：存在自伤想法" groups={selfHarm} nav={nav} load={load} isDoctor={isDoctor} />}
      {pending.length > 0 && <Section title="👪 家属代述 · 待护士上门核实" groups={pending} nav={nav} load={load} isDoctor={isDoctor} />}
      {active.length > 0 && <Section title="💗 关怀进行中" groups={active} nav={nav} load={load} isDoctor={isDoctor} />}
    </div>
  )
}

function Section({ title, groups, nav, load, isDoctor }: { title: string; groups: MoodCareGroup[]; nav: (s: string) => void; load: () => void; isDoctor: boolean }) {
  return (
    <div className="mb12">
      <div className="strong mb8">{title}（{groups.length}）</div>
      {groups.map((g) => (
        <div key={g.archive_id} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 10 }}>
          <div className="row between" style={{ padding: '12px 14px', background: g.hasSelfHarm ? 'var(--red-soft)' : '#fffaf6', borderBottom: '1px solid var(--line)' }}>
            <div style={{ cursor: 'pointer' }} onClick={() => nav(`/nurse/archives/${g.archive_id}`)}>
              <span className="strong">{g.mother_name} · {g.baby_name}</span>
              <div className="small muted">📍 {g.address} · 📞 {g.contact_name} {g.contact_phone}</div>
            </div>
            <div className="row">
              {g.pendingVerify && <Badge color="amber">待核实</Badge>}
              {g.hasSelfHarm && <Badge color="red">自伤想法</Badge>}
              {g.latest.epds_score != null && <Badge color={g.latest.epds_score >= 13 ? 'red' : 'amber'}>EPDS {g.latest.epds_score}</Badge>}
              {!isDoctor && <button className="btn primary sm" onClick={() => nav(`/nurse/visit/new?archiveId=${g.archive_id}`)}>上门核实/记录</button>}
              {isDoctor && <button className="btn ghost sm" onClick={() => nav(`/nurse/archives/${g.archive_id}`)}>档案 →</button>}
            </div>
          </div>
          <div style={{ padding: '10px 14px' }}>
            {g.records.map((r) => <div key={r.id} style={{ marginBottom: 10 }}>
              <MoodRecordCard rec={r} onChanged={load} />
              <div className="small muted" style={{ marginTop: -4 }}>
                {r.conflict_with ? '⚠ 与另一来源存在冲突，已保留两份来源' : ''}
              </div>
            </div>)}
          </div>
        </div>
      ))}
    </div>
  )
}
