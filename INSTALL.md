# 安装

DSH 插件，一个目录、无构建、无数据文件、无额外依赖。

## 安装

```
Plugins → Add plugin → github:WaterLiu/dsh-plugin-feishu-docs
```

或在会话里让 Agent 执行：

```
plugin_manager install_bundle target: "github:WaterLiu/dsh-plugin-feishu-docs"
```

本地目录同样可以：**Plugins → Add plugin → 选中该文件夹**。

**重启 DSH**，每个会话的标题栏就会出现 `☁ N`。

## 首次使用

第一次点开浮层，如果这台机器还缺东西，「**还差哪几项**」会显示在「本会话云文档」标题**上方**，每项都给一个可点的动作：

| 缺什么 | 面板上做什么 |
|---|---|
| `zstd`（Node 内置解压不可用时） | 「复制命令」→ `brew install zstd`，装完重开浮层 |
| `lark-cli` | 「复制命令」→ `npm install -g @larksuite/cli` |
| 飞书授权（未登录 / 权限不足） | 「去授权」→ 自动打开飞书授权页，并在面板里留一个「打开授权页面」链接；你在浏览器确认后点「我已授权」，浮层自动刷新 |

授权会先调 `lark-cli auth check` **和已授权的权限对比**，只申请**当前缺的那几个**——都齐了就不会出现授权项。插件真正读取的是两个 scope：`drive:drive.metadata:readonly`（标题、创建者、是否被删除）和 `contact:user:search`（显示人名，可选）。头像不需要额外权限（走 `authen/v1/user_info`）。**之后如果授权失效，再打开浮层会重新出现这一项，并给出新的授权链接**（设备码 10 分钟内有效，过期就再点一次「去授权」）。

## 当前账号与退出

浮层顶部是**当前飞书账号**：头像（**第一次拉取后缓存在 `~/.dsh/feishu-docs-avatar.img`**，之后首屏直接读本地、不再等网络；每 24 小时在后台回源一次看是否更新过，失败则继续用缓存。经插件自身的 `/x-feishu-docs/avatar` 同源提供，拿不到时用名字首字的圆形占位）、名字、`飞书个人用户 / Lark 个人用户`。右侧红色「退出」是两步的：第一次点击变成「确认退出」，再点一次才真正执行 `lark-cli auth logout`（6 秒内不确认会自动复位；也可以点「取消」）。

还没登录时，头像位置是默认头像，右侧是一个蓝色「登录」按钮：点它直接发起授权，授权页会自动打开，授权链接也会留在账号卡片正下方。**你在浏览器里确认后不用回来点任何东西**——浮层会自己轮询（约 5 分钟内有效），token 一到就自动刷新成头像+名字+创建者（「我已授权」按钮只是手动兜底的加速）。

退出只清除本机的飞书登录态，不动你的文档。退出后浮层会立刻变成「未登录飞书」，并出现「去授权」，重新授权一次即可恢复创建者、真实标题和删除标记。

## 授权只在一处定义

所有"要哪些权限"的判断都归 **`setup.js`**，登录按钮、设置面板、授权检查三条入口共用同一份清单：

| 清单 | 内容 | 能否通过用户授权获得 |
|---|---|---|
| `REQUIRED_SCOPES` | `drive:drive.metadata:readonly` | 能（登录时必须） |
| `NICE_SCOPES` | `contact:user:search`、`contact:contact.base:readonly` | 能（可选，影响人名/企业名） |
| `APP_SCOPES` | `verification:verification_information:readonly`、`tenant:tenant:readonly` | **不能**：属于应用身份，只能在开发者后台申请并由管理员审核 |

规则：`loginScopesFor()` 统一决定这次登录请求哪些权限——未登录时给「必需+可选」，已登录且缺权限时只补缺的，并且**永远剔掉 `APP_SCOPES`**（把应用级权限塞进设备码流程会让整次授权失败）。`doctor.json` 会直接把结果作为 `loginScopes` 下发，前端不再维护自己的副本（之前就是这么漏掉 `contact:contact.base:readonly` 的）。

