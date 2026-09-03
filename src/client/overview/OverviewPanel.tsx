/**
 * 总览面板（Overview，2026-09 UX 重构）：配置健康 + 四张指标卡 + 快速操作 + 最近活动。
 *
 * 数据流：挂载/刷新时对 5 个只读 API 做 Promise.allSettled 并行聚合（备份文件 /
 * 快照 / 定时备份 / 同步状态 / 迁移历史），逐项就绪逐项渲染（单项失败不阻塞整页，
 * 显示 '—' 占位）；全部渲染模型来自 src/ui/overview-view.ts 纯函数（node 单测覆盖），
 * 本组件只做装配（渲染 + 交互状态 + 导航）。
 *
 * 快速操作：
 *  - 立即备份：api.runBackupNow()（宿主防重；成功/失败 Badge 反馈后自动刷新指标）；
 *  - 导出 / 导入 / 远程同步 / 备份与快照：纯导航（runStore patch，与 tab 点击同语义）。
 *
 * 安全：历史摘要自由文本渲染前 redact()；本页全部数据源为只读状态（无敏感字段回显）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SnapshotMeta } from '../../core/restore.ts'
import type { BackupScheduleStatus } from '../../ui/backup-schedule.ts'
import type { BackupFileMeta } from '../../sync/backup-files.ts'
import type { SyncApi, SyncStatusResponse } from '../sync/sync-api.ts'
import type { HistoryApi, HistoryListResult } from '../history/history-api.ts'
import type { ConfigManagerApi } from '../api.ts'
import type { TranslateNS } from '../client-types.ts'
import { redact } from '../../security/redaction.ts'
import { runStore } from '../run-store.ts'
import { toRecoveryView } from '../recovery/recovery-view.ts'
import {
  buildOverviewMetrics,
  overviewActivity,
  overviewEmptyState,
  overviewHealth,
  overviewSuggestions,
  relTime,
  type OverviewMetaKey,
  type OverviewMetricKey,
} from '../../ui/overview-view.ts'
import { Badge, Banner, Button, Card, SectionTitle, Spinner } from '../common/ui.tsx'
import css from '../config-manager.module.css'

export interface OverviewPanelProps {
  api: ConfigManagerApi
  syncApi: SyncApi
  historyApi: HistoryApi
  t: TranslateNS<'config-manager'>
}

/** 聚合数据（null = 未加载/加载失败 → UI 占位）。 */
interface OverviewData {
  backups: BackupFileMeta[] | null
  snapshots: SnapshotMeta[] | null
  schedule: BackupScheduleStatus | null
  sync: SyncStatusResponse | null
  history: HistoryListResult | null
}

const initialData: OverviewData = {
  backups: null,
  snapshots: null,
  schedule: null,
  sync: null,
  history: null,
}

/** 指标卡标签 key 映射（overview-view 的 key → locale key）。 */
const METRIC_LABEL: Record<OverviewMetricKey, `overview.metric.${OverviewMetricKey}`> = {
  backups: 'overview.metric.backups',
  snapshots: 'overview.metric.snapshots',
  schedule: 'overview.metric.schedule',
  sync: 'overview.metric.sync',
}

/** 状态卡文案 key 映射。 */
const STATE_LABEL = {
  'state.on': 'overview.state.on',
  'state.off': 'overview.state.off',
} as const

/** 附注渲染：metaKey → 文案（time 参数为相对时间文案）。 */
function metaText(
  metaKey: OverviewMetaKey,
  timeMs: number | null,
  t: TranslateNS<'config-manager'>,
): string {
  const time = timeMs !== null ? renderRelTime(timeMs, t) : ''
  switch (metaKey) {
    case 'meta.lastBackup': return t('overview.meta.lastBackup', { time })
    case 'meta.noBackup': return t('overview.meta.noBackup')
    case 'meta.scheduleOn': return t('overview.meta.scheduleOn', { time })
    case 'meta.scheduleOff': return t('overview.meta.scheduleOff')
    case 'meta.scheduleFail': return t('overview.meta.scheduleFail')
    case 'meta.syncOn': return t('overview.meta.syncOn', { time })
    case 'meta.syncOff': return t('overview.meta.syncOff')
    case 'meta.never': return t('overview.meta.never')
  }
}

