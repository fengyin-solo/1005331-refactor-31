import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

import {
  APPROVED_AT_FIELD,
  APPROVAL_FIELD,
  HAZARD_ACTION_TARGETS,
  SAFETY_CATEGORIES,
  SAFETY_KEY,
  VERDICT_DETAIL_FIELD,
  VERDICT_FIELD,
  VERDICT_SOURCE_FIELD,
  checkHazardFlow,
  evaluateHazard,
  hazardActionBlockers,
  readHazardDescription,
  resolveHazardDecision,
} from './rules'

/** 隐患上报办结后生成的验收台账，独立存放。 */
export const ACCEPTANCE_LEDGER_KEY = 'hazardAcceptanceLedger'

export interface AcceptanceLedgerEntry {
  台账编号: string
  巡查编号: string
  隐患描述: string
  巡查类别: string
  验收结论: string
  批复结论: string
  办结日期: string
  source: '隐患上报批复'
  [field: string]: string
}

export function listSafetyRows(): EntryRow[] {
  return listRows(SAFETY_KEY)
}

/** 隐患描述的唯一读取口径：巡查入口和上报入口看到的内容必须一致。 */
export function hazardDescription(row: EntryRow): string {
  return readHazardDescription(row)
}

export function hazardConclusion(row: EntryRow): {
  verdict: string
  source: string
  issues: { code: string; message: string }[]
} {
  return resolveHazardDecision(row, listSafetyRows())
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextLedgerNo(ledger: AcceptanceLedgerEntry[]): string {
  return `YSTZ-${String(ledger.length + 1).padStart(4, '0')}`
}

export function listAcceptanceLedger(): AcceptanceLedgerEntry[] {
  return listRows(ACCEPTANCE_LEDGER_KEY) as unknown as AcceptanceLedgerEntry[]
}

function appendAcceptanceLedger(entry: AcceptanceLedgerEntry): void {
  const ledger = listAcceptanceLedger()
  saveRows(
    ACCEPTANCE_LEDGER_KEY,
    [...ledger, entry] as unknown as EntryRow[],
  )
}

/**
 * 登记一条巡查记录。
 * 编号重复、隐患描述为空、巡查类别不对在登记时就按共用规则拦下；
 * 整改措施可在整改环节补填。
 */
export function createSafetyRecord(input: Record<string, string>): ActionResult {
  const draft: EntryRow = {
    id: -1,
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: input['巡查编号']?.trim() ?? '',
    巡查区域: input['巡查区域']?.trim() ?? '',
    巡查类别: input['巡查类别']?.trim() ?? '',
    隐患描述: input['隐患描述']?.trim() ?? '',
    整改措施: input['整改措施']?.trim() ?? '',
    巡查人: input['巡查人']?.trim() ?? '',
    巡查日期: input['巡查日期']?.trim() || today(),
    巡查状态: '',
  }

  const rows = listSafetyRows()
  const hardIssues = evaluateHazard(draft, rows).filter(
    (issue) => issue.code !== 'MISSING_MEASURE',
  )
  if (hardIssues.length > 0) {
    return fail(`登记失败：${hardIssues.map((issue) => issue.message).join('；')}`)
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  draft.id = nextId
  saveRows(SAFETY_KEY, [...rows, draft])
  return { ok: true, message: `巡查记录「${draft['巡查编号']}」已登记，当前状态「待巡查」` }
}

/** 补填整改措施：现场整改完成前补录，不影响已留存的处置结论。 */
export function fillRectificationMeasure(id: number, measure: string): ActionResult {
  const rows = listSafetyRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的安全巡查记录`)
  }
  const measureText = measure.trim()
  if (measureText === '') {
    return fail('整改措施不能为空')
  }
  const next = [...rows]
  // 只改整改措施，处置结论等留存字段一律不动。
  next[index] = { ...rows[index], 整改措施: measureText }
  saveRows(SAFETY_KEY, next)
  return { ok: true, message: `巡查记录「${rows[index]['巡查编号']}」的整改措施已补录` }
}

/**
 * 巡查入口、上报入口推进环节时调用的同一个服务：
 * 先校验单向流转，再走共用判定，结论不区分入口。
 */
export function runHazardAction(id: number, action: string): ActionResult {
  const target = HAZARD_ACTION_TARGETS[action]
  if (!target) {
    return fail(`安全巡查记录没有登记「${action}」这个动作`)
  }

  const rows = listSafetyRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的安全巡查记录`)
  }
  const row = rows[index]
  const currentStatus = String(row.status)

  if (currentStatus === target) {
    return fail(`安全巡查记录已经是「${target}」，不用重复操作`)
  }

  const flowIssue = checkHazardFlow(action, currentStatus)
  if (flowIssue) {
    return fail(flowIssue.message)
  }

  const blockers = hazardActionBlockers(action, row, rows)
  if (blockers.length > 0) {
    return fail(`「${action}」被隐患处置规则拦下：${blockers.map((issue) => issue.message).join('；')}`)
  }

  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== '已办结',
    abnormal: false,
  }

  if (action === '确认整改') {
    // 整改确认时，巡查原单的处置结论正式留存：之后任何入口都沿用它，不重算。
    const decision = resolveHazardDecision(row, rows)
    updated[VERDICT_FIELD] = decision.verdict
    updated[VERDICT_SOURCE_FIELD] = '巡查原单'
    updated[VERDICT_DETAIL_FIELD] =
      decision.issues.length > 0 ? decision.issues.map((issue) => issue.message).join('；') : '各项核验通过'
  }

  if (action === '上报隐患') {
    // 上报不产生新结论，处置结论一律沿用巡查原单上的留存。
    updated[VERDICT_SOURCE_FIELD] = '巡查原单'
  }

  if (action === '批复办结') {
    // 隐患上报办结的批复：批复结论写回原单，并驱动验收台账。
    updated[APPROVAL_FIELD] = '准予办结'
    updated[APPROVED_AT_FIELD] = today()
  }

  const next = [...rows]
  next[index] = updated
  saveRows(SAFETY_KEY, next)

  if (action === '批复办结') {
    appendAcceptanceLedger({
      台账编号: nextLedgerNo(listAcceptanceLedger()),
      巡查编号: String(updated['巡查编号'] ?? ''),
      隐患描述: readHazardDescription(updated),
      巡查类别: String(updated['巡查类别'] ?? ''),
      验收结论: String(updated[VERDICT_FIELD] ?? '合格'),
      批复结论: String(updated[APPROVAL_FIELD] ?? '准予办结'),
      办结日期: String(updated[APPROVED_AT_FIELD] ?? today()),
      source: '隐患上报批复',
    })
  }

  return { ok: true, message: `安全巡查记录已${action}，当前状态「${target}」` }
}

export { SAFETY_CATEGORIES }
