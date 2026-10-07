#!/usr/bin/env node
// 由 plugins/*.json + marketplace.meta.json 生成 marketplace.json 与 README 表格。
// 由 CI（.github/workflows/build-index.yml）自动运行；维护者本地也可手动跑。
// 注意：marketplace.json 与 README 表格都是生成物，不要手改。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(join(rootDir, "marketplace.meta.json"), "utf8"));
if (typeof meta.name !== "string" || !NAME_PATTERN.test(meta.name)) {
  die(`marketplace.meta.json: "name" 必须匹配 ${NAME_PATTERN}`);
}

const entries = readdirSync(join(rootDir, "plugins"))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => {
    try {
      return { file, entry: JSON.parse(readFileSync(join(rootDir, "plugins", file), "utf8")) };
    } catch (error) {
      return die(`plugins/${file}: JSON 解析失败：${error.message}`);
    }
  });

const seen = new Map();
for (const { file, entry } of entries) {
  if (typeof entry.name !== "string" || !NAME_PATTERN.test(entry.name)) {
    die(`plugins/${file}: "name" 必须匹配 ${NAME_PATTERN}`);
  }
  if (seen.has(entry.name)) die(`插件名 "${entry.name}" 重复（plugins/${file} 与 plugins/${seen.get(entry.name)}）`);
  seen.set(entry.name, file);
}

const featured = Array.isArray(meta.featured) ? meta.featured : [];
for (const name of featured) {
  if (!seen.has(name)) die(`marketplace.meta.json: featured 里的 "${name}" 没有对应条目`);
}

const plugins = entries.map(({ entry }) => entry).sort((a, b) => a.name.localeCompare(b.name));

// 读取上一版 manifest 里的 trust：非 enrich 构建（本地手动跑）保留已提交的数据，
// 避免构建产物在「有 trust / 无 trust」之间抖动；条目换了仓库（repo 不同）时旧数据作废。
const previousTrustByName = new Map();
try {
  const previous = JSON.parse(readFileSync(join(rootDir, "marketplace.json"), "utf8"));
  for (const item of previous?.plugins ?? []) {
    if (
      typeof item?.name === "string" &&
      item.trust &&
      typeof item.trust === "object" &&
      typeof item.source?.repo === "string"
    ) {
      previousTrustByName.set(item.name, { repo: item.source.repo, trust: item.trust });
    }
  }
} catch {
  // 首次构建没有历史 manifest
}

// 信任信号（可选增强）：CI 带 MARKETPLACE_ENRICH=1 时抓 star 与最近 push 时间写进 README。
// 尽力而为——单个仓库失败记 null，绝不让构建失败；本地不带该环境变量时保持离线确定性。
const enrich = process.env.MARKETPLACE_ENRICH === "1";
const trustByRepo = new Map();
if (enrich) {
  const token = process.env.GITHUB_TOKEN?.trim();
  for (const entry of plugins) {
    const source = entry.source ?? {};
    if (source.source !== "github" || typeof source.repo !== "string") continue;
    try {
      const response = await fetch(`https://api.github.com/repos/${source.repo}`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "hcode-community-index",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) throw new Error(String(response.status));
      const repo = await response.json();
      trustByRepo.set(source.repo, {
        stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : null,
        pushedAt: typeof repo.pushed_at === "string" ? repo.pushed_at.slice(0, 10) : null,
        archived: repo.archived === true,
      });
    } catch {
      trustByRepo.set(source.repo, null);
    }
  }
}

function resolveTrustForEntry(entry) {
  const source = entry.source ?? {};
  if (source.source !== "github" || typeof source.repo !== "string") return undefined;
  if (enrich) {
    const fresh = trustByRepo.get(source.repo);
    if (fresh) {
      return {
        ...(typeof fresh.stars === "number" ? { stars: fresh.stars } : {}),
        ...(typeof fresh.pushedAt === "string" ? { pushedAt: fresh.pushedAt } : {}),
        ...(fresh.archived ? { archived: true } : {}),
        fetchedAt: new Date().toISOString().slice(0, 10),
      };
    }
  }
  const previous = previousTrustByName.get(entry.name);
  return previous && previous.repo === source.repo ? previous.trust : undefined;
}

// trust 随条目写进 marketplace.json：客户端商店详情页/卡片直接消费，无需自己访问 GitHub。
const pluginsWithTrust = plugins.map((entry) => {
  const trust = resolveTrustForEntry(entry);
  return trust ? { ...entry, trust } : entry;
});
const manifest = {
  name: meta.name,
  ...(typeof meta.description === "string" ? { description: meta.description } : {}),
  ...(featured.length > 0 ? { featured } : {}),
  plugins: pluginsWithTrust,
};
writeFileSync(join(rootDir, "marketplace.json"), `${JSON.stringify(manifest, null, 2)}\n`);

function trustCells(entry) {
  const trust = entry.trust;
  if (!trust) return { stars: "—", pushedAt: "—" };
  if (trust.archived === true) return { stars: "⚠", pushedAt: "已归档" };
  return {
    stars: typeof trust.stars === "number" ? `⭐ ${trust.stars}` : "—",
    pushedAt: typeof trust.pushedAt === "string" ? trust.pushedAt : "—",
  };
}

const escapeCell = (value) =>
  String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const escapeLink = (value) => String(value).replace(/\(/g, "%28").replace(/\)/g, "%29");

function sourceCell(entry) {
  const source = entry.source ?? {};
  if (source.source === "github") {
    const url = `https://github.com/${source.repo}`;
    return `[${escapeCell(source.repo)}](${escapeLink(url)})`;
  }
  const url = typeof source.url === "string" ? source.url : "";
  return url ? `[${escapeCell(source.source)}](${escapeLink(url)})` : "—";
}

function pinCell(entry) {
  const source = entry.source ?? {};
  const pin = source.sha ?? source.commit ?? source.ref;
  return pin ? `\`${pin}\`` : "—";
}

const table =
  plugins.length === 0
    ? "_暂无插件 —— 欢迎成为第一个投稿者。_"
    : [
        "| 插件 | 说明 | 来源 | 版本钉 | 星标 | 最近更新 | 标签 |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...pluginsWithTrust.map((entry) => {
          const star = featured.includes(entry.name) ? "⭐ " : "";
          const trust = trustCells(entry);
          return `| ${star}\`${entry.name}\` | ${escapeCell(entry.description ?? "")} | ${sourceCell(entry)} | ${pinCell(entry)} | ${trust.stars} | ${trust.pushedAt} | ${escapeCell((entry.tags ?? []).join(", ")) || "—"} |`;
        }),
        "",
        `共 ${plugins.length} 个插件。（星标与最近更新由索引 CI 每日刷新）`,
      ].join("\n");

const readmePath = join(rootDir, "README.md");
const readme = readFileSync(readmePath, "utf8");
const startMarker = "<!-- plugins:start -->";
const endMarker = "<!-- plugins:end -->";
const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
if (!pattern.test(readme)) {
  die("README.md 里找不到 <!-- plugins:start --> / <!-- plugins:end --> 标记");
}
const nextReadme = readme.replace(pattern, `${startMarker}\n${table}\n${endMarker}`);
if (nextReadme !== readme) writeFileSync(readmePath, nextReadme);

console.log(`已生成 marketplace.json（${plugins.length} 个插件）并同步 README 表格。`);
