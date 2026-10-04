// 与后端对应的数据类型
export interface User { id: number; username: string; role: 'nurse' | 'family' | 'doctor'; name: string; title: string; phone: string }

export interface Archive {
  id: number; family_user_id: number | null
  mother_name: string; baby_name: string; baby_gender: string
  birth_date: string; birth_weight: number; delivery_mode: string; feeding_type: string
  jaundice_risk: string; maternal_wound: string; address: string
  contact_name: string; contact_phone: string; discharge_date: string
  care_ability: string; notes: string; created_at: string
  pending_appts?: number; open_followups?: number; last_risk?: string | null
  last_bilirubin?: number | null; next_appt?: string | null
}

export interface Appointment {
  id: number; archive_id: number; nurse_id: number | null; type: string
  scheduled_time: string; status: string; reason: string
  mother_name?: string; baby_name?: string; address?: string
  contact_name?: string; contact_phone?: string; jaundice_risk?: string; nurse_name?: string
}

export interface Visit {
  id: number; client_id: string | null; appointment_id: number | null
  archive_id: number; nurse_id: number | null; visit_time: string
  weight: number | null; bilirubin: number | null; bilirubin_site: string
  cord: string; stool_count: number; stool_color: string; urine_count: number
  feeding_type: string; feeding_freq: number; spit_up: string; sleep: string
  breast: string; mood: string; wound_check: string; care_ability: string
  device_issue: number; photos: string[]; advice: string
  risk_level: string; flags: string[]
  need_recheck: number; need_referral: number; need_lactation: number; need_phone: number
  created_offline: number; created_at: string
}

export interface Followup {
  id: number; archive_id: number; visit_id: number | null; type: string
  title: string; detail: string; status: string; due_date: string | null
  created_by: string; created_at: string; closed_at: string | null
  closed_by: string | null; close_note: string
  mother_name?: string; baby_name?: string; birth_date?: string
  address?: string; contact_name?: string; contact_phone?: string
}

export interface DocumentItem { id: number; type: string; filename: string; data_url?: string; note: string; created_at: string }
export interface Consult { id: number; question: string; status: string; reply: string; replied_by: string | null; created_at: string; replied_at: string | null }
export interface EventItem { id: number; kind: string; title: string; detail: string; actor: string; created_at: string }

// —— 产妇情绪异常关怀 ——
export type EpdsAnswer = { q: number; a: number }

export interface MoodCarePayload {
  recorded_at?: string
  visit_id?: number | null
  epds_detail?: EpdsAnswer[]
  epds_score?: number | null
  crying?: boolean
  sleep_quality?: string        // 良好/间断/严重不足
  family_support?: string       // 充分/一般/不足
  self_harm?: boolean
  self_harm_note?: string
  care_pressure?: string
  risk_factors?: string[]       // 照护压力/睡眠不足/家庭支持不足/其他
  suggestion?: string
  family_notice?: string
  nurse_note?: string
  followup_plan?: string[]      // 心理咨询/增加电话回访/转妇保门诊
  care_status?: string          // 未联系/已拒绝/考虑中/已接受
  mood_trend?: string           // 好转/持平/加重
}

export interface MoodRecord {
  id: number; archive_id: number; visit_id: number | null
  source: '产妇自述' | '家属代述'; reporter_name: string; recorded_by: string
  recorded_at: string; epds_score: number | null; epds_detail: EpdsAnswer[]
  crying: number; sleep_quality: string; family_support: string
  self_harm: number; self_harm_note: string; care_pressure: string
  risk_factors: string[]; suggestion: string; family_notice: string
  nurse_note: string; status: '待核实' | '进行中' | '已结束'
  followup_plan: string[]; conflict_with: number | null; conflict_note: string
  care_status: string; mood_trend: string; created_at: string
  own_report?: boolean
}

export interface MoodGrade {
  level: '低' | '中' | '高'; summary: string; advice: string; plans: string[]
}

export interface MoodCareGroup {
  archive_id: number; mother_name: string; baby_name: string
  address: string; contact_name: string; contact_phone: string
  records: MoodRecord[]; latest: MoodRecord
  hasSelfHarm: boolean; pendingVerify: boolean
}

export interface ArchiveDetail {
  archive: Archive; appointments: Appointment[]; visits: Visit[]
  followups: Followup[]; mood_records: MoodRecord[]; documents: DocumentItem[]; consults: Consult[]; events: EventItem[]
}

export interface Dashboard {
  stats: { unvisited: number; jaundiceAlerts: number; maternalRisks: number; openFollowups: number; todayAppointments: number; moodSelfHarm: number; moodPendingVerify: number; moodActive: number }
  followupsByType: Record<string, number>
  todayAppointments: Appointment[]
  recentHighRiskVisits: { id: number; visit_time: string; risk_level: string; bilirubin: number | null; weight: number | null; archive_id: number; mother_name: string; baby_name: string }[]
}

export interface FamilyOverview {
  archive: Archive; visits: Visit[]; followups: Followup[]
  nextAppointment: Appointment | null; appointments: Appointment[]
  documents: DocumentItem[]; consults: Consult[]
  mood_records: MoodRecord[]; mood_notices: string[]
}

// 访视表单载荷（也是离线草稿的内容）
export interface VisitPayload {
  client_id?: string
  appointment_id?: number | null
  archive_id: number
  visit_time: string
  weight?: number | null; bilirubin?: number | null; bilirubin_site?: string
  cord?: string; stool_count?: number; stool_color?: string; urine_count?: number
  feeding_type?: string; feeding_freq?: number; spit_up?: string; sleep?: string
  breast?: string; mood?: string; wound_check?: string; care_ability?: string
  device_issue?: boolean; photos?: string[]; advice?: string
  mood_care?: MoodCarePayload
}

export interface Assessment {
  riskLevel: string; flags: string[]; advice: string
  needRecheck: number; needReferral: number; needLactation: number; needPhone: number
  ageDays: number; threshold: number; weightLossPct: number | null
}
