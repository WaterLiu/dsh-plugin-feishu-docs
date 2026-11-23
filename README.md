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

The list follows the Session by itself: while the popover is open it asks the host every 2.5s whether the log grew (every 6s while it is closed), and the host answers from a `stat` — size and modification time — so an unchanged log is never decompressed. The first visit to a Session scans its log end to end and records that as a `scannedAt` marker; later visits decode only the frames appended since, resuming from a byte offset kept in `~/.dsh/feishu-docs-sessions.json`, so history is analysed once and never again.

## How it works

The chip's host half reads the Session's own log — `~/.dsh/sessions/<project>/session-<id>/session.v4.jsonl.zstd` — and extracts Feishu links from its **user and assistant messages**. Nothing is precomputed. The log scan stays local; only the creator and the deleted check ask Feishu, through `lark-cli`, and only when it is installed.

- A log is a *concatenation* of zstd frames; core Node stops after the first, so each frame is decoded separately (`scan.js`).
- Titles come from the message's own Markdown link labels, so no API call is needed. When Feishu is reachable its own document title replaces a missing label or a bare token.
- Links that appear only inside tool output are ignored: the reader never saw them as a message. So are links inside a code fence or backticks — the chat renders those as code, not as a link, so they are not documents the Session shows.
- `新建` marks a document produced by a create command (`workbook-create`, `docs +create`, …).

Bare URLs without a Markdown label fall back to their document token as the title until Feishu supplies the real one.

The popover opens with the signed-in Feishu account: avatar (or an initial), name, and `飞书个人用户`. The picture is downloaded once and cached on disk (`~/.dsh/feishu-docs-avatar.img`), then served from the plugin's own route with an ETag — so the first paint never waits on Feishu — and re-checked against Feishu once a day in the background. The red 退出 button signs the CLI out — two presses, with a cancel between them, because losing the token costs the creator and title columns. When nobody is signed in, the card shows a default avatar and a 登录 button; the authorization page opens, and the popover polls the device flow so the account appears by itself once you confirm in the browser. Signing out is only local; the documents are untouched, and the authorization item comes back so one press restores everything.

## First run

The popover lists whatever the machine still needs, with one action per item: copy the install command for a missing `zstd` or `lark-cli`, or press 去授权 to start the device-code login — it opens the Feishu authorization page and shows the same link, then finishes when you confirm. It asks only for the scopes this plugin reads (`drive:drive.metadata:readonly`, and `contact:user:search` for names). If the authorization lapses later, the same item reappears with a fresh link.

## Requires

| | |
|---|---|
| DSH desktop | runs the plugin |
| Node ≥ 22.15 (bundled with DSH) | zstd decompression in core |
| `zstd` binary | only if the Node build lacks zstd; detected automatically and reported by `/x-feishu-docs/doctor.json` |

## Known limits

- **No cross-session jump** — DSH exposes no public session-switching API, so a document from another Session copies a citation instead.
- **Creator and deletion state need `lark-cli`** — both come from Feishu through the CLI, using the signed-in user's own credentials. Without the CLI, or without a login, the creator stays empty and no document is marked deleted, rather than guessing.
- **Creator *names* need a contact scope** — the owner id always arrives; turning it into a person's name needs `contact:user:search`. The avatar needs no extra scope: it comes from `authen/v1/user_info`, and is cached locally afterwards. Login asks only for what `auth check` reports as missing. Without it the column shows the shortened owner id and `/x-feishu-docs/doctor.json` reports the reason in `creatorNames`. Grant it with `lark-cli auth login --scope "contact:user:search"`.
- **A deleted document stays listed** — the list is what the Session mentioned, not what Feishu still has. A document Feishu answers `not exist` for is kept, struck through and marked 已删除; `permission denied` is *not* deletion, so such a document stays unmarked.
- **Only messages count, not tool output** — a link buried in a tool result is deliberately invisible here.
- **Turn jump depends on loaded history** — it pages back before falling back to copying the location.

## License

MIT. The icon is original artwork drawn for this plugin.