## 账号栏显示什么

| 位置 | 内容 |
|---|---|
| 第一行 | 你的飞书昵称 |
| 第二行 | **企业主体名称** + **认证徽标**（`已认证` / `未认证`）；读不到时显示中性的「飞书用户」 |

### 数据从哪来（三档降级）

| 顺序 | 接口 | 身份 | 权限 | 能给出 |
|---|---|---|---|---|
| 1 | `GET /open-apis/verification/v1/verification` | 应用（tenant token） | `verification:verification_information:readonly` | **企业主体名称 + `has_verification`** |
| 2 | `GET /open-apis/tenant/v2/tenant/query` | 应用 | `tenant:tenant:readonly` | 企业名称 + 组织类型（个人/企业/教育） |
| 3 | `GET /open-apis/contact/v3/departments/0` | 用户 | `contact:contact.base:readonly` | 租户**根部门名**（飞书用公司名命名），不含认证状态 |

### 个人账号 vs 企业账号

| 账号类型 | 界面 | 徽标 | 是否需要开权限 |
|---|---|---|---|
| **个人版飞书** | `飞书个人用户` | **不显示** | 不需要（面板里不会出现那条设置项） |
| 企业（已认证） | 企业主体名称 | `已认证` | 需要（见下） |
| 企业（未认证） | 企业主体名称 | `未认证` | 需要 |
| 读不到 | `飞书用户` | 不显示 | — |

判定方式：`verification/v1/verification` 返回 `{ has_verification: false }` 且**没有 `name` 字段** → 个人账号（没有企业主体可认证）；有 `name` 才是企业主体，`has_verification` 才有意义。

> 说明：飞书另一套「实名认证」API（`human_authentication-v1`，身份录入/人脸比对）是**企业侧业务场景**用的，需要白名单与计费，与账号上显示的"认证"无关，所以不采用。

### 企业账号要做的操作（一次性）

浮层里会出现「企业名称与认证状态」，点**去开通权限**直接打开开发者后台对应页面（已带 `clientID` 与 `scopes`），给应用勾选 `verification:verification_information:readonly` 并发布版本、管理员审核通过后即可显示。没开通时显示「飞书用户」，**不显示任何猜测出来的认证状态**。

## 授权只在一处定义

所有"要哪些权限"的判断都归 **`setup.js`**，登录按钮、设置面板、授权检查三条入口共用同一份清单：

| 清单 | 内容 | 能否通过用户授权获得 |
|---|---|---|
| `REQUIRED_SCOPES` | `drive:drive.metadata:readonly` | 能（登录时必须） |
| `NICE_SCOPES` | `contact:user:search`、`contact:contact.base:readonly` | 能（可选，影响人名/企业名） |
| `APP_SCOPES` | `verification:verification_information:readonly`、`tenant:tenant:readonly` | **不能**：属于应用身份，只能在开发者后台申请并由管理员审核 |

规则：`loginScopesFor()` 统一决定这次登录请求哪些权限——未登录时给「必需+可选」，已登录且缺权限时只补缺的，并且**永远剔掉 `APP_SCOPES`**（把应用级权限塞进设备码流程会让整次授权失败）。`doctor.json` 会直接把结果作为 `loginScopes` 下发，前端不再维护自己的副本（之前就是这么漏掉 `contact:contact.base:readonly` 的）。

## 账号栏显示什么

| 位置 | 内容 |
|---|---|
| 第一行 | 你的飞书昵称 |
| 第二行 | **企业主体名称** + **认证徽标**（`已认证` / `未认证`）；读不到时显示中性的「飞书用户」 |

### 数据从哪来（三档降级）

| 顺序 | 接口 | 身份 | 权限 | 能给出 |
|---|---|---|---|---|
| 1 | `GET /open-apis/verification/v1/verification` | 应用（tenant token） | `verification:verification_information:readonly` | **企业主体名称 + `has_verification`（是否已认证）** |
| 2 | `GET /open-apis/tenant/v2/tenant/query` | 应用 | `tenant:tenant:readonly` | 企业名称 + 组织类型（个人/企业/教育） |
| 3 | `GET /open-apis/contact/v3/departments/0` | 用户 | `contact:contact.base:readonly` | 租户**根部门名**（飞书用公司名命名），不含认证状态 |

