/**
 * 冲突决策列表（规范 §11，绑 src/ui/conflict-view.ts 的 ConflictCollector）。
 *
 * Workbench Rebuild（2026-09）：
 * - 每个冲突渲染为「选边卡片」：保留当前 / 使用备份 两个并排可点选块，
 *   选中侧高亮描边 + 淡底（radio 语义保留：label 包裹原生 input，键盘可操作）；
 * - 适配器标签（kindTag）+ 描述（路径等宽字体）组成卡片头；
 * - 批量决策按钮置于列表顶部工具行。
 *
 * 注意：不提供 "Review（稍后决定）" 选项——Review 会被收集器计为
 * unresolved，导致「下一步」永远禁用（死路）。要么决策，要么不进入本步。
 * 安全：冲突项不携带当前配置值（当前值可能含秘密，不回显），故不做值级 diff。
 */
import { useState } from 'react'
import { ConflictCollector } from '../../ui/conflict-view.ts'
import type { ItemResolution } from '../../core/types.ts'
import type { TranslateNS } from '../client-types.ts'
import { Banner } from '../common/ui.tsx'
import css from '../config-manager.module.css'

export interface ConflictListProps {
  collector: ConflictCollector
  t: TranslateNS<'config-manager'>
  /** 任意决策变化后通知父组件刷新（tick） */
  onChanged: () => void
}

const RESOLUTION_OPTIONS: { value: ItemResolution; key: string }[] = [
  { value: 'keepCurrent', key: 'import.conflicts.keepCurrent' },
  { value: 'useImported', key: 'import.conflicts.useImported' },
]

/** 批量决策全部冲突项（keepCurrent / useImported；下沉到 ConflictCollector.resolveAll 纯函数，
 *  组件只做装配 + tick/onChanged 通知；与逐项逻辑一致地更新 UI） */
function resolveAll(
  collector: ConflictCollector,
  resolution: Extract<ItemResolution, 'keepCurrent' | 'useImported'>,
  setTick: (fn: (v: number) => number) => void,
  onChanged: () => void,
): void {
  collector.resolveAll(resolution)
  setTick((v) => v + 1)
  onChanged()
}

/** 冲突项决策列表（选边卡片） */
export function ConflictList({ collector, t, onChanged }: ConflictListProps) {
  const [tick, setTick] = useState(0)
  const items = collector.viewItems()
  const unresolved = collector.unresolved().length
  const hasConflicts = items.length > 0

  return (
    <div className={css.conflictList}>
      {unresolved > 0 && <Banner kind="warn">{t('import.conflicts.unresolved', { count: String(unresolved) })}</Banner>}

      {/* 批量决策按钮（无冲突项时禁用；均为次操作——覆盖性决策不诱导，逐项选边为主） */}
      <div className={css.actionRow}>
        <button
          type="button"
          className={css.ghostButton}
          data-size="sm"
          disabled={!hasConflicts}
          onClick={() => { resolveAll(collector, 'keepCurrent', setTick, onChanged) }}
        >
          {t('import.conflicts.keepCurrentAll')}
        </button>
        <button
          type="button"
          className={css.ghostButton}
          data-size="sm"
          disabled={!hasConflicts}
          onClick={() => { resolveAll(collector, 'useImported', setTick, onChanged) }}
        >
          {t('import.conflicts.useImportedAll')}
        </button>
      </div>

      {items.map((view) => {
        const item = view.item
        return (
          <div key={item.id} className={css.conflictItem}>
            <div className={css.conflictHead}>
              <span className={css.kindTag}>{item.adapter}</span>
              <span className={`${css.conflictId} ${css.mono}`} title={item.description}>{item.description}</span>
              {item.severity === 'error' && <span className={css.severityError}>error</span>}
            </div>
            {item.detail !== undefined && item.detail !== '' && (
              <pre className={css.conflictDetail}>{item.detail}</pre>
            )}
            <div className={css.conflictChoices} role="radiogroup" aria-label={item.description}>
              {RESOLUTION_OPTIONS.map((opt) => {
                const selected = view.resolution === opt.value
                return (
                  <label key={opt.value} className={css.choiceCard} data-selected={selected ? '' : undefined}>
                    <input
                      type="radio"
                      name={`conflict-${item.id}`}
                      checked={selected}
                      onChange={() => {
                        collector.resolve(item.id, opt.value)
                        setTick((v) => v + 1)
                        onChanged()
                      }}
                    />
                    <span className={css.choiceTitle}>{t(opt.key as 'import.conflicts.keepCurrent' | 'import.conflicts.useImported')}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      {items.length === 0 && <div className={css.empty}>No conflicts</div>}
      {void tick}
    </div>
  )
}
