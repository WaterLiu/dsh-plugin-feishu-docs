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

## 数据从哪来

不需要准备任何数据。插件在你在打开浮层时，直接读**当前会话自己的日志**：

```
~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd
```

只取用户与助手消息里出现的飞书链接；工具输出里的链接不算（那些你在对话里看不到）。标题直接来自消息里的 Markdown 链接文字，所以不需要飞书授权。

清单本身在本机完成，除了解压日志不做任何网络请求。**创建者**是唯一的例外：日志里没有这个信息，插件通过本机的 `lark-cli`（用你已登录的飞书身份）查一次，结果缓存到 `~/.dsh/feishu-docs-owners.json`。没装 `lark-cli` 或没登录时，该列留空，不会编造。

**创建者名字**还需要通讯录权限：owner id 一定能拿到，但要显示成人名需要 `contact:user:search`。没授权时显示缩写的 owner id（如 `ou_cfa0a78…9e11`），原因写在 `curl …/doctor.json` 的 `creatorNames` 字段里。授权一次即可：

```bash
lark-cli auth login --scope "contact:user:search"
```



**已删除**同理：先用一次批量元数据查询，飞书没返回的文档再逐个用 `drive +inspect` 确认，只有明确回答 `not exist` 才标记「已删除」（标题划掉，但仍留在列表里）。`permission denied` 不算删除，不会打标记。

## 验证

打开 DevTools Console，应看到：

```
[feishu-docs] client apply, version 2.3.0
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
