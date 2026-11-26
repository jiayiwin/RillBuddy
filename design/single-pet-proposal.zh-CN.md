# 单宠物桌面方案

产品定位和用户需求见[桌面宠物产品策略](./desktop-pet-product-strategy.zh-CN.md)；本文专门落到单宠物后的交互、数据模型和迁移方案。

## 结论

桌面只保留一只宠物。它代表 Rill 本身，负责提醒、陪伴和全局状态表达；agent 不再拥有宠物、皮肤、窗口或位置。

来源的身份、任务和状态放到一个独立的「工作台」里，Agent 是第一批重点来源：桌面悬停卡提供摘要，小屋里的「Agent」页提供完整列表和会话详情，未来再加入日历、邮件、项目和 CI。宠物只表达“现在最需要你注意的事情”，工作台负责回答“来自哪里、在哪个项目、哪一轮、正在做什么”。

这次调整的核心不是把多只宠物压成一只然后轮流显示，而是把两个概念彻底分开：

```text
Agent / Session / Task  ──状态聚合──>  全局优先级 ──>  一只桌面宠物
          │                                  │
          └──────── 工作台 <──────────────────┘
```

## 为什么要这样拆

当前实现中，pet id 同时承担了四个职责：agent 身份、皮肤、桌面窗口和交互目标。这会带来三个问题：

1. agent 数量一多，桌面变成状态面板，宠物本身的陪伴感被稀释；
2. 同一 agent 的多个会话只能压成一张宠物卡，用户看不出哪一个项目在等自己；
3. 以后增加 agent、远程 agent 或后台任务时，都会继续复制宠物窗口、位置、动画和菜单。

单宠物后，宠物是稳定入口，任务是可展开的信息层。桌面始终安静，信息密度放到用户主动打开的地方。

## 未来的产品结构

### 1. 桌面宠物

- 永久只有 `pet-main` 一个窗口；没有 agent 在线时也保留，进入休息或睡眠状态。
- 皮肤、声音、乐器和性格属于 Rill，全局由用户选择；不会因为当前最重要的 agent 改变外形，也不会在不同 agent 之间闪换皮肤。
- 脚下只显示全局摘要，例如「3 个 agent · 1 件等你」；不再显示 `Claude · project` 这类固定归属标签。
- 气泡只说一件最重要的事。需要区分来源时用一行前缀：`Claude · api-server 等你批准`。
- 单击仍是停止当前表演，拖拽、喂糖、逗玩、右键菜单都作用于这只宠物本身。
- 双击打开当前“主任务”的终端或 IDE；如果同时有多件任务等待，双击先打开工作台，避免跳错窗口。

### 2. 悬停卡：全局摘要 + 任务入口

悬停一秒出现一张固定宽度的全局卡，不再是某只宠物的会话列表：

```text
┌─────────────────────────────────────┐
│  Rill                3 个 agent      │
│  ● 1 件等你  ● 2 件进行中  ✓ 4 件完成 │
├─────────────────────────────────────┤
│  ! Claude    api-server       等你   │
│    Codex     desktop          进行中 │
│    Gemini    docs             已完成 │
├─────────────────────────────────────┤
│  查看全部 Agent  ·  打开主任务       │
└─────────────────────────────────────┘
```

- 默认显示按优先级排序的 agent 摘要，每个 agent 一行；同一 agent 多会话时显示 `2 个会话`。
- 点击 agent 行展开该 agent 的会话；点击会话行聚焦对应终端或 IDE。
- 「查看全部 Agent」打开小屋的 Agent 页；卡片不承载筛选、搜索和长文本。
- 卡片的位置仍跟随宠物，避免新增一个常驻窗口。

### 3. 小屋：从“某只宠物的房间”改成“总览 + 工作台”

小屋保留一只宠物和互动区域，右侧改为三个层次：

