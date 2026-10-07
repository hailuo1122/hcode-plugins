# 投稿指南

本仓库是 HCode 的社区插件索引：所有条目直链插件作者自己的仓库。**投稿 = 新增一个 JSON 文件**，不需要把代码搬进来。

还没有插件？在 HCode 里启用 `plugin-creator` 插件，让它帮你生成脚手架，然后再回来投稿。

## 三步投稿

1. Fork 本仓库
2. 复制 `templates/plugin-entry.json` 到 `plugins/<你的插件名>.json`，按下面字段说明填写
3. 提 PR —— CI 会自动校验，通过并合并后插件即刻出现在 README 表格和所有已订阅客户端里

本地建议先跑一遍校验：

```sh
node scripts/validate-entry.mjs             # 全量校验（联网检查仓库与版本钉）
node scripts/validate-entry.mjs --offline   # 只查字段格式，不联网
```

## 条目字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 插件名：小写字母/数字/`.`/`_`/`-`。必须同时满足：与文件名一致、与插件仓库 `.zcode-plugin/plugin.json` 的 `name` 一致 |
| `description` | ✅ | 一句话说明 |
| `source` | ✅ | 安装来源，见下表 |
| `author` |  | 作者名（字符串）或 `{ "name": "...", "url": "..." }` |
| `homepage` / `icon` |  | 主页 / 图标 URL |
| `category` / `tags` |  | 分类 / 标签数组 |
| `displayName` |  | 商店里展示的更友好名字 |
| `examplePrompts` |  | 示例提示词数组 |
| `privacyPolicy` / `termsOfService` |  | 隐私政策 / 服务条款 URL |

### source 的三种写法

| 类型 | 写法 | 联网校验内容 |
| --- | --- | --- |
| GitHub（推荐） | `{ "source": "github", "repo": "owner/repo", "ref": "v1.0.0" }` | 仓库存在且 public、版本钉可达、plugin.json 名称一致 |
| 任意 Git | `{ "source": "git", "url": "https://...", "ref": "..." }` | 仅字段格式（非 GitHub 源不做深检） |
| ZIP | `{ "source": "url", "type": "zip", "url": "https://...", "sha256": "<64位hex>" }` | URL 可达 + sha256 格式 |

monorepo：用 `source.path` 指向插件所在子目录（如 `"path": "plugins/my-plugin"`）。

## 强烈建议：钉版本

写完代码后打个 release tag，并在 `source.ref` 填这个 tag（或直接填 `source.sha`）：

- **钉了版本**：上游后续改坏代码，用户装到的仍是你投稿时的版本
- **不钉版本**：CI 会给出 warning，且你每次 push 都会直接改变已收录插件给用户的内容

## CI 检查什么、不检查什么

检查（全部是机械校验）：

1. JSON 合法、字段类型正确、没有拼错的字段名
2. 文件名 = `name` 字段；插件名不与已收录条目重复
3. 作者仓库存在且 public；`ref` / `sha` 可达
4. 入口路径下 `.zcode-plugin/plugin.json` 存在，且 `name` 与条目一致

**不检查**：代码质量、安全性、是否恶意。收录 ≠ 安全背书 —— 插件是以用户权限运行的第三方代码，请自行判断。

## 常见 CI 报错对照

| 报错 | 原因与修法 |
| --- | --- |
| `GitHub 仓库不存在或不是 public` | 仓库名写错，或仓库还是 private |
| `版本钉 "x" 在 ... 中找不到` | tag 没打 / 没 push / 打在了别的仓库 |
| `缺少 .zcode-plugin/plugin.json` | 仓库入口路径下没有该文件；monorepo 请用 `source.path` |
| `plugin.json 里的 name "a" 与条目名 "b" 不一致` | 改名需同步：插件仓库 plugin.json、本文件名、本文件 name 三处 |
| `未知字段 "xxx"` | 字段名拼错了，对照上面的字段表 |
| `文件名必须是 "name.json"` | 文件名与 name 字段不一致 |

## 下架与投诉

- 自己下架：提 PR 删除你的 `plugins/<name>.json` 即可
- 投诉他人条目（恶意代码、商标侵权、条目信息错误等）：开一个 `report-plugin` issue
- 明显垃圾、恶意或侵权的条目，维护者可以直接拒绝或删除，无需给出详细理由

## 维护者备忘

- 合并后 `build-index` 工作流自动重建 `marketplace.json` 和 README 表格；**不要手改 `marketplace.json`**
- 置顶插件：编辑 `marketplace.meta.json` 的 `featured` 数组（填插件 `name`）
- 手动重建：`node scripts/build-marketplace.mjs`
