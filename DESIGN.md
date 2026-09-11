# 🎨 DESIGN.md — DSH Config Manager 视觉设计规范（Workbench Design System）

> **本文件是项目 UI / UX / Visual Style 的 Single Source of Truth。**
> 2026-09 Full UI Rebuild 重写。任何开发者或 AI Agent 在创建、修改前端界面前必读；
> 若本文件与代码冲突，以代码为准并更新本文件。

---

## 0. 定位：DSH 设置弹窗内的「内嵌工作台」

本项目 UI 挂在 DSH GUI 的 **`settings.section`**（「备份与迁移」）内。宿主约束（不可更改）：

- **画布固定 ≈ 564 × 720px**：设置弹窗 800×800（`width:800px; max-width:calc(100vw-48px)`），
  减去宿主导航 188px 与页边距后，插件内容区约 564px 宽、720px 高。
- 不拥有全局外壳/主题/字体栈：颜色字体全部消费 `--dsw-*` token（亮/暗主题与皮肤自适应）。
- 设计语言：**高密度开发者工具**（参考 Linear / Raycast / VS Code settings 的信息密度）。
  禁止：营销文案腔、大卡片堆砌、大留白、装饰性图标、纯填充用的零值 KPI 卡。

**Canvas 纪律**：任何页面都必须消灭「底部空洞」——内容不足时用真实数据块
（备份位置 / 分区构成 / 活动视口）填充，或让最后一个数据块成为内部滚动视口
（`.fillCard` / `.fillViewport`），禁止出现无意义的纯背景色区域。

---

## 1. IA（信息架构）

Shell（`ConfigManagerSection`）：导航条 + 页面内容 + 状态栏 + 活动抽屉。

- **一级导航（7 页签）**：总览 / 备份 / 导出 / 导入 / 同步 / 市场 / 档案。
  export/import 为一级页面；旧「更多」面板由「活动与关于」抽屉取代
  （run-store `parsePersistedState` 迁移旧值，`moreSub` 保留）。
- **活动抽屉**：右侧 400px 滑出，含 活动记录 / 关于 两个子视图（Segmented 切换）。
- **状态栏（28px 圆角条）**：状态点 + 就绪/进行中/恢复待处理 + 插件与 DSH 版本；
  与顶部页签条同款「圆角分段条」外观（四周留白 8px，不再通栏贴底）。
- 页内子视图切换一律用 `Segmented`（如备份页：安全快照 / 备份文件 / 定时备份 / 事故恢复）。

---

## 2. Design Principles

| 原则 | 含义 |
|---|---|
| **Token 驱动，零硬编码** | 颜色/字体/阴影全部 `--dsw-*`；tint 用 `color-mix(in srgb, <token> <pct>, transparent)` |
| **薄壳渲染，逻辑下沉** | React 只装配；渲染模型/状态判定在 `src/ui/` 纯函数（node 单测） |
| **密度优先** | 基准字号 12.5px；行高 1.5；卡片 padding 12px；页面 padding 16px；区块间距 10px |
| **状态即语义** | ok/info/warn/error 四态贯穿 Badge/Banner/StatusDot/choiceCard |
| **危险操作隔离** | 删除/恢复恒 `danger` 变体或 `data-danger` 图标 + ConfirmDialog 二次确认；行内用 `.rowDivider` 与安全操作分隔 |
| **开发者排版** | 路径/文件名/时间戳/命令一律等宽栈（`.mono`）；长文件名**中段省略**（保留尾部时间戳）+ `title` 全文 |
| **无障碍** | 所有交互元素 `:focus-visible` 双环；图标按钮必须 `aria-label`；表格行选择支持 Enter/Space |

---

## 3. Colors（DSH Design System Token）

| 语义角色 | Token |
|---|---|
| 主要/次级/弱化文字 | `--dsw-alias-label-primary / secondary / tertiary` |
| 主按钮填充 / hover | `--dsw-alias-button-info-fill / -hover` |
| 交互 hover 底色 | `--dsw-alias-interactive-bg-hover` |
| 页面底色 / 卡片表面 | `--dsw-alias-bg-base / bg-layer-2` |
| 边框 L1 / L2 | `--dsw-alias-border-l1 / -l2` |
| 输入框背景 | `--dsw-specific-input-major` |
| 业务主色 / 成功 / 警告 / 错误 / 中性 | `--dsw-alias-state-business-primary / success / warn / error / info` |
| 正文字体 | `--dsw-font-family`；等宽栈 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