1. **总览**：在线 agent 数、活跃会话数、等你数、卡住数、今日完成数；点击数字进入对应筛选。
2. **Agent 列表**：按状态优先级排列，支持全部 / 等你 / 进行中 / 已完成 / 离线筛选和名称、项目搜索。
3. **任务详情**：点击一行后显示项目、会话、运行时长、当前工具和文件、最近状态变化、等待原因，以及「聚焦窗口」「复制项目路径」等操作。

推荐的小屋标签为「总览」「工作台」「日报」「图鉴/设置」；工作台默认打开 Agent 视图，并提供来源筛选。原来的 `?pet=` 参数不再决定房间内容；深链保留可选的 `source`、`agent` 和 `session`，用于打开工作台后选中一行。

Agent 行的最小信息：

| 字段 | 说明 |
|---|---|
| 名称与图标 | `Claude Code`、`Codex`、自定义 adapter 名称 |
| 总状态 | 等你 / 出错 / 工作中 / 已完成 / 空闲 / 离线 |
| 会话数 | 在线会话数，只有一个时不显示数字 |
| 主项目 | 当前最需要关注的会话项目 |
| 时长 | 当前会话或当前状态持续时间 |
| 等待原因 | 权限、输入、错误或其他 attention 原因 |
| 最近工具 | 最近一次工具和文件，缺失时隐藏 |

会话展开后沿用已有 `SessionCard` 字段，不把 agent 名称、皮肤或宠物 id 混进会话数据。

### 4. 托盘和批准

- 托盘顶部改成全局计数：「1 件等你 · 2 件进行中」，点击进入工作台。
- 托盘的 agent 列表与小屋共用同一份摘要数据，避免维护两套排序逻辑。
- 权限批准卡仍可贴在宠物上，但卡片必须显示 `agent / project / session / tool`，并支持多个请求排队、逐个处理。
- 允许、拒绝、交给终端三个动作只作用于卡片对应的请求，不作用于“当前主任务”。

### 5. 图鉴、皮肤和接入

图鉴仍然可以保留五只角色、乐器、收藏和换装，但它的含义变成“Rill 可以穿什么”，不再是“哪个 agent 由谁陪”。

- 图鉴的换装只修改全局 `main_skin`，小屋、菜单、批准卡、电台和桌宠统一跟随；不再根据 agent 自动换肤。
- agent 接入页只负责安装/卸载 hook、显示连接健康度和最近事件，不再承诺“接入后得到一只宠物”。
- 旧版的 agent→skin 映射在迁移时取主宠皮肤作为默认值；用户以后仍可在图鉴中换装，但不会影响 agent 列表的排序或状态。
- 皮肤的颜色可以作为工作台的装饰色，但必须是可选的辅助信息；状态图标、文字和筛选不能只靠颜色表达。

## 全局状态如何表达

宠物只能有一个当前表情，因此必须把多个 agent 的状态变成稳定、可解释的优先级。建议使用以下顺序：

| 优先级 | 触发条件 | 宠物表现 | 气泡示例 |
|---:|---|---|---|
| 1 | 有权限/输入等待 | 抬头、珊瑚色提醒音 | `Claude · api-server 等你` |
| 2 | 有错误、连续卡住或被中断 | 担心、轻微停顿 | `Codex · desktop 卡住了` |
| 3 | 有活跃会话 | 注视、轻微工作动作 | `2 个 agent 正在工作` |
| 4 | 最近完成且仍在庆祝窗口 | 跳一下或短表演 | `Gemini 刚做完 docs` |
| 5 | 只有空闲或离线会话 | 休息、睡眠 | `今天没有正在运行的任务` |

优先级相同的时候，使用“严重程度 → 等待时间 → 最近更新时间”的稳定排序。不要在每一条 tool event 到来时切换主任务：

- 等待状态出现时立即抢占；
- 等待消失后保留当前任务至少 2 秒，再允许切换；
- 工作中任务至少停留 5 秒；
- 同一批等待请求按队列顺序逐个播报；
- 所有状态变更都进入工作台的时间线，桌面只播报摘要。

这样可以避免多个 agent 同时工作时宠物不断闪烁、语音相互打断。

### 互动规则的替换

