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
  closed_by: string | null; close_note: string; sensitive?: number
  mother_name?: string; baby_name?: string; birth_date?: string
  address?: string; contact_name?: string; contact_phone?: string
}

// 产妇情绪关怀（敏感）：护士/社区医生可见全量；家属端只见必要提醒
export interface MoodCareLog {
  id: number; care_id: number; kind: string
  action: string; mood_change: string; help_accepted: string
  note: string; created_by: string; created_at: string
}

export interface MoodCare {
  id: number; archive_id: number; visit_id: number | null
  source: 'nurse_visit' | 'family_report'
  persistent_crying: string; sleep_quality: string
  epds_score: number | null; family_support: string; care_hands: string
  self_harm: string; risk_factors: string[]; mood_text: string
  advice: string; note: string; status: string
  created_by: string; created_at: string
  closed_at: string | null; closed_by: string | null; close_note: string
  severity: string; logs: MoodCareLog[]
}

export interface MoodConflict {
  dimension: string
  nurseValue: string; nurseTime: string; nurseSource: string
  familyValue: string; familyTime: string; familySource: string
}

export interface MoodCarePayload {
  persistent_crying?: string; sleep_quality?: string
  epds_score?: number | null; family_support?: string
  self_harm?: string; risk_factors?: string[]; advice?: string
}

export interface FamilyMoodReminder { active: boolean; actions: string[]; reminder: string }
export interface FamilyMoodReport {
  id: number; mood_text: string; sleep_quality: string; care_hands: string
  note: string; status: string; created_at: string
}

export interface DocumentItem { id: number; type: string; filename: string; data_url?: string; note: string; created_at: string }
export interface Consult { id: number; question: string; status: string; reply: string; replied_by: string | null; created_at: string; replied_at: string | null }
export interface EventItem { id: number; kind: string; title: string; detail: string; actor: string; created_at: string }

export interface ArchiveDetail {
  archive: Archive; appointments: Appointment[]; visits: Visit[]
  followups: Followup[]; documents: DocumentItem[]; consults: Consult[]; events: EventItem[]
  moodCares?: MoodCare[]; moodConflicts?: MoodConflict[]; moodRiskSources?: string[]
}

export interface Dashboard {
  stats: { unvisited: number; jaundiceAlerts: number; maternalRisks: number; moodCares?: number; openFollowups: number; todayAppointments: number }
  followupsByType: Record<string, number>
  todayAppointments: Appointment[]
  recentHighRiskVisits: { id: number; visit_time: string; risk_level: string; bilirubin: number | null; weight: number | null; archive_id: number; mother_name: string; baby_name: string }[]
}

export interface FamilyOverview {
  archive: Archive; visits: Visit[]; followups: Followup[]
  nextAppointment: Appointment | null; appointments: Appointment[]
  documents: DocumentItem[]; consults: Consult[]
  moodCare?: FamilyMoodReminder | null; moodReports?: FamilyMoodReport[]
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
