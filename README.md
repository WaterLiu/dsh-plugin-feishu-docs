# dsh-plugin-feishu-docs

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that lists the Feishu (Lark) documents each Session's messages show: a `☁ N` chip in the conversation header, and a popover grouped by day.

```
Release notes for v1.2   ⚙ Standard                ☁ 2   ▣  ⤢
                                                     │
                                     ┌───────────────┴────────────────┐
                                     │ Documents in this session   2  │
                                     ├────────────────────────────────┤
                                     │ Today                          │
                                     │ 📄 API design notes   ⊙        │
                                     │ Nov 12                         │
                                     │ 📊 Roadmap 2027  New  ⊙        │
                                     └────────────────────────────────┘
```

Clicking `⊙` scrolls the transcript to that document's turn, paging older history in first when needed, and frames the whole turn until you interact.

## Install

No build step, no data file, no credentials, no extra tools.

```
Plugins → Add plugin → github:WaterLiu/dsh-plugin-feishu-docs
```

Or from an agent session (needs `plugin_manager`, present in the Standard preset):

```
plugin_manager install_bundle target: "github:WaterLiu/dsh-plugin-feishu-docs"
```

Restart DSH. The chip appears in the header of every Session.

## How it works

The chip's host half reads the Session's own log — `~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd` — and extracts Feishu links from its **user and assistant messages**. Nothing is precomputed and nothing leaves the machine.

- A log is a *concatenation* of zstd frames; core Node stops after the first, so each frame is decoded separately (`scan.js`).
- Titles come from the message's own Markdown link labels, so no API call is needed.
- Links that appear only inside tool output are ignored: the reader never saw them as a message.
- `新建` marks a document produced by a create command (`workbook-create`, `docs +create`, …).

Bare URLs without a Markdown label fall back to their document token as the title.

## Requires

| | |
|---|---|
| DSH desktop | runs the plugin |
| Node ≥ 22.15 (bundled with DSH) | zstd decompression in core |
| `zstd` binary | only if the Node build lacks zstd; detected automatically and reported by `/x-feishu-docs/doctor.json` |

## Known limits

- **No cross-session jump** — DSH exposes no public session-switching API, so a document from another Session copies a citation instead.
- **Creator names are not shown** — that needs Feishu API access; this plugin stays offline.
- **Only messages count, not tool output** — a link buried in a tool result is deliberately invisible here.
- **Turn jump depends on loaded history** — it pages back before falling back to copying the location.

## License

MIT. The icon is original artwork drawn for this plugin.