多宠物专属互动需要改为单宠物的“事件编排”：

| 现在的功能 | 单宠物后的处理 |
|---|---|
| 一只宠物走到另一只旁边 | 删除“走过去”；在气泡中标出来源，并在工作台高亮另一行 |
| 多只合奏、共舞、碰一碰 | 改成一次全局表演，事件详情列出参与的 agent |
| 另一只替等待中的 agent 叫你 | 宠物直接提醒，并显示等待 agent 名称 |
| 完成的 agent 分糖给长任务 agent | 保留为一条协作事件，糖给 Rill；工作台时间线显示参与双方 |
| 按主宠拖动带着其他宠物 | 删除多窗体联动，只保存 `pet-main` 的位置 |
| 每只宠物追虫、帮忙拍 Boss | 由唯一宠物执行；虫子详情显示触发它的 agent/session |
| 每个 agent 自己的乐器和口吻 | 乐器和口吻归 Rill；agent 只作为台词中的来源标签 |

“谁在等你”仍然是高优先级，但它不再靠另一只宠物走近来表达。

## 数据模型和 API

### 新的读模型

后端保留按来源和 session 存储的事实，新增两个读模型。第一阶段的 Agent 数据可以直接填入 `SourceSummary` 的 agent 分支：

```rust
struct SourceSummary {
    kind: String,               // agent | calendar | mail | git | project | local
    id: String,
    name: String,
    icon: Option<String>,
    state: SourceState,
    active_items: usize,
    needs_you: usize,
    primary: Option<WorkItemSummary>,
    items: Vec<WorkItemSummary>,
    updated_at: u64,
}

struct GlobalPetView {
    id: "main",
    skin: String,
    state: GlobalState,
    primary: Option<PrimaryTarget>,
    sources_online: usize,
    items_active: usize,
    needs_you: usize,
    errors: usize,
    completed_recently: usize,
    since: u64,
}
```

`SessionCard` 继续表示一个真实 agent session；其他来源可以有自己的明细类型，但都通过 `WorkItemSummary` 进入工作台。它不再嵌套在 `PetView` 的 agent 分组里，而是由 `SourceSummary.items` 下钻。`primary` 是全局优先级选出的工作项，供桌面双击和气泡使用。

### Session 与 Task 的边界

第一版工作台可以用 session 作为 Agent 来源下的可展开行，但接口命名和 UI 文案要预留任务层。session 是 hook 能观察到的进程事实；task 是用户想完成的一件事，未来可能跨多个 session、包含子 agent，或由没有终端窗口的后台任务执行。

```rust
struct WorkItemSummary {
    id: String,
    title: Option<String>,
    source: SourceRef,
    project: Option<String>,
    state: WorkState,
    session_keys: Vec<String>,
    current_session: Option<String>,
    started_at: u64,
    updated_at: u64,
}
```

迁移时先让 `WorkItemSummary` 由一条 agent session 生成，`id` 使用稳定的 `agent/session`；以后有明确的任务 id 或用户手动合并时，再把多个 session 收拢到同一个 task。这样桌面显示的是工作项摘要，详情仍能下钻到 session，不需要再次重做窗口和宠物模型。

建议 API：

- `GET /v1/pet`：返回唯一的 `GlobalPetView`；
- `GET /v1/sources`：返回 `SourceSummary[]`，支持 `kind`、`state`、`q`、`source` 查询参数；
- `GET /v1/sources/:kind/:id`：返回一个来源和它的工作项；
- `GET /v1/agents`：第一阶段的兼容别名，只返回 `kind=agent`；
- WebSocket `pet.state`：只推送全局宠物状态；
- WebSocket `source.state`：推送单个来源的摘要变化；
- WebSocket `agent.state`：第一阶段的兼容别名；
- WebSocket `session.state`：只在工作台打开或订阅详情时推送，用于时间线和当前工具更新；
- `POST /v1/focus`：参数为 `source + session`，由宿主聚焦对应终端/IDE；
- `GET /v1/approvals` 和现有回答接口保留请求 id，并始终返回 `source/session/project`。

