/**
 * 安全巡查 / 隐患上报共用的领域规则。
 *
 * 巡查入口与上报入口不允许各自再写一遍判定：编号重复、隐患描述为空、整改措施缺失、
 * 巡查类别不对这四项校验，以及处置结论的取用，全部集中在这里，两个入口调用同一份。
 */
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

export const SAFETY_KEY = 'safety'
export const ACCEPTANCE_KEY = 'acceptance'

// 环节单向推进：待巡查 → 巡查中 → 已整改 → 已上报 → 已办结，只能往后，不能回退。
export const SAFETY_STATUSES = ['待巡查', '巡查中', '已整改', '已上报', '已办结'] as const
export type SafetyStatus = (typeof SAFETY_STATUSES)[number]

const ACTION_TARGETS: Record<string, SafetyStatus> = {
  提交巡查: '巡查中',
  确认整改: '已整改',
  上报隐患: '已上报',
  批复办结: '已办结',
}

// 合法巡查类别在此单点维护，判定「巡查类别不对」时以这份为准。
export const VALID_INSPECT_CATEGORIES = ['日常巡查', '专项巡查', '季节性巡查', '复工复查']

// 巡查类别字段名两个入口共用，避免一边读「巡查类别」一边读别的字段。
export const FIELD_CODE = '巡查编号'
export const FIELD_CATEGORY = '巡查类别'
export const FIELD_HAZARD = '隐患描述'
export const FIELD_MEASURE = '整改措施'
export const FIELD_AREA = '巡查区域'
export const FIELD_INSPECTOR = '巡查人'
export const FIELD_CONCLUSION = '处置结论'

export type EvaluateStage = '巡查' | '整改' | '上报'

export type SafetyEvaluation = {
  pass: boolean
  issues: string[]
  /** 本次共用规则算出的处置结论；有历史留存结论时以历史为准，本字段仅用于对照。 */
  conclusion: string
}

