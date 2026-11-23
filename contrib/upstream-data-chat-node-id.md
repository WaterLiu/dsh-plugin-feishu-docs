# 建议上游改动：在聊天行上暴露消息 id

> 这是给 DeepSeek Harness 本身的最小改动建议，不是本插件的代码。
> 本插件已经**提前兼容**：加上这个属性后，跳转会立刻变成零翻页的精确命中，插件侧不需要再改。

## 问题

同一份飞书文档在一个会话里往往出现很多次（先介绍、后复盘、再回填）。插件要跳到"首次出现"的那条消息，但：

- 会话日志里有消息的唯一标识：`data.message.id`（UUID）、`seq`、`turn`
- 渲染出来的行只带 `data-chat-node-key`（路由用的 key）和 `data-chat-turn`
- DSH 自己的跳转能力（`jump = { turn, seq }`）是聊天视图内部方法，没有作为服务对外

于是插件只能靠"`data-chat-turn` + 文档 token"定位，并在目标轮次未挂载时**往回翻历史**（每条消息最多几十次 `loadOlderOnce`）。功能正确，但慢，而且要依赖轮次号与日志一致。

## 改动

文件：`dsh-client-ui-chat`（源码 `packages/client/ui-chat`，安装包里是 `lib/client.js`）里构造聊天行的地方。

现在的代码（压缩后，位于 `lib/client.js` 偏移约 129303）：

```js
const flowKey = groupPart === void 0 || groupPart === `response`
  ? routedNode.key
  : JSON.stringify([routedNode.key, groupPart])
return jsx(`div`, {
  ref: wrapperRef,
  className: ChatView_module_css_default.flowItem,
  "data-chat-anchor-key": flowKey,
  "data-chat-flow-key": flowKey,
  "data-chat-paging-anchor": routedNode.kind !== `turn-process` || void 0,
  "data-chat-node-key": routedNode.key,
  "data-chat-group-part": groupPart,
  "data-chat-flow-kind": routedNode.kind,
  "data-chat-turn": turn,
  ...
})
```

建议加两个属性（`routedNode` 上已经有 `id` 和 `anchorSeq`）：

```diff
   "data-chat-node-key": routedNode.key,
+  "data-chat-node-id": routedNode.id,
+  "data-chat-seq": routedNode.anchorSeq,
   "data-chat-group-part": groupPart,
```

## 为什么是这两个

| 属性 | 来源 | 用途 |
|---|---|---|
| `data-chat-node-id` | 视图节点的 `id`（`context.id`，即消息唯一标识） | 精确跳到某条消息，不需要轮次，也不需要翻页 |
| `data-chat-seq` | 视图节点的 `anchorSeq`（日志事件 `seq`） | 让"上翻定位/回到某处"这类功能有稳定锚点，DSH 自己的 `jump` 用的正是 `{ turn, seq }` |

两者都可能是 `undefined`（例如 `turn-process` 这类容器节点），React 遇到 `undefined` 会自动省略属性，所以不需要额外判断。

## 风险与影响面

- 只**新增**两个 `data-*` 属性，不改结构、不改样式、不改事件，已有选择器不会受影响（现有代码全部按 `data-chat-node-key` / `data-chat-anchor-key` / `data-chat-turn` 取值）
- 代价是每行多两个字符串属性，DOM 体积增量可忽略
- 如果担心泄漏内部标识，可以只加 `data-chat-seq`（序号比 UUID 更"内部"，但同样只是本地 DOM）

## 如何验证

1. 打开任意会话，DevTools Console：

```js
[...document.querySelectorAll('[data-chat-turn]')].slice(0, 5)
  .map((el) => ({ turn: el.dataset.chatTurn, id: el.dataset.chatNodeId, seq: el.dataset.chatSeq }))
```

2. 应该看到每行都有 `id`（UUID）和 `seq`（整数），且与 `~/.dsh/sessions/.../session.v4.jsonl.zstd` 里 `data.message.id` / `seq` 一一对应。

## 插件侧已经怎么用（无需再改）

`client.js` 的 `rowByMessageId()` 现在是：

```js
document.querySelector(`[data-chat-node-id="${mid}"], [data-chat-node-key*="${mid}"], [data-chat-anchor-key*="${mid}"]`)
```

也就是说：

- 上游加了 `data-chat-node-id` → 直接精确命中，`jumpTo` 一次到位，**不翻历史**
- 没加 → 退回现有的"轮次 + token + 按需翻历史"，功能不受影响

## 不建议的做法

直接改安装包里的 `app.asar`（解包 → 改 `lib/client.js` → 重新打包）：

- 应用更新会覆盖，且签名/Hash 校验可能失败
- 出问题时难以区分是插件还是应用被改坏
- 这类改动应该走上游，或至少单独维护一个可复审的 patch

本仓库的 `client.js` 只会**读取**这个属性，不会尝试注入或修改 DSH 的 DOM 结构。