只有第 1 档能回答"是否已认证"，且它必须用**应用身份**——用户 token 调 `tenant/v2/tenant/query` 会直接报 `user access token not support`。

### 第一次要做的操作（一次性）

浮层里会出现一条「企业名称与认证状态」，点**去开通权限**会直接打开开发者后台对应页面（带好 `clientID` 和 `scopes` 参数），给应用勾选 `verification:verification_information:readonly` 并发布版本，管理员审核通过后即可显示。没开通之前：显示「飞书用户」，**不显示任何猜测出来的认证状态**（`orgVerified` 为 `null` 表示"不知道"，不是"未认证"）。

### 为什么不再写「飞书个人用户」

那句话对**企业租户**是错的，而且原意只是"用户身份（相对应用/机器人）"。现在按真实数据来：有企业名就显示企业名，没有就显示中性的「飞书用户」。

## 文档是怎么和对话对上的：turn 块

会话日志里的 `turn/start` 与 `turn/end` 成对出现，中间的 `user/message`、`assistant/message`、`step` 都属于这一次问答。插件用它给每份文档锁定"来源范围"：

| 字段 | 含义 |
|---|---|
| `turn` | 首次出现的那一轮（与渲染行的 `data-chat-turn` 同一套编号） |
| `block` | `会话id#turn`，反查用的唯一标识 |
| `startSeq` / `endSeq` | 该块在日志里的序号范围（`turn/start` → `turn/end`），块未结束时 `endSeq` 为空 |
| `mid` / `seq` | 首次出现那条消息的 id 与序号（上游若肯在 DOM 输出 id，可直接精确命中） |

查找顺序因此变成：**先按 `block` 对应的轮次找行 → 轮内按 token 找链接 → 再退到消息 id / 整段扫描**。同一份文档重复出现时，`turn`/`block` 只在**第一次**写入，所以"最早"是数据本身决定的，不靠搜索顺序。

如果跳转落点不对，追踪日志里的 `domTurns` 会给出当前渲染的轮次范围，可直接判断"日志的 turn 编号"和"DOM 的 turn 编号"是否同一套。

翻页是**带方向**的：目标轮次在已加载范围之上就往上翻（触达顶部加载旧消息），在范围之下就往下翻（触达底部加载新消息）——渲染窗口是双向滑动的，只会往上翻的话，"先翻到最早、再点后面某条"就永远追不到。目标轮次已在范围内但链接没渲染（例如折叠块）时，直接落到块本身，不再空转。

## 授权续期（不再动不动要求重新登录）

飞书 token 有两层：**access token 2 小时**、**refresh token 7 天**（每次续期顺延）。`lark-cli` 的刷新是隐式的——下次"需要鉴权的调用"发生时，它用 refresh token 换新。

插件现在按这个行为工作：

| 场景 | 行为 |
|---|---|
| `tokenStatus: valid` | 直接用，不做额外调用 |
| 过期但 `refreshExpiresAt` 还在将来（可续期） | **先续期再判定**：`auth check`（只读）→ 失败再试 `/authen/v1/user_info`；只有 `auth status` 的**到期时间真的往后推了**才算成功 |
| 续期成功 | 视为已登录，界面无变化（静默） |
| 续期失败·网络类 | 提示「网络异常，稍后自动重试」，**不要求重新授权** |
| 续期失败·凭据写入被拒（keychain） | 提示可能需要重新授权（这是唯一该点的场景之一） |
| refresh 过期 / 已被吊销 | 提示「去授权」 |

另外宿主每隔 **90 分钟**做一次轻量保活探针（远低于 2 小时），所以隔夜再用也不需要重新登录；退出登录会停掉保活。每次判定都会往追踪日志写一条 `auth-state`（含 `state`/`tokenStatus`/`probe.reason`，**不含任何 token**），下一次"为什么又要登录"可以直接查证。