function fieldText(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

/**
 * 共用判定。两个入口都必须经过这里，结论才会一致。
 *
 * @param stage 所处环节：巡查环节不强制整改措施，整改与上报环节四项全查。
 */
export function evaluateHazard(
  row: EntryRow,
  rows: EntryRow[],
  stage: EvaluateStage,
): SafetyEvaluation {
  const issues: string[] = []

  const code = fieldText(row, FIELD_CODE)
  if (!code) {
    issues.push('巡查编号为空，无法登记')
  } else if (
    rows.some((other) => Number(other.id) !== Number(row.id) && fieldText(other, FIELD_CODE) === code)
  ) {
    issues.push(`巡查编号「${code}」与已有巡查记录重复`)
  }

  if (!fieldText(row, FIELD_HAZARD)) {
    issues.push('隐患描述为空，需先填写隐患描述')
  }

  // 整改措施在提交巡查时尚不必落，但整改、上报两个环节必须已经写好。
  if (stage !== '巡查' && !fieldText(row, FIELD_MEASURE)) {
    issues.push('整改措施没写，需先补齐整改措施')
  }

  if (!VALID_INSPECT_CATEGORIES.includes(fieldText(row, FIELD_CATEGORY))) {
    issues.push(
      `巡查类别不对，应为 ${VALID_INSPECT_CATEGORIES.join('、')} 之一`,
    )
  }

  const pass = issues.length === 0
  const conclusion = pass
    ? stage === '巡查'
      ? '巡查通过，准予整改'
      : stage === '整改'
        ? '整改合格，准予上报'
        : '上报受理，待批复办结'
    : '判定不通过'

  return { pass, issues, conclusion }
}

/**
 * 处置结论取用规则（两个入口共用）：
 * 1. 巡查原单上已经留存的结论直接沿用，不因为本次规则重构被重算；
 * 2. 历史结论与现在的共用规则冲突时，以巡查原单为准；
 * 3. 没有留存结论时，才用共用规则当场判定。
 */
export function getDisposalConclusion(
  row: EntryRow,
  rows: EntryRow[],
): { conclusion: string; frozen: boolean } {
  const stored = fieldText(row, FIELD_CONCLUSION)
  if (stored) {
    return { conclusion: stored, frozen: true }
  }
  const stage = stageForStatus(String(row.status))
  return { conclusion: evaluateHazard(row, rows, stage).conclusion, frozen: false }
}

function stageForStatus(status: string): EvaluateStage {
  if (status === '待巡查') {
    return '巡查'
  }
  if (status === '巡查中') {
    return '整改'
  }
  return '上报'
}

/** 隐患描述两个入口读同一字段，保证内容一致。 */
export function readHazardDescription(row: EntryRow): string {
  return fieldText(row, FIELD_HAZARD)
}

/** 列表页取处置结论的便捷入口，结论规则与 getDisposalConclusion 完全一致。 */
export function conclusionSnapshot(
  row: EntryRow,
  allSafetyRows: EntryRow[],
): { conclusion: string; frozen: boolean } {
  return getDisposalConclusion(row, allSafetyRows)
}

function findRow(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(SAFETY_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  return index < 0 ? null : { rows, index }
}

function isForward(current: string, target: SafetyStatus): boolean {
  const from = SAFETY_STATUSES.indexOf(current as SafetyStatus)
  const to = SAFETY_STATUSES.indexOf(target)
  // 环节单向推进：待巡查 → 巡查中 → 已整改 → 已上报 → 已办结，只能逐格往后，
  // 不允许跳格（跳过整改直接上报在此拦下），也不允许同态重复操作或回退。
  return from >= 0 && to === from + 1
}

/**
 * 巡查 / 上报动作的统一入口。四个动作共用同一份判定与流转约束：
 * - 跳过整改直接上报会被拦下（上报隐患要求当前已是「已整改」）；
 * - 已上报之后不允许回到「巡查中」；
 * - 已留存处置结论的原单，结论不重算。
 */
export function executeSafetyAction(id: number, action: string): ActionResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `安全巡查记录没有登记「${action}」这个动作` }
  }
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的安全巡查记录` }
  }
  const { rows, index } = found
  const current = String(rows[index].status)

  const targetIndex = SAFETY_STATUSES.indexOf(target)
  const currentIndex = SAFETY_STATUSES.indexOf(current as SafetyStatus)

  // 上报之后不允许回到「巡查中」（也不允许回到更早环节）。
  if (
    currentIndex >= SAFETY_STATUSES.indexOf('已上报') &&
    targetIndex <= SAFETY_STATUSES.indexOf('巡查中')
  ) {
    return {
      ok: false,
      message: `已上报后的记录不允许再回到「巡查中」，当前状态「${current}」`,
    }
  }
  if (!isForward(current, target)) {
    return {
      ok: false,
      message: `安全巡查环节单向推进，不能由「${current}」流转到「${target}」`,
    }
  }

  const row = rows[index]
  const stage: EvaluateStage =
    target === '巡查中' ? '巡查' : target === '已整改' ? '整改' : '上报'
  const evaluation = evaluateHazard(row, rows, stage)
  if (!evaluation.pass) {
    return { ok: false, message: evaluation.issues.join('；') }
  }

  const updated: EntryRow = { ...row, status: target }

  // 处置结论只在巡查提交时按原单口径落一次；整改、上报、批复不再改写，
  // 保证「照原来的处置结论留存，不因重构被重算」。
  if (action === '提交巡查' && !fieldText(row, FIELD_CONCLUSION)) {
    updated[FIELD_CONCLUSION] = evaluation.conclusion
  }

  if (target === '已办结') {
    updated.pending = false
  }
  saveRows(SAFETY_KEY, rows.map((item, i) => (i === index ? updated : item)))

  // 隐患上报办结的批复是验收台账的唯一驱动：批复成功后追加一条验收记录。
  let message = `安全巡查记录已${action}，当前状态「${target}」`
  if (action === '批复办结') {
    const ledgerResult = appendAcceptanceLedger(updated, rows)
    message += ledgerResult.created
      ? `；批复意见已驱动生成验收台账「${ledgerResult.code}」`
      : '；批复意见已在验收台账留存，未重复建账'
  }
  return { ok: true, message }
}

/** 批复办结 → 验收台账：同一巡查原单的批复只建一次账，重复批复不重复建账。 */
function appendAcceptanceLedger(
  source: EntryRow,
  safetyRows: EntryRow[],
): { created: boolean; code: string } {
  const rows = listRows(ACCEPTANCE_KEY)
  const code = ledgerCode(source)
  const existed = rows.some((row) => fieldText(row, '验收单号') === code)

  if (existed) {
    return { created: false, code }
  }

  const today = new Date().toISOString().slice(0, 10)
  const pendingIssues = evaluateHazard(source, safetyRows, '上报').issues.length
  const ledger: EntryRow = {
    id: (rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1),
    status: '已通过',
    pending: false,
    abnormal: false,
    验收单号: code,
    验收探方: fieldText(source, FIELD_AREA),
    验收类别: `隐患验收-${fieldText(source, FIELD_CATEGORY)}`,
    验收人: fieldText(source, FIELD_INSPECTOR),
    验收日期: today,
    遗留问题数: pendingIssues,
    验收结论: `隐患上报办结批复：${fieldText(source, FIELD_CONCLUSION) || '同意办结'}`,
    验收状态: '已通过',
    来源巡查编号: fieldText(source, FIELD_CODE),
    隐患描述: readHazardDescription(source),
  }
  saveRows(ACCEPTANCE_KEY, [...rows, ledger])
  return { created: true, code }
}

function ledgerCode(source: EntryRow): string {
  return `HAZ-${fieldText(source, FIELD_CODE).replace(/[^A-Za-z0-9]/g, '')}`
}