/** 相对时间渲染（超 7 天回退绝对日期）。 */
function renderRelTime(ms: number, t: TranslateNS<'config-manager'>): string {
  const rt = relTime(Date.now(), ms)
  if (rt === null) return new Date(ms).toLocaleDateString()
  if (rt.unit === 'now') return t('overview.time.now')
  if (rt.unit === 'min') return t('overview.time.min', { n: rt.n })
  if (rt.unit === 'hour') return t('overview.time.hour', { n: rt.n })
  return t('overview.time.day', { n: rt.n })
}

/** 活动行 kind key → locale 文案（kindKey 由 overview-view.ts 归一，全部键在字典登记）。 */
function kindLabel(kindKey: string, t: TranslateNS<'config-manager'>): string {
  return t(kindKey as Parameters<TranslateNS<'config-manager'>>[0])
}

/**
 * 总览面板：健康横幅 + 指标卡 + 快速操作 + 建议 + 最近活动（首用空态引导）。
 */
export function OverviewPanel({ api, syncApi, historyApi, t }: OverviewPanelProps) {
  const store = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot)
  const [data, setData] = useState<OverviewData>(initialData)
  const [loading, setLoading] = useState(true)
  const [backupRunning, setBackupRunning] = useState(false)
  /** 立即备份反馈（ok/error 文案；渲染前 redact()） */
  const [backupFeedback, setBackupFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** 卸载后不再 setState（异步回调竞态防护） */
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [backups, snapshots, schedule, sync, history] = await Promise.allSettled([
      api.listBackupFiles(),
      api.snapshots(),
      api.backupSchedule(),
      syncApi.status(),
      historyApi.list({}),
    ])
    if (!aliveRef.current) return
    setData({
      backups: backups.status === 'fulfilled' ? backups.value : null,
      snapshots: snapshots.status === 'fulfilled' ? snapshots.value : null,
      schedule: schedule.status === 'fulfilled' ? schedule.value : null,
      sync: sync.status === 'fulfilled' ? sync.value : null,
      history: history.status === 'fulfilled' ? history.value : null,
    })
    setLoading(false)
  }, [api, syncApi, historyApi])

  useEffect(() => {
    void load()
  }, [load])

  /** 立即备份（宿主 RunRegistry 防重；反馈后刷新指标）。 */
  const runBackupNow = async (): Promise<void> => {
    if (backupRunning) return
    setBackupRunning(true)
    setBackupFeedback(null)
    try {
      await api.runBackupNow()
      if (!aliveRef.current) return
      setBackupFeedback({ kind: 'ok', text: t('overview.quick.backupDone') })
      void load()
    } catch (err) {
      if (!aliveRef.current) return
      setBackupFeedback({ kind: 'error', text: redact(err instanceof Error ? err.message : String(err)) })
    } finally {
      if (aliveRef.current) setBackupRunning(false)
    }
  }

  // 纯导航（与 tab 点击同语义；状态入 runStore，切 tab/刷新不丢）
  const navTransfer = (view: 'export' | 'import'): void => {
    runStore.patch({ view, panel: null })
  }
  const navPanel = (panel: 'sync' | 'snapshots'): void => {
    runStore.patch({ panel })
  }

  const inputs = {
    now: Date.now(),
    backups: data.backups,
    snapshots: data.snapshots,
    schedule: data.schedule,
    sync: data.sync,
    history: data.history?.entries ?? null,
    recoveryRequired: store.recovery.status !== null
      ? toRecoveryView(store.recovery.status).recoveryRequired === true
      : null,
    runningCount: 0,
  }
  const metrics = buildOverviewMetrics(inputs)
  const health = overviewHealth(inputs)
  const suggestions = overviewSuggestions(inputs)
  const activity = overviewActivity(inputs.history, 5)
  const emptyState = overviewEmptyState(inputs)

  return (
    <div className={css.viewBody}>
      <div className={css.actionRow}>
        <SectionTitle title={t('view.overview')} subtitle={t('overview.subtitle')} />
        {loading && <Spinner label={t('overview.loading')} />}
        <Button variant="ghost" disabled={loading} className={css.pushRight} onClick={() => { void load() }}>
          {t('overview.refresh')}
        </Button>
      </div>

      {/* 健康状态（SAFE MODE / 无备份 / 定时备份失败 / 正常） */}
      <Banner kind={health.kind === 'error' ? 'error' : health.kind}>{t(`overview.${health.textKey}`)}</Banner>

      {emptyState && (
        <Card>
          <span className={css.groupLabel}>{t('overview.empty.title')}</span>
          <span className={css.hint}>{t('overview.empty.body')}</span>
        </Card>
      )}

      <div className={css.overviewColumns}>
        <div className={css.overviewMain}>
          {/* 指标卡：备份文件 / 安全快照 / 定时备份 / 远程同步 */}
          <div className={css.metricGrid}>
            {metrics.map((m) => (
              <div className={css.metricCard} key={m.key}>
                <span className={css.metricValue}>
                  {m.kind === 'state' && m.valueKey !== undefined ? t(STATE_LABEL[m.valueKey]) : m.value}
                </span>
                <span className={css.metricLabel}>{t(METRIC_LABEL[m.key])}</span>
                {m.metaKey !== null && (
                  <span className={m.metaTone === 'warn' ? `${css.metricMeta} ${css.warnText}` : css.metricMeta}>
                    {metaText(m.metaKey, m.metaParams['time'] !== undefined ? Number(m.metaParams['time']) : null, t)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 快速操作 */}
          <Card>
            <span className={css.groupLabel}>{t('overview.quick.title')}</span>
            <div className={css.quickActionGrid}>
              <button
                type="button"
                className={css.quickAction}
                disabled={backupRunning}
                onClick={() => { void runBackupNow() }}
              >
                <span className={css.quickActionTitle}>
                  <span className={css.quickActionSymbol} aria-hidden="true">▣</span>
                  {backupRunning ? <Spinner /> : undefined}
                  {t('overview.quick.backup')}
                </span>
                <span className={css.quickActionHint}>{t('overview.quick.backupHint')}</span>
              </button>
              <button type="button" className={css.quickAction} onClick={() => { navTransfer('export') }}>
                <span className={css.quickActionTitle}>
                  <span className={css.quickActionSymbol} aria-hidden="true">⇥</span>
                  {t('overview.quick.export')}
                </span>
                <span className={css.quickActionHint}>{t('overview.quick.exportHint')}</span>
              </button>
              <button type="button" className={css.quickAction} onClick={() => { navTransfer('import') }}>
                <span className={css.quickActionTitle}>
                  <span className={css.quickActionSymbol} aria-hidden="true">⇤</span>
                  {t('overview.quick.import')}
                </span>
                <span className={css.quickActionHint}>{t('overview.quick.importHint')}</span>
              </button>
              <button type="button" className={css.quickAction} onClick={() => { navPanel('sync') }}>
                <span className={css.quickActionTitle}>
                  <span className={css.quickActionSymbol} aria-hidden="true">⇅</span>
                  {t('overview.quick.sync')}
                </span>
                <span className={css.quickActionHint}>{t('overview.quick.syncHint')}</span>
              </button>
            </div>
            {backupFeedback !== null && (
              <div className={css.statRow}>
                <Badge kind={backupFeedback.kind}>{backupFeedback.text}</Badge>
              </div>
            )}
          </Card>

          {/* 建议（未启用能力的温和引导；SAFE MODE 时为空） */}
          {suggestions.length > 0 && (
            <Card>
              <span className={css.groupLabel}>{t('overview.suggest.title')}</span>
              <div className={css.groupItems}>
                {suggestions.map((s) => (
                  <div className={css.checkboxRow} key={s.id}>
                    <span aria-hidden="true">·</span>
                    <span>{s.id === 'schedule' ? t('overview.suggest.schedule') : t('overview.suggest.sync')}</span>
                    <Button
                      variant="ghost"
                      onClick={() => { s.id === 'schedule' ? navPanel('snapshots') : navPanel('sync') }}
                    >
                      {s.id === 'schedule' ? t('view.snapshots') : t('view.sync')}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 最近活动（迁移历史 Top5；summary 渲染前 redact()） */}
        <div className={css.overviewSide}>
          <Card>
            <span className={css.groupLabel}>{t('overview.activity.title')}</span>
            {activity.length === 0
              ? <span className={css.hint}>{t('overview.activity.empty')}</span>
              : (
                <div className={css.overviewList}>
                  {activity.map((item, i) => (
                    <div className={css.overviewListItem} key={`${item.at}-${i}`}>
                      <span className={css.overviewListTime}>{renderRelTime(Date.parse(item.at) || 0, t)}</span>
                      <span className={css.overviewListText}>
                        {redact(item.summary)}
                      </span>
                      <Badge kind={item.badge}>{kindLabel(item.kindKey, t)}</Badge>
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </div>
    </div>
  )
}