语义映射：成功=ok、业务信息=info、警告=warn、错误/危险=error（Badge/Banner/kindTag 一一对应）。

---

## 4. Typography（唯一允许的 scale）

| 用途 | 字号 | 字重 |
|---|---|---|
| 页面区块标题 `.sectionTitle` | 13px | 700 |
| 卡片头分组标签 `.groupLabel` | 11px | 700 |
| 正文/按钮/输入 | 12.5px | 400（按钮 600） |
| 表格正文 `.dataTable` | 12px | 400 |
| 元数据/说明 `.hint/.cellMeta` | 11–11.5px | 400 |
| 状态栏/徽章 | 11px / 10.5px | 400 / 600 |
| 等宽值 `.mono` | 11–11.5px | 400 |

- 数字一律 `font-variant-numeric: tabular-nums`（`.section` 全局启用）。
- 中文文案统一全角标点；插入语遵循 `line-break: strict`（`.quickActionHint` 等）。
- 禁止营销语气（「更省心」类）；状态描述使用名词在前（「定时备份 已开启」）。

---

## 5. Spacing & Shape

- 间距网格：4 / 8 / 10 / 12 / 16；区块间距统一 10px。
- 圆角：卡片 8px、控件（按钮/输入/选择）6px、分段容器 7px、徽章 9px、小标签 4px；
  顶部页签条 / 底部状态栏为 8px 圆角分段条（条内 .navTab 6px 药丸），
  激活态 = 主色 16% 淡底 + 45% 主色内描边（`.navStrip` / `.statusBar` 同款语言）。
- 控件高度：按钮 28px（sm 24）、输入/选择 28px、表格行 ~32px、活动行 28px、
  顶部页签条 32px（条内页签 24px）、状态条 32px、状态栏 28px、图标按钮 26px。
- 动效：仅颜色过渡 120ms ease、进度条 300ms、抽屉滑入 180ms、状态点脉冲 1.2s。

---

## 6. Components（config-manager.module.css 类）

### Primitives（common/ui.tsx）
- `Button`（primary/ghost/danger × sm/md；`href` 外链同款外观）
- `IconButton`（`.iconBtn`；`active`/`danger` 修饰；必须 `aria-label`）
- `StatusDot`（idle/ok/info/warn/error + `pulse`）
- `Badge`（info=中性描边 / ok / warn / error）
- `Banner`（四态；操作按钮一律**内嵌右侧**）
- `Segmented`（页内子视图切换；受控）
- `Card` / `Spinner` / `Field` / `SectionTitle` / `Empty` / `Checkbox` / `Stepper`

### 第三方原语（2026-09 Visual Polish 引入，按 AGENTS.md「第三方 UI 库准入」评估落地）
仅引入**无样式/行为级**原语，视觉仍 100% 走 `--dsw-*` token + 本文件规范，不引入第二套视觉体系：
- **图标 = lucide-react**（`common/Icon.tsx`）：取代散落文本符号图标（跨平台字形/基线漂移）。
  统一尺寸（默认 14px）/ 描边（1.75）/ `currentColor` 继承父级语义色。
  **体积纪律**：从各图标独立模块路径 `lucide-react/dist/esm/icons/<name>.mjs` 导入
  （非桶导出），保证 rolldown 在 cjs 单文件打包下精确 tree-shake（~18 图标仅 +12KB raw）；
  深路径无类型，由 `src/client/lucide-icons.d.ts` 全局 ambient 声明兜底
  （该文件刻意不含顶层 import，保持全局脚本态，否则 `declare module` 退化为 augmentation 而部分失效）。
  新增图标须同步登记 `Icon.tsx` 映射表 + `lucide-icons.d.ts`。
