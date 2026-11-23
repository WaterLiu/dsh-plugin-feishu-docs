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

## 数据从哪来

不需要准备任何数据。插件在你在打开浮层时，直接读**当前会话自己的日志**：

```
~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd
```

只取用户与助手消息里出现的飞书链接；工具输出里的链接不算（那些你在对话里看不到）。标题直接来自消息里的 Markdown 链接文字，所以不需要飞书授权。

清单本身在本机完成，除了解压日志不做任何网络请求。**创建者**是唯一的例外：日志里没有这个信息，插件通过本机的 `lark-cli`（用你已登录的飞书身份）查一次，结果缓存到 `~/.dsh/feishu-docs-owners.json`。没装 `lark-cli` 或没登录时，该列留空，不会编造。

## 验证

打开 DevTools Console，应看到：

```
[feishu-docs] client apply, version 2.0.2
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
| 创建者列是空的 | 没装 `lark-cli`、没登录，或飞书没返回该文档的 owner；`curl .../doctor.json` 的 `larkCli` 字段可确认是否找到 CLI |
| 标题是一串 token | 那条消息里没给可用的标题文字（裸链接，或只有 `## 🔗` 这类标记），无法取到标题 |
| 跳转位置不准 | 依赖历史是否已加载；插件会先自动向上翻页 |
