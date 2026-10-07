# HCode Community Plugins

HCode 社区插件索引：一个 `marketplace.json`，条目全部指向插件作者自己的仓库。

**这不是一个代码仓库。** 这里只有指针和元数据 —— 每个插件都住在作者自己的 GitHub 仓库里，本仓库只负责收录、机械校验与聚合。收录不代表安全背书。

## 立即订阅

HCode → 设置 → 插件市场 → 添加市场，输入：

```
hailuo1122/hcode-plugins
```

订阅后，本索引收录的插件会出现在你的插件市场里，勾选安装即可。

## 已收录插件

<!-- plugins:start -->
| 插件 | 说明 | 来源 | 版本钉 | 星标 | 最近更新 | 标签 |
| --- | --- | --- | --- | --- | --- | --- |
| ⭐ `engram` | Evidence-based learning engine: first-principles curricula, generation-first Socratic tutoring, free-recall verification with receipts, FSRS-scheduled memory, and interactive explorable artifacts. Learn anything; keep it. | [nagisanzenin/engram](https://github.com/nagisanzenin/engram) | `v1.15.1` | ⭐ 1441 | 2026-08-27 | learning, memory, productivity |

共 1 个插件。（星标与最近更新由每日构建任务自动刷新）
<!-- plugins:end -->

## 投稿插件

1. Fork 本仓库
2. 在 `plugins/` 下新增 `<你的插件名>.json`（模板见 `templates/plugin-entry.json`）
3. 提 PR —— CI 自动校验：仓库可达、版本钉可达、`.zcode-plugin/plugin.json` 名称一致
4. CI 通过并合并后，你的插件自动出现在上表，以及所有已订阅客户端里

字段说明、版本钉建议和常见报错对照见 [CONTRIBUTING.md](CONTRIBUTING.md)。

还没有插件？在 HCode 里启用 `plugin-creator` 插件，可以直接让它帮你生成插件脚手架。

## 维护者备忘

- `marketplace.json` 与上面的表格由 CI 从 `plugins/*.json` 自动生成，**不要手改**
- 置顶插件：编辑 `marketplace.meta.json` 的 `featured` 数组
- 本地手动重建：`node scripts/build-marketplace.mjs`；本地校验：`node scripts/validate-entry.mjs`

## 免责声明

本索引只做机械校验（字段格式、仓库与版本钉可达性、名称一致性），不做代码审计，也不构成安全背书。插件是第三方代码，安装后以你的权限运行 —— 请在安装前自行判断来源可信度。发现问题请开 issue 投诉。