- **弹窗 = @radix-ui/react-dialog**（`common/Modal.tsx`）：统一原先两套弹窗
  （ConfirmDialog 手写 focus trap + 各页内联 `dialogMask` 无 trap）为一套，获得成熟
  focus trap / Esc / 初始焦点与关闭后焦点还原 / body 滚动锁 / Portal 渲染。
  `Modal`（容器，`open/onClose/title/wide/busy/cardStyle/onOpenAutoFocus`）+
  `Modal.Header`（标题行 + 可选关闭按钮 + trailing）/ `Modal.Body`（`scroll/innerRef/onScroll/style`）/
  `Modal.Footer`。Radix Content 用 `.dialogContentCenter` 自居中（Portal 下与 Overlay 平级）；
  旧 `.dialogMask/.dialogCard` 类保留供未迁移弹窗兼容。busy 时守卫 `onOpenChange` +
  `onEscapeKeyDown/onPointerDownOutside/onInteractOutside` 双保险禁闭。
  **已迁移（全部弹窗）**：ConfirmDialog、Profiles 切换预览、Market 条目详情、MyConfigs 上传向导 + 装回本地、
  Snapshots 恢复计划预览 + 备份查看、ReleaseNotes、**SyncSettingsView 全部 5 个弹窗**（通道配置 / 推送预览 /
  推送结果 / 拉取差异 / 一键同步确认 —— 实测为同级独立弹窗而非嵌套，逐个迁为 `<Modal>`，自定义宽度走
  `cardStyle`、限高走 `Modal.Body style`；通道配置弹窗的刷新快照按钮 `🔄` 亦改 Lucide `RefreshIcon`）。
  迁移后全仓再无手写 `dialogMask+dialogCard` 弹窗（`grep css.dialogMask` 仅余注释）。
- **构建接线**：`tsdown.config.ts` 的 `deps.alwaysBundle: [/^lucide-react(\/.*)?$/, /^@radix-ui\//]`
  强制把二者打进单文件 cjs（否则被当 dependencies 外部化 → 运行时 `require` 命中 DSH loader
  「module table miss」崩溃）。注意 tsdown 0.22 读 `deps.alwaysBundle`，旧的顶层 `noExternal`
  从 config 根读取、放在 `deps` 内会被静默忽略。bundle 增量约 +136KB raw / +30KB gzip。

### 数据展示
- **数据表**：`.tableWrap > .tableScroll > .dataTable`；变体 `.tableFixed`（固定布局 +
  th 显式宽度 + 内容 ellipsis）、`.tableCompact`（padding 8px）。行 hover 高亮、
  `data-selected` 选中淡底、数字列 `.num` 右对齐等宽、次级列 `.dim`。
- **状态条**（Overview）：`.statStrip`（健康点 + 可点指标段，名词在前值加粗）。
- **事实网格**：`.factGrid/.factCell/.factLabel/.factValue`（四列 label/value）。
- **键值行** `.kvRow`、**分区构成** `.sectionGrid/.sectionRow`。
- **Stepper**：紧凑圆点 17px + 连接线，只读指示器。
- **进度条**：`.progressTrack` 5px + 确定宽度过渡 / `.progressIndeterminate`。

### Shell 与 Overlays
- Shell：`.shellNav/.navStrip/.navTab/.navActions/.shellMain/.pagePad/.statusBar`；
  `.shellMain` 与 `.pagePad` 构成纵向 flex 链，页面可伸展填充（`.fillCard/.fillViewport`）。
- Dialog：`.dialogMask/.dialogCard(.dialogWide)/.dialogHeaderRow/.dialogBody(.dialogBodyScroll)`，
  遮罩点击/Esc/取消三途径关闭，busy 禁闭，focus trap，焦点还原。
  **Portal 容器必须是插件根节点**（`ConfigManagerSection` 的 `#dsh-config-manager-root`，
  常量 `MODAL_ROOT_ID`）：宿主设置弹窗 overlay 为 `position: fixed; z-index: 1000`，
  弹窗若按 Radix 默认挂到 `document.body` 就成为它的兄弟节点、被 1000 层完全盖住而"隐形"，
  叠加 Radix modal 给 body 加的 `pointer-events: none` → 表现为"打开后整页点不动，
  必须先点一下屏幕"（那一下正是关掉隐形弹窗的外部点击）。挂回插件根节点即恢复
  与宿主同一层叠上下文（与迁移前内联 `dialogMask` 的层级语义一致）。
- Drawer：`.drawerMask/.drawerPanel`（右侧 400px；Esc 仅在面板内消费，`stopPropagation`
  避免关闭宿主弹窗）。