## 更快的跳转取决于 DSH 的一个属性

聊天行目前只带 `data-chat-node-key` 和 `data-chat-turn`，没有消息 id；而它背后的视图节点其实有 `id` 和 `anchorSeq`。要让跳转"一次到位、不用翻历史"，需要 DSH 在行上多输出两个属性——具体位置、改动内容和风险见 [`contrib/upstream-data-chat-node-id.md`](contrib/upstream-data-chat-node-id.md)。

插件**已提前兼容**：先找 `[data-chat-node-id]`，再找 `[data-chat-seq]`，都没有才退回"轮次 + 按需翻历史"。所以上游一加上，跳转速度立刻变快，插件不需要再改。

## 已知修复（上游遗留）

`lark-cli` 之外，作者原版 `client.js` 里还有一个潜伏 bug：`loadOlderOnce()` 调用了 `nudgeTop()`，但**这个函数从未定义**——只有"需要翻更早历史"的路径才会踩到。

本仓库补回了被删掉的 `scrollerFor()`，并重新实现了 `nudgeTop()`：在这个 build 里，**加载更早消息的实际触发方式就是让聊天区到达顶部**，插件没有别的等价手段（历史按钮不一定存在，`conversation.loadOlder()` 也不一定可达）。所以翻历史的三条途径是：历史按钮 → `conversation` / `uiConversation` 的 `loadOlder()`（运行时探测，不写 `inject`，避免某版本缺该服务时插件无法激活）→ 滚到顶部触发自带加载。

关键是**加载完必须回到目标**：找到目标就滚过去；12 次尝试仍未加载出来，就把滚动位置**恢复到进入前的样子**，再提示「已定位到最近可加载的位置」。这样既保住了加载能力，也不会把视图丢在顶部。

## 改完先跑检查

这个仓库带一个静态检查，专门抓"调用了不存在的函数"（`node --check` 只看语法，抓不到）：

```bash
node tools/check-undefined.mjs index.js scan.js owners.js setup.js cli.js avatar.js client.js
# 或
node --run check-undefined
```

它会剥掉注释、字符串、模板与正则字面量，收集函数/变量/解构/参数/import 的名字，再把所有"调用了但没声明"的名字报出来（带行号、退出码非 0）。已在两处历史回归上验证过（`nudgeTop is not defined`、`docTarget is not defined`）。

## 跳转没反应时怎么查

跳转的每一步都会写一行追踪日志到 `~/.dsh/feishu-docs-log.ndjson`（超过 512 KiB 自动轮转成 `.1`）。真正排障时先看它：

```bash
tail -5 ~/.dsh/feishu-docs-log.ndjson
```

- 只有 `jump-start`、没有后续 → 前端在定位阶段就抛了异常（同时浮层会重新弹出并提示「跳转失败：…」）
- 有 `jump-start` + `reveal` 且 `moved: false` → 目标就在视野里、滚动没有发生（这不算失败，高亮仍会打上）
- 一行都没有 → 点击事件没到插件，检查胶囊是否还在页面上

## 跳转高亮

点某行的 ⊙，会**直接滚到这份文档所在的那条消息**，并把消息里的**文档链接本身**高亮（琥珀色底 + 一圈描边，出现时脉冲两下）。

高亮**不是覆盖层，也不用算坐标**：用浏览器的 **CSS Custom Highlight API**（`CSS.highlights` + `::highlight()`）给文档链接的**那段文本本身**上色——Range 指向的就是文字，所以滚动时它天然跟着走，不存在滞后或错位，也不往 DSH 的 DOM 里插任何东西。

老引擎没有 `CSS.highlights` 时会退回"跟随矩形的小层"实现（同样的琥珀色、3 秒后淡出），行为一致，只是那种方式需要每帧重算位置。**只覆盖文档链接本身**，不染段落、不染整轮。链接被 React 重渲染换掉时，会在保持期内每 250ms 重新贴上；如果链接当时不在视口里，会先把它滚进视口。定位方式是**用日志记录的"首次出现轮次" + 文档 token**：先按 `[data-chat-turn="N"]` 找到那一轮，再在轮内找含 token 的链接；如果那一轮还没挂载，就按需要往回翻历史直到它出现。