过渡期间 `/v1/pets` 可以返回长度为 1 的兼容结果，但新代码不要再依赖 `pet.camp`、`pet.marker` 或 `pet.sessions`。

### 状态事实与显示状态分离

不要在 `Session` 上写入“主任务”或“宠物正在说什么”。建议由独立的 `AttentionQueue` / `GlobalNarrator` 计算：

```text
hook / sync event -> Source state -> WorkItem -> AttentionQueue -> GlobalPetView
                                      └──────> 工作台
```

这样桌面动画、托盘列表和房间列表共享同一个事实来源，切换窗口不会改变优先级，也不会漏掉并行会话。

## 需要变更的功能和代码面

| 区域 | 现状 | 单宠物改法 |
|---|---|---|
| `crates/petd/src/hub.rs` | `groups()` 按 source 生成多个 `PetView` | 保留 session 聚合，新增 `source_summaries()` 和 `global_pet()`；`layout_changed()` 永远只返回 `main` |
| `crates/petd/src/server.rs` | `/v1/pets` 和 `pet.state` 承载 agent 及 session | 新增 `/v1/pet`、`/v1/sources`、`source.state`；`/v1/agents` 只做首期别名；审批返回完整来源 |
| `crates/petd/src/world.rs` | 互动目标是具体 pet/camp，多宠物联动 | 目标改为 session/agent；合奏和走位规则删除，保留全局事件和单宠物表演 |
| `crates/petd/src/think.rs` | 遍历 pets，按宠物安排动作 | 遍历 SourceSummary，向一个 `GlobalNarrator` 提供候选事件，并按队列/冷却决策 |
| `crates/petd/src/ops.rs`、`todo.rs` | 喂糖、纸条、播放等操作带 pet id | 操作默认作用于 `main`；等待某 agent 的纸条保存 `source/session` 目标，而非 pet id |
| `crates/petd/src/cast.rs`、`skin.ts` | 皮肤由 agent 映射，页面跟随 agent 换肤 | 皮肤成为全局 Rill 配置；只保留一个当前 skin，不再按 agent 自动换肤 |
| `app/src-tauri/src/windows.rs` | 创建、销毁多个 `pet-*` 窗口 | 固定创建 `pet-main`；删除多宠物位置、布局和窗口同步逻辑 |
| `app/src-tauri/src/main.rs`、`physics.rs` | Tauri 命令参数普遍带 pet id | 桌面动作默认目标 `main`；`focus_session` 改由 `source/session` 定位；菜单事件携带任务目标 |
| `app/src/main.ts`、`app/src/pet.ts` | 从某个 pet URL 读取 agent 状态 | 只订阅 `pet.state`；悬停卡订阅 sources；双击用 `primary` 或打开工作台 |
| `app/src/room.ts`、`app/room.html` | 一个 agent 一间房，`?pet=` 决定皮肤和状态 | 改成一个总览房间 + 工作台；默认是 Agent 视图，`?source` / `?agent` / `?session` 用于选中详情 |
| `app/src/tray.ts` | 渲染多个宠物 tile | 渲染全局计数和可折叠来源列表，默认先显示 agent，点击进入工作台 |
| `app/src/card.ts`、`approve.ts` | 卡片默认认为来源是当前宠物 | 显示全局摘要和明确的 agent/project/session；多请求进入队列 |
| `app/src/voice.ts`、`perform.js` | 每只宠物有独立口吻和乐器 | 只保留 Rill 的一套演出；来源名称作为文本变量，不切换音色 |
| `README*`、`docs/implementation-notes.md` | 文案和实现说明描述多宠物世界 | 更新为单宠物 + Agent 工作台；明确旧版迁移行为 |

## 迁移方案

### 阶段 0：先建立兼容读模型

- 保留现有 session 状态机和数据库；不动 hook 协议。
- 新增 `AgentSummary`、`GlobalPetView` 以及 `/v1/agents`。
- 用测试锁定全局优先级、并行 session、等待队列和离线回收。
- 现有多宠物 UI 仍可运行，方便逐页替换。

