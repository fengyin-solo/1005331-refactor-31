import type { EntryRow } from '@/data/types'

/**
 * 安全巡查隐患处置：巡查入口与隐患上报入口共用的唯一一套判定规则。
 *
 * 两个入口都只能调用本文件里的函数，禁止各自再写一份判定；
 * 同一条巡查记录在两个入口得到的处置结论必须完全一致。
 */

export const SAFETY_KEY = 'safety'

/** 允许的巡查类别：不在此名单内的一律判为「巡查类别不对」。 */
export const SAFETY_CATEGORIES = ['现场用电', '高处作业', '深基坑', '消防通道', '脚手架'] as const

/** 隐患处置环节，只能沿这个顺序单向推进。 */
export const SAFETY_STATUS_FLOW = ['待巡查', '巡查中', '已整改', '已上报', '已办结'] as const

export const HAZARD_ACTION_TARGETS: Record<string, string> = {
  提交巡查: '巡查中',
  确认整改: '已整改',
  上报隐患: '已上报',
  批复办结: '已办结',
}

/** 巡查原单上用于留存结论的字段：结论一旦留存，重构后也不得重算。 */
export const VERDICT_FIELD = '处置结论'
export const VERDICT_SOURCE_FIELD = '结论来源'
export const VERDICT_DETAIL_FIELD = '处置说明'
export const APPROVAL_FIELD = '批复结论'
export const APPROVED_AT_FIELD = '办结日期'

export type ViolationCode =
  | 'DUPLICATE_CODE'
  | 'EMPTY_DESCRIPTION'
  | 'MISSING_MEASURE'
  | 'INVALID_CATEGORY'

export interface HazardIssue {
  code: ViolationCode
  message: string
}

export type HazardVerdict = '合格' | '不合格'

export interface HazardDecision {
  verdict: HazardVerdict
  issues: HazardIssue[]
  /** 结论来源：沿用巡查原单的历史留存，还是按现行规则当场核验。 */
  source: '巡查原单' | '本次核验'
}

/** 两处入口读隐患描述的唯一口径：始终读巡查原单上的这一个字段。 */
export function readHazardDescription(row: EntryRow): string {
  return String(row['隐患描述'] ?? '').trim()
}

/**
 * 按现行规则核验一条巡查记录，四类判定都在这里：
 * 巡查编号重复、隐患描述为空、整改措施没写、巡查类别不对。
 * 巡查入口和上报入口调用的是同一个函数，不会再出现两种结论。
 */
export function evaluateHazard(row: EntryRow, allRows: EntryRow[]): HazardIssue[] {
  const issues: HazardIssue[] = []

  const code = String(row['巡查编号'] ?? '').trim()
  if (code === '') {
    issues.push({ code: 'DUPLICATE_CODE', message: '巡查编号不能为空' })
  } else if (
    allRows.some(
      (other) => Number(other.id) !== Number(row.id) && String(other['巡查编号'] ?? '').trim() === code,
    )
  ) {
    issues.push({ code: 'DUPLICATE_CODE', message: `巡查编号「${code}」与其它巡查记录重复` })
  }

  if (readHazardDescription(row) === '') {
    issues.push({ code: 'EMPTY_DESCRIPTION', message: '隐患描述不能为空' })
  }

  if (String(row['整改措施'] ?? '').trim() === '') {
    issues.push({ code: 'MISSING_MEASURE', message: '整改措施未填写，整改环节不能空过' })
  }

  const category = String(row['巡查类别'] ?? '').trim()
  if (!(SAFETY_CATEGORIES as readonly string[]).includes(category)) {
    issues.push({
      code: 'INVALID_CATEGORY',
      message: `巡查类别「${category}」不合法，允许类别：${SAFETY_CATEGORIES.join('、')}`,
    })
  }

  return issues
}

function parseStoredDetail(row: EntryRow): HazardIssue[] {
  // 历史留存只存了文字说明，这里原样还原，不按现行规则重新判定。
  return String(row[VERDICT_DETAIL_FIELD] ?? '')
    .split('；')
    .map((message) => message.trim())
    .filter(Boolean)
    .map((message) => ({ code: 'MISSING_MEASURE' as ViolationCode, message }))
}

/**
 * 处置结论的唯一出口。
 *
 * 巡查原单上已留存结论的，一律沿用原结论（哪怕按现行规则会得出不同结果），
 * 这次重构不会把历史结论重算一遍；两套判定冲突时，以巡查原单为准。
 * 只有原单上没有留存结论时，才按现行共用规则当场核验。
 */
export function resolveHazardDecision(row: EntryRow, allRows: EntryRow[]): HazardDecision {
  const stored = String(row[VERDICT_FIELD] ?? '').trim()
  if (stored === '合格' || stored === '不合格') {
    return { verdict: stored, issues: parseStoredDetail(row), source: '巡查原单' }
  }
  const issues = evaluateHazard(row, allRows)
  return { verdict: issues.length === 0 ? '合格' : '不合格', issues, source: '本次核验' }
}

/**
 * 环节推进校验：待巡查 → 巡查中 → 已整改 → 已上报 → 已办结，只能逐环节向下。
 * 上报之后不允许回到巡查中；从巡查中跳过整改直接上报也在这里拦下。
 */
export function checkHazardFlow(action: string, currentStatus: string): HazardIssue | null {
  const target = HAZARD_ACTION_TARGETS[action]
  if (!target) {
    return { code: 'MISSING_MEASURE', message: `未登记的巡查动作「${action}」` }
  }
  const from = SAFETY_STATUS_FLOW.indexOf(currentStatus as (typeof SAFETY_STATUS_FLOW)[number])
  const to = SAFETY_STATUS_FLOW.indexOf(target as (typeof SAFETY_STATUS_FLOW)[number])

  if (from < 0 || to < 0) {
    return { code: 'MISSING_MEASURE', message: `当前状态「${currentStatus}」不在巡查流转环节内` }
  }
  if (to <= from) {
    return {
      code: 'MISSING_MEASURE',
      message: `巡查环节只能单向推进：已到「${currentStatus}」，不能再执行「${action}」回到「${target}」；上报之后不允许回到巡查中`,
    }
  }
  if (to !== from + 1) {
    return {
      code: 'MISSING_MEASURE',
      message: `不能从「${currentStatus}」直接跳到「${target}」：上报前必须先完成整改，跳过整改的上报一律拦下`,
    }
  }
  return null
}

/**
 * 各环节放行条件。无论动作从巡查入口还是上报入口发起，都走这一份条件。
 */
export function hazardActionBlockers(
  action: string,
  row: EntryRow,
  allRows: EntryRow[],
): HazardIssue[] {
  const decision = resolveHazardDecision(row, allRows)

  if (action === '提交巡查') {
    // 提交巡查时先拦硬性缺陷：编号重复、隐患描述为空、巡查类别不对；
    // 整改措施允许在整改环节补填，不在这一关拦。
    return decision.issues.filter(
      (issue) =>
        issue.code === 'DUPLICATE_CODE' ||
        issue.code === 'EMPTY_DESCRIPTION' ||
        issue.code === 'INVALID_CATEGORY',
    )
  }

  if (action === '确认整改' || action === '上报隐患') {
    // 整改 / 上报都要求结论合格：措施缺失等任何未闭合问题一律拦下。
    // 结论以巡查原单留存为准，不会因为入口不同而变。
    return decision.verdict === '合格' ? [] : decision.issues
  }

  return []
}
