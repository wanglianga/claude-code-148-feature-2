// 与服务端 server/mood.js 同构的 EPDS 评分与分级（家属端不使用评分，仅护士端）
import type { EpdsAnswer } from './types'

export const EPDS_QUESTIONS = [
  '我能看到事情有趣的一面，并能开怀大笑',
  '我怀着愉快的心情期待事情',
  '当事情出错时，我会毫无必要地责备自己',
  '我会无缘无故地感到焦虑或担心',
  '我会无缘无故地感到害怕或惊慌',
  '很多事情涌向我，使我透不过气来',
  '我难以入睡，因为心里总想着事',
  '我感到悲伤或痛苦',
  '我很不开心，甚至哭泣',
  '我曾想过要伤害自己',
]
// 每题 4 个选项，按频率递增；第 1、2 题为正向表述需反向计分
export const EPDS_OPTIONS = ['和以前一样', '偶尔/有点', '经常/有时', '总是/大多数时候']
const POSITIVE_ITEMS = new Set([1, 2])

export function epdsScore(detail: EpdsAnswer[]): number {
  let total = 0
  for (const { q, a } of detail) {
    if (!Number.isInteger(a) || a < 0 || a > 3) continue
    total += POSITIVE_ITEMS.has(Number(q)) ? 3 - a : a
  }
  return total
}

export function selfHarmFrom(detail: EpdsAnswer[]): boolean {
  const item = detail.find((x) => Number(x.q) === 10)
  return !!item && Number(item.a) >= 1
}

export interface MoodGrade { level: '低' | '中' | '高'; summary: string; advice: string; plans: string[] }

export function epdsLevel(score: number, selfHarm: boolean): MoodGrade {
  if (selfHarm || score >= 13) {
    return {
      level: '高',
      summary: selfHarm ? `EPDS ${score} 分，第 10 题提示有自伤想法（紧急风险）` : `EPDS ${score} 分，达到 13 分高分线`,
      advice: selfHarm
        ? '产妇存在自伤想法，属紧急心理关怀风险：确保 24 小时有人陪伴、移除危险物品，立即联系妇保门诊/心理危机干预热线，必要时转精神专科评估。'
        : 'EPDS 评分偏高，建议安排心理咨询并转妇保门诊进一步评估，本周内增加电话回访。',
      plans: selfHarm ? ['转妇保门诊', '增加电话回访', '心理咨询'] : ['心理咨询', '增加电话回访', '转妇保门诊'],
    }
  }
  if (score >= 9) {
    return {
      level: '中',
      summary: `EPDS ${score} 分，提示产后情绪困扰（9~12 分）`,
      advice: 'EPDS 提示产后情绪困扰，建议安排心理咨询并增加电话回访，1~2 周后复评。',
      plans: ['心理咨询', '增加电话回访'],
    }
  }
  return {
    level: '低',
    summary: `EPDS ${score} 分，暂未见明显抑郁倾向（0~8 分）`,
    advice: 'EPDS 在正常范围，结合持续哭泣/睡眠情况给予情绪疏导与家庭支持指导，常规回访观察。',
    plans: ['增加电话回访'],
  }
}

export const RISK_FACTORS = ['照护压力', '睡眠不足', '家庭支持不足']
export const MOOD_PLANS = ['心理咨询', '增加电话回访', '转妇保门诊']