### 阶段 1：桌面收敛为一个窗口

- `sync_pets()` 改为只创建 `pet-main`，旧 `pet-claude-code` 等窗口启动时销毁。
- 将旧的 `windows.json` 中各 agent 位置迁移：优先使用 Claude Code 宠物的位置，其次使用最近更新时间最新的有效位置，最后使用默认位置。
- 只保留一个皮肤配置。第一次启动时使用当前主宠皮肤；旧的 agent→skin 映射保留在迁移备份中，不再读取。
- 关闭多宠物拖拽、走位和防重叠逻辑后再删除旧字段，避免用户升级时丢位置。

### 阶段 2：接入工作台

- 悬停卡先接全局摘要，再接 `/v1/sources` 的展开列表；第一阶段提供 `/v1/agents` 兼容别名。
- 小屋增加工作台，默认进入 Agent 来源视图，先复用现有 `SessionCard`，再补搜索、筛选和时间线。
- 托盘、批准卡和日报全部使用同一套来源摘要；Agent 只是第一批完整接入的来源。

### 阶段 3：迁移主动互动

- `think.rs` 中按来源生成候选事件，由一个 narrator 排序、去重和冷却。
- 多宠物专属事件改成全局事件；桌面表演只保留一只宠物。
- 每条主动消息记录 `source/session`，日报和工作台时间线可回溯。

### 阶段 4：清理旧模型

- 删除 `PetView.camp/marker/sessions` 的 UI 依赖和 `pet-{agent}` 路由。
- 删除 `hidden_pets`、多宠物位置和联动动画；保留数据库兼容读取一段版本周期。
- 更新 README、演示页、截图和测试名称，避免“每个 agent 一只”的旧概念重新进入产品。

## 必须保留的体验

- 桌面上始终有一个稳定、可认识的角色；agent 数量变化不会造成窗口跳动。
- 等待批准仍然可以在桌面完成，但用户永远能看到来源和目标 session。
- 双击仍能到达具体终端/IDE；当目标不唯一时先进入工作台，不猜错窗口。
- 任务明细、项目、工具、文件和运行时长不能因为只有一只宠物而被压扁成一句摘要。
- 关闭或隐藏桌宠时，来源采集和工作台继续工作；重新显示时一次性补发全局摘要。
- 多 agent 并行时不丢状态，不让桌面动画频繁抢占，也不让一个 agent 的表演掩盖另一个 agent 的等待。

## 验收标准

1. 任意时刻桌面进程只存在一个 `pet-main` 窗口；agent 上下线、重启 daemon、切换 skin 都不会生成第二只。
2. 同时运行 5 个 agent、每个 agent 3 个 session 时，工作台能显示 15 个 session，且每行可聚焦正确窗口；新增一个非 agent 来源时不影响这套列表和优先级。
3. 两个 session 同时等待时，桌面只显示一个稳定的提醒，但卡片和工作台显示等待数、来源和完整队列。
4. 一个等待请求结束后，优先级能在 2 秒内切换到下一个请求；普通工作状态不会因每个工具事件闪烁。
5. 旧版位置、皮肤和待办升级后不丢失；旧 pet id 的深链能重定向到 `main` 并选中对应 agent/session（仍在线时）。
6. 托盘、小屋、悬停卡、批准卡、日报使用相同的状态名称和排序结果。
7. 无活跃来源时宠物睡眠，工作台显示空状态；下次 agent 或其他来源启动不需要重新配置宠物。

## 暂不做的事

- 不把多个 agent 合成一个虚构的“超级 agent”；事实仍按 source/session 保留。
- 不在桌面上显示完整日志、长回复或所有工具调用；这些属于工作台的详情和时间线。
- 不让宠物根据 agent 自动换皮肤；如果以后要表达来源，优先使用图标、颜色和气泡前缀。
- 不在第一版引入跨设备 agent 合并、远程控制或复杂任务依赖图；先把本机并行会话的可见性做稳定。