### 页面级模式
- **Overview 控制中心**：状态条 → 动作工具栏（主操作 + 活动入口右对齐）→
  备份位置卡（路径+copy/体积/配额/间隔/下次）→ 分区构成卡 → 活动视口
  （fit-content 上限 8 行内滚；成功=绿点降噪，失败/跳过=徽章）。
  - 状态条指标段**精确跳转**：备份文件→备份页「备份文件」、安​全快照→「安​全快照」、
    定时备份→「定时备份」、远程同步→同步页（`METRIC_TARGET` 同时写 panel 与 snapshots.subTab，
    只写 panel 会全部停在子页默认值）。
  - 健康段仅在「存在未解决恢复事项」时渲染为按钮，直达备份页「事故恢复」；正常态是纯展示 span。
  - 活动行容器 `.activityRows` 取 `flex: 0 1 auto; min-height: 0`（**不可用 `flex: none`**）：
    页面被压缩时列表须随之收缩并自身内滚，否则内容溢出卡片边框（曾实测 274px 内容 vs 205px 卡片）。
- **Backups**：Segmented 四子视图；快照表（行点击→计划弹窗）、备份文件表
  （图标操作 + 删除红色隔离 + 分隔线）、定时备份独立子视图（单行头：标题+结果徽章+上次+动作）。
- **冲突解决**（ConflictList）：选边卡片模式——每项一张卡（kindTag 适配器 + 等宽描述），
  保留当前 / 使用备份 两个并排 `.choiceCard`（radio 语义，选中高亮）；批量决策在顶部。
  安全：不回显当前配置值（可能含秘密），不做值级 diff。
- **导入向导**：6 阶段 Stepper + 分步页面；导入执行页含命令日志面板（`.logPanel`，
  智能贴底滚动 + 「↓ 新输出」提示）。稀疏步骤（选择 ZIP）用 `.sparseFill` **顶部对齐**
  （`justify-content: flex-start`）：内容贴顶、紧跟步骤条，不再垂直居中悬在页面中段。
- **事故恢复**：仅在 `recoveryRequired === true` 时显示红色 SAFE MODE 横幅；
  正常态（无待处理事项）不渲染任何横幅——「已恢复正常，可继续操作」绿灯提示已移除
  （恢复成功后的确认由操作结果本身承载，常驻绿灯属冗余噪音）。

---

## 7. 文案与安全呈现

- 全部用户可见文案走 i18n 字典（zh 源 / en 镜像；`ConfigManagerKey` 编译校验）。
- 错误/报告/历史摘要渲染前 `redact()`；历史条目中的 `[REDACTED]` 在展示层
  可读化为「（文件名已脱敏）」。
- 备注等自由文本若编码损坏（全问号）显示「（备注不可读）」。
- 密码/凭据仅内存，绝不落 sessionStorage、绝不回显（run-store 白名单单一出口）。

---

## 8. Responsive

- 弹窗收缩（视口 <900px，弹窗变 100vw-48px）：`.ovGrid` 单列、统计/快捷网格 2 列、
  `.secretFields` 单列、`.pagePad` padding 12px、抽屉全屏。
- 表格列宽用 th 显式宽度 + `table-layout: fixed` + 内容 ellipsis；先压缩次级列，
  最后主列；固定开销（时间/操作列）优先于内容列。

---

## 9. Anti-patterns（禁止）

1. 零值/纯状态装饰卡（为填格子而存在的 KPI 卡）。
2. 与一级导航重复的第二套入口卡。
3. warn/error 语义色用于建议性/营销性内容。
4. 无标签的 utility 图标混在导航行（图标按钮必须 aria-label + title）。
5. 尾部截断文件名/时间戳（区分信息在后缀时用中段省略）。
6. 固定高度容器内容不满（空黑块）——用 fit-content 或真实内容填充。
7. 全同徽章列（同一状态重复 n 次）——降级为状态点。
8. 同屏术语漂移（同一概念多个名字）。
9. 手写文本符号图标（▣⇥⇤⟳◷⭳⌕✕⧉→ 等）——统一用 `common/Icon.tsx`（lucide-react）。
10. 新建弹窗用手写 `dialogMask+dialogCard` 而无 focus trap——统一用 `common/Modal.tsx`（Radix Dialog）。