补充一个实现约束：DSH 的视图节点里同时有 `id`（消息唯一标识）和 `anchorSeq`（日志序号），但**渲染到 DOM 上只有 `data-chat-node-key`（路由用的 key）和 `data-chat-turn`**——消息 id 与序号都不在 DOM 里，DSH 自己的跳转接口（`jump = { turn, seq }`）也没有对外暴露。所以本插件不依赖 id 定位，而是靠记录的首次出现轮次 + 文档 token；需要时按轮次往回翻历史把它加载出来。

**同一份文档在一个会话里往往出现很多次**（第一次介绍、后面复盘、再后来回填表格）。列表里只有一行，代表它**首次出现**的位置；跳转和高亮也只针对这第一次出现的消息，不会跳到后面某一处副本。

**滚动目标是文档链接本身**（居中）。滚动前会先派发一次 `wheel` 事件，把滚动控制权从"跟随尾部"手里拿回来——否则 DSH 会在下一帧把 `scrollTop` 还原（追踪日志里表现为三次采样值完全相同、只在第三次硬赋值时才动，且落点偏移）。然后逐帧校正到居中，最后再用 `scrollIntoView({block:'center'})` 兜底确认。只有当那块的链接没有渲染（尺寸为 0）时，才退而滚到块所在的行。

一个容易踩的坑：`[data-chat-turn]` 在一个会话里可能出现**几百次**（每轮十几次：步骤行、工具行、轮次容器都带），只取第一个会滚到一个 27px 的步骤行，看起来就像"没跳"。所以块是按**文档 token** 认的，不是按轮次取第一个元素。只有在没有可点链接、只能高亮纯文本时，才退回到"含 token 的文本行"，并且**限制容器高度 ≤120px**（超过就认为那是整条消息，宁可不标也不糊半屏）。

高亮**只落在可点击的链接上**：代码块、反引号里的同名 URL 是日志文本，不参与高亮；如果某个会话里这份文档只以代码形式出现过，那就只滚过去、不做标记（并在 `feishu-docs-log.ndjson` 里记一条 `mark-miss`）。这也和"只有正文里可点的链接才算文档"是一致的。

**跳转时浮层保持打开**：浮层会盖住右上角，所以滚动不是"整屏居中"，而是把目标链接滚到**浮层下方那段可见空白的中间**（空白不足 200px 时才退回整屏居中）。这样你可以连着点几条文档对比，不用反复开关面板。

日志里 `reveal` 会多两个字段：`inside`（目标是否落在可视区内）和 `covered`（是否被浮层压住）——一眼判断落点对不对。

高亮**没有定时消失**：它会一直在，直到你做了别的操作——点击、按键、滚轮、触摸都会立即收掉（只滚动不点不算，因为阅读本来就要滚动）；跳到另一份文档会换成新的高亮。

高亮的范围是**整条链接**：消息里是 URL 就高亮完整 URL，消息里是 `[文档名称](url)` 这种写法就高亮那段名称。文档在对话里以**名称**展示时（token 不出现在文本里），命中会改用记录下来的标题去匹配。

消息列表是虚拟滚动的，刚跳过去时目标可能还没挂载——所以定位会**最多重试 4 秒**（每 250ms 一次），直到找到那条可点链接，而不是点一次没找到就放弃。

## 自动刷新

不用关掉再打开：浮层打开时每 2.5 秒、收起时每 6 秒向宿主问一次"会话日志有没有变"。宿主只对日志文件做一次 stat 比对版本（文件大小 + 修改时间），**没变就直接回 `unchanged`、不解压**，所以轮询很便宜。你刚发出的飞书链接通常一两秒内就会出现在胶囊数字和列表里。

**每个会话第一次进入时会全量扫描一次**，之后只解析新增的部分：

