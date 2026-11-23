# 发布到插件市场

DSH 的插件市场**没有中央审核**：市场就是一份 **索引 JSON**（`format: 1`）放在某个 https 地址上，
用户把该地址加到 Discover 的索引列表里，就能搜索并一键安装。

所以“发布”= ①代码托管 → ②生成索引 → ③把索引放到 https → ④告诉别人加索引。

---

## 一、把代码推到 GitHub

```bash
cd dsh-plugin-feishu-docs          # 本目录
git remote add origin https://github.com/WaterLiu/dsh-plugin-feishu-docs.git
git push -u origin main
```

然后改两处占位符：

| 文件 | 改什么 |
|---|---|
| `package.json` | `repository.url` → 你的仓库地址 |
| `index.json`（下一步生成） | 自动读取上面的地址 |
| `LICENSE` | 已写为 `WaterLiu` |

## 二、生成索引

```bash
node tools/make-index.mjs          # git 源，钉住当前 commit
node tools/make-index.mjs --npm    # 或者用 npm 源
```

生成器会：

1. 读 `package.json` 的 name / version / repository
2. 读 `git rev-parse HEAD` 作为 40 位 commit（**不用手抄**）
3. 校验 format 1 的硬规则（SemVer、时间戳、commit 长度、name 语法、category/label 是否已声明）
4. 写出 `index.json`

产出示例：

```json
{
  "format": 1,
  "title": { "en": "Feishu documents", "zh": "飞书云文档" },
  "plugins": [{
    "name": "dsh-plugin-feishu-docs",
    "versions": [{
      "version": "2.0.0",
      "publishTimestamp": 1794812345,
      "source": {
        "type": "git",
        "url": "https://github.com/you/dsh-plugin-feishu-docs",
        "commit": "03c75bdc90383fac3e7a5badd2b1f836cc89f945",
        "path": "."
      },
      "engines": { "dsh": ">=0.2.0" }
    }]
  }]
}
```

> **每次发版都要重新生成**：commit 变了，旧索引指向的代码就不对了。

## 三、把索引放到 https

三种都行：

| 方式 | 索引 URL |
|---|---|
| 索引和代码同一个仓库 | `https://raw.githubusercontent.com/WaterLiu/dsh-plugin-feishu-docs/main/index.json` |
| 单独一个索引仓库（推荐，可列多个插件） | `https://raw.githubusercontent.com/<你>/dsh-plugin-market/main/index.json` |
| GitHub Pages | `https://<你>.github.io/dsh-plugin-market/index.json` |

要求：**https、无凭据、无 query/fragment**。

## 四、别人怎么装

**方式 A：加索引（长期可发现）**

Discover 页 → 索引 → 添加 URL → 搜索“飞书云文档” → 安装。

**方式 B：直接给 spec（最省事）**

```
Plugins → Add plugin → github:WaterLiu/dsh-plugin-feishu-docs
```

**方式 C：让 Agent 装**

```
plugin_manager install_bundle target: "github:WaterLiu/dsh-plugin-feishu-docs"
```

## 五、发布到 npm（可选）

如果想让 `source.type = "npm"`：

```bash
npm publish --access public
node tools/make-index.mjs --npm     # 索引改为 npm 源
```

npm 源的好处是用户装的是版本号而不是 commit；坏处是要维护发布流程。

---

## 检查清单

- [ ] `package.json` 的 `name` / `version` / `repository.url` 正确
- [ ] `git push` 完成，工作区干净（索引钉的是**已推送**的 commit）
- [ ] `node tools/make-index.mjs` 重新生成了 `index.json`
- [ ] `index.json` 已提交并推送
- [ ] 用浏览器打开索引 URL，确认返回 JSON
- [ ] 在另一台机器（或新 profile）加索引 → 搜索 → 安装 → 重启 → 标题栏出现 ☁
- [ ] 仓库里**没有**任何会话数据（`grep -r larkoffice` 应为空）
