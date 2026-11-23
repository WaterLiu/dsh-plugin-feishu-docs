# 上架 DSH 插件市场

## 市场是怎么运作的（先说清楚，不然会走错路）

DSH 有两个层面，容易混：

| | 是什么 | 你能做什么 |
|---|---|---|
| **dshmarket**（市场应用） | 已装在 DSH 里的可视化市场，数据来自社区精选列表 | 你**不能**往它提插件（README 明确写了「请不要往本仓库提插件条目」） |
| **awesome-dsh-plugin**（精选列表仓库） | 真正的插件目录，市场每日从这里同步 | ✅ **你要往这里提 PR** |

所以上架 = 往 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提一个 **YAML 文件**的 PR。

同步链路：

```
你提 PR → 合并 → CI 生成 README + 发布 npm 包 dsh-plugin-catalog
        → 市场（dshmarket）每日从该目录同步 → 用户搜索到你的插件
```

---

## 一、提交什么

**一个文件**，路径与命名：

```
data/plugins/<owner>__<repo>.yml
```

例：`data/plugins/bytedance__dsh-plugin-feishu-docs.yml`

内容（`dist/market-entry.yml` 已备好，把 `OWNER` 换成你的 GitHub 账号）：

```yaml
url: https://github.com/OWNER/dsh-plugin-feishu-docs
name: OWNER/dsh-plugin-feishu-docs
category: docs
description:
  en: Lists the Feishu documents a session's own messages mention, behind a header chip, with each document's creator and a jump back to the turn it appeared in.
  zh: 在会话标题栏显示一个胶囊，列出该会话消息中出现过的飞书云文档，含创建者，并可跳回该文档出现的那一轮。
icon: https://raw.githubusercontent.com/OWNER/dsh-plugin-feishu-docs/main/assets/icon-180.png
```

规则要点：

| 字段 | 要求 |
|---|---|
| `url` | 必须与仓库地址**完全一致** |
| `name` | 显示用的链接文字，`owner/repo` |
| `category` | 从固定集合选：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`。本插件选 **`docs`**（也可 `session`，维护者会改，不会打回） |
| `description.en` | **必填**，一句话，**以句号结尾**，不含营销词 |
| `description.zh` | 可选（不写维护者会补） |
| `icon` | 可选。**必须是 GitHub 托管的位图**（png/jpg/webp），**SVG 会被拒**。用 `assets/icon-180.png` |

> YAML 陷阱：`description` 里出现 `: `（冒号+空格）必须加引号。我们这句没有，安全。

## 二、硬性门槛（CI 自动检查）

| 门槛 | 本插件状态 |
|---|---|
| `package.json` 声明 **`dsh.bundle`** | ✅ 有（`{"bundle":{"patch":"./cordis.patch.yml"}}`） |
| 有真实可用的代码 | ✅ |
| 仓库**创建满 1 天** | ⚠️ **新仓库会被 CI 挡住**，等一天即可，不算被拒 |
| 仓库加 `dsh-plugin` topic | ❌ 需要你在 GitHub 上加 |
| 描述与实际一致 | ✅（维护者会读代码核对） |
| 一个 PR 最多 3 条 | ✅ 我们只提 1 条 |

## 三、操作步骤

```bash
# 1. 先把你的仓库推上去（见 PUBLISH.md），并在 GitHub 上：
#    Settings → Topics → 加 `dsh-plugin`

# 2. fork + clone 列表仓库
git clone https://github.com/OWNER/awesome-dsh-plugin.git
cd awesome-dsh-plugin

# 3. 放条目文件
cp /path/to/dist/market-entry.yml data/plugins/OWNER__dsh-plugin-feishu-docs.yml
#    把里面的 OWNER 换成你的账号

# 4. 提 PR
git checkout -b add-feishu-docs
git add data/plugins/OWNER__dsh-plugin-feishu-docs.yml
git commit -m "Add dsh-plugin-feishu-docs"
git push origin add-feishu-docs
```

> **不要手工改 README**：两份 README 由 `data/plugins/*.yml` 生成，合并后 CI 自动重建。手改会导致冲突（历史上 296 个开放 PR 里 218 个因此无法合并）。

## 四、评审会看什么

1. 代码是否真做了条目里写的事（**描述夸大是最常见的打回原因**）
2. 分类是否合理（不合理维护者直接改，不打回）
3. 是否真实可用、不是占位
4. 是否与列表已有条目重复
5. 源码有无可疑行为（混淆、窃取凭据、安装期副作用）

被打回会打 `held: author` 标签 → 在**同一分支**推送修复 + 留**一条**评论说明改了什么即可，不要反复推空提交。

## 五、可选的加分项

| 项 | 收益 | 做法 |
|---|---|---|
| 发布到 npm | 市场显示下载量、排序更靠前；预构建安装免构建授权 | `npm publish --access public`，`package.json` 的 `repository` 指回本仓库 |
| 截图 | 市场详情页 App Store 风格展示 | 仓库根放 `screenshots.json`，列 1–8 个相对路径 |
| GitHub Release tarball | 仓库无法源码安装时**必需** | 用 `tarball:` 字段指向 `https://github.com/…/releases/…/x.tgz` |

本插件**不需要** tarball（纯 JS，无构建步骤）。

## 六、时间预期

| 阶段 | 时间 |
|---|---|
| PR 合并 | 通常数小时到一两天（人工评审） |
| 目录站点更新 | 合并后 CI 自动重建 |
| 市场（dshmarket）同步 | 每日一次 |

---

## 检查清单

- [ ] 仓库已推送，`package.json` 有 `dsh.bundle`
- [ ] 仓库加了 `dsh-plugin` topic
- [ ] 仓库创建满 1 天
- [ ] `assets/icon-180.png` 已提交（PNG 不是 SVG）
- [ ] 条目文件里 `OWNER` 全部替换
- [ ] `url` 与仓库地址逐字符一致
- [ ] `description.en` 以句号结尾、无营销词、与代码一致
- [ ] PR 只加了这 1 个文件，没动 README