- 日志是 zstd 帧的追加流，扫描状态记录了"已消费到第几字节"（`~/.dsh/feishu-docs-sessions.json`）
- 再来时直接从上次的字节位置往后读，只解压新帧——所以历史消息不会重复分析
- 状态里带 `scannedAt` 作为**"该会话已全量扫描过"的标识**：`/x-feishu-docs/session.json` 的返回里也有 `scanned` / `scannedAt` / `cached` 三个字段，`cached: true` 表示这次没有重新解析
- 宿主重启后也沿用这份索引，不会把每个会话重扫一遍

## 搜索与筛选

有文档时，浮层里会出现一个搜索框和「来自用户」筛选：

- 搜索框只匹配**文档名称**，以及文档 URL 里的 **token**（标题还没从飞书拉到时也能用 token 搜）；大小写不敏感，输入即时过滤，按 Esc 清空。**不搜创建者**——按人筛选用下面的「来自用户」
- 命中的文字在列表里以**琥珀色高亮**标出
- 「来自用户」列出本会话真正出现过的创建者，选中即只看这个人的文档；没登录时没有创建者信息，这一栏自动隐藏
- 有任何筛选时右侧出现「清除」，标题栏计数会显示 `匹配数 / 总数`
- 切换会话会重置筛选条件

## 数据从哪来

不需要准备任何数据。插件在你在打开浮层时，直接读**当前会话自己的日志**：

```
~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd
```

只取用户与助手消息里出现的飞书链接；工具输出里的链接不算（那些你在对话里看不到），**代码块和反引号里的 URL 也不算**（聊天里它们是代码，不是可点的链接）。标题直接来自消息里的 Markdown 链接文字，所以不需要飞书授权。

清单本身在本机完成，除了解压日志不做任何网络请求。**创建者**是唯一的例外：日志里没有这个信息，插件通过本机的 `lark-cli`（用你已登录的飞书身份）查一次，结果缓存到 `~/.dsh/feishu-docs-owners.json`。没装 `lark-cli` 或没登录时，该列留空，不会编造。

**创建者名字**还需要通讯录权限：owner id 一定能拿到，但要显示成人名需要 `contact:user:search`。没授权时显示缩写的 owner id（如 `ou_cfa0a78…9e11`），原因写在 `curl …/doctor.json` 的 `creatorNames` 字段里。授权一次即可：

```bash
lark-cli auth login --scope "contact:user:search"
```



**已删除**同理：先用一次批量元数据查询，飞书没返回的文档再逐个用 `drive +inspect` 确认，只有明确回答 `not exist` 才标记「已删除」（标题划掉，但仍留在列表里）。`permission denied` 不算删除，不会打标记。

## 验证

打开 DevTools Console，应看到：

```
[feishu-docs] client apply, version 3.8.1
[feishu-docs] header chip registered
```

也可以直接问宿主：

```bash
curl -s "http://127.0.0.1:<端口>/x-feishu-docs/doctor.json"
# {"zstd":"core","zstdPath":"/opt/homebrew/bin/zstd","node":"v24.21.0"}

curl -s "http://127.0.0.1:<端口>/x-feishu-docs/session.json?sid=<会话id>"
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 胶囊不出现 | 重启 DSH；在 Plugins 页确认该 bundle 已启用 |
| 显示 `☁ 0` | 这个会话确实没出现过飞书链接 |
| `doctor.json` 里 `zstd: null` | Node 版本低于 22.15 且没装 `zstd` 命令 → `brew install zstd` |
| 文档被删了还在列表里 | 这是有意的：列表是“本会话提到过什么”，被删的文档会标「已删除」并划掉；确认来自飞书的 `not exist` 答复，6 小时内不重复查 |
| 创建者列是空的 | 没装 `lark-cli`、没登录，或飞书没返回该文档的 owner；`curl .../doctor.json` 的 `larkCli` 字段可确认是否找到 CLI |
| 标题是一串 token | 那条消息里没给可用的标题文字（裸链接，或只有 `## 🔗` 这类标记），无法取到标题 |
| 跳转位置不准 | 依赖历史是否已加载；插件会先自动向上翻页 |
