#!/usr/bin/env node
// 扫描 GitHub 上可分发的 HCode 插件仓库，为每个新插件生成 plugins/<name>.json 候选条目。
//
// 发现渠道：
//   1) GitHub topic: hcode-plugin
//   2) 代码搜索: filename:plugin.json path:.zcode-plugin（支持 monorepo 子目录形态）
//
// 用法:
//   GITHUB_TOKEN=... node scripts/discover-candidates.mjs [--dry-run]
//
// 候选在生成时已完成与 validate-entry.mjs 等价的机械检查（仓库可达、拒绝 archived、
// manifest 合法、名字去重、仅钉与 manifest version 精确匹配的 tag）；workflow 里仍会
// 对全量条目再跑一次 validate-entry.mjs，任何一条不过就整批不提交（安全降级为不产出 PR）。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginsDir = join(rootDir, "plugins");
const dryRun = process.argv.includes("--dry-run");
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error("error: 需要 GITHUB_TOKEN 环境变量（CI 里用 github.token）");
  process.exit(1);
}

const INDEX_REPOSITORY = "hailuo1122/hcode-plugins";
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

// 代码搜索在 CI 共享 IP 上常触发二级限流（429/403），这里退避重试；
// 调用方对代码搜索这类可降级通道用软失败，不阻塞整次发现。
async function ghJson(apiPath, { attempts = 1, baseDelayMs = 15_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "hcode-community-index",
      },
    });
    if (response.ok) return response.json();
    lastError = new Error(`GitHub API ${response.status}: ${apiPath}`);
    const retryable = response.status === 429 || response.status === 403;
    if (!retryable || attempt >= attempts) throw lastError;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 90_000)
        : Math.min(baseDelayMs * attempt, 90_000);
    console.warn(`  限流（${response.status}），${Math.round(waitMs / 1000)}s 后重试（${attempt}/${attempts}）`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw lastError;
}

function normalizeAuthor(value, fallbackLogin) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (name && url) return { name, url };
    if (name) return name;
    if (url) return { url };
  }
  return fallbackLogin;
}

function readExistingNames() {
  const names = new Set();
  for (const file of readdirSync(pluginsDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(join(pluginsDir, file), "utf8"));
      if (typeof entry.name === "string") names.add(entry.name);
    } catch {
      names.add(file.replace(/\.json$/, ""));
    }
  }
  return names;
}

// 收集候选：fullName -> Set<repoPath>（repoPath 为插件子目录，根目录为 ""）
const candidatesByRepo = new Map();
function addCandidate(fullName, repoPath) {
  if (!fullName) return;
  const paths = candidatesByRepo.get(fullName) ?? new Set();
  paths.add(repoPath);
  candidatesByRepo.set(fullName, paths);
}

// 渠道 1/2：官方约定 topic（精确、限速宽松）
for (const topic of ["hcode-plugin", "zcode-plugin"]) {
  console.log(`发现渠道: topic:${topic}`);
  try {
    const result = await ghJson(
      `/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}&per_page=100`,
      { attempts: 3 },
    );
    for (const item of result.items ?? []) addCandidate(item.full_name, "");
  } catch (error) {
    console.warn(`  跳过（${error.message}）`);
  }
}

// 渠道 2/2：代码搜索（精确，能发现 monorepo 子目录；共享 IP 上常被限流，失败不阻塞）
console.log("发现渠道: 代码搜索 .zcode-plugin/plugin.json");
try {
  const codeResult = await ghJson(
    "/search/code?q=filename:plugin.json+path:.zcode-plugin&per_page=100",
    { attempts: 5, baseDelayMs: 20_000 },
  );
  for (const item of codeResult.items ?? []) {
    const itemPath = typeof item.path === "string" ? item.path : "";
    const match = itemPath.match(/^(.*?)\.zcode-plugin\/plugin\.json$/u);
    if (!match) continue;
    const repoPath = (match[1] ?? "").replace(/\/+$/u, "");
    addCandidate(item.repository?.full_name, repoPath);
  }
} catch (error) {
  console.warn(`  代码搜索不可用，本次跳过（${error.message}）`);
}
console.log(`共 ${candidatesByRepo.size} 个候选仓库`);

const existingNames = readExistingNames();
const accepted = [];
const skipped = [];

for (const [fullName, repoPaths] of candidatesByRepo) {
  if (fullName === INDEX_REPOSITORY) continue;
  let repo;
  try {
    repo = await ghJson(`/repos/${fullName}`);
  } catch (error) {
    skipped.push(`${fullName}: ${error.message}`);
    continue;
  }
  if (repo.archived) {
    skipped.push(`${fullName}: archived`);
    continue;
  }
  for (const repoPath of repoPaths) {
    const manifestPath = repoPath
      ? `${repoPath}/.zcode-plugin/plugin.json`
      : ".zcode-plugin/plugin.json";
    let manifest;
    try {
      const file = await ghJson(
        `/repos/${fullName}/contents/${manifestPath}?ref=${encodeURIComponent(repo.default_branch)}`,
      );
      manifest = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
    } catch {
      skipped.push(`${fullName}/${repoPath || "."}: 读取 plugin.json 失败`);
      continue;
    }
    const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
    if (!NAME_PATTERN.test(name)) {
      skipped.push(`${fullName}/${repoPath || "."}: manifest name 非法`);
      continue;
    }
    if (existingNames.has(name)) {
      skipped.push(`${fullName}/${repoPath || "."}: "${name}" 已收录`);
      continue;
    }
    const description =
      (typeof manifest.description === "string" && manifest.description.trim()) ||
      repo.description ||
      "";
    if (!description) {
      skipped.push(`${fullName}/${repoPath || "."}: 无描述`);
      continue;
    }
    // 只有与 manifest version 精确匹配的 tag 才钉：v<version> 或 <version>。
    // 找不到匹配 tag 就不钉（validate 会给出 warning，由维护者在 PR 里决定是否补）。
    let ref;
    const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
    if (version) {
      for (const tag of [`v${version}`, version]) {
        try {
          await ghJson(`/repos/${fullName}/git/ref/tags/${encodeURIComponent(tag)}`);
          ref = tag;
          break;
        } catch {
          // tag 不存在，试下一个形态
        }
      }
    }
    const keywords = Array.isArray(manifest.keywords)
      ? manifest.keywords.filter((item) => typeof item === "string").slice(0, 5)
      : [];
    const entry = {
      name,
      description: description.trim().slice(0, 500),
      source: {
        source: "github",
        repo: fullName,
        ...(repoPath ? { path: repoPath } : {}),
        ...(ref ? { ref } : {}),
      },
      author: normalizeAuthor(manifest.author, repo.owner?.login ?? fullName.split("/")[0]),
      homepage: repo.html_url,
      ...(keywords.length > 0 ? { tags: keywords } : {}),
    };
    accepted.push({ entry, stars: repo.stargazers_count ?? 0 });
  }
}

// 同名候选去重：保留 star 更多的那个（fork 与上游同名时取上游/更活跃者）。
const byName = new Map();
for (const candidate of accepted) {
  const existing = byName.get(candidate.entry.name);
  if (!existing) {
    byName.set(candidate.entry.name, candidate);
  } else if (candidate.stars > existing.stars) {
    skipped.push(`${existing.entry.source.repo}: "${candidate.entry.name}" 同名，被更活跃的 ${candidate.entry.source.repo} 取代`);
    byName.set(candidate.entry.name, candidate);
  } else {
    skipped.push(`${candidate.entry.source.repo}: "${candidate.entry.name}" 同名，保留更活跃的 ${existing.entry.source.repo}`);
  }
}

const finalEntries = [...byName.values()].toSorted((a, b) => a.entry.name.localeCompare(b.entry.name));
for (const { entry } of finalEntries) {
  const target = join(pluginsDir, `${entry.name}.json`);
  if (dryRun) {
    console.log(`[dry-run] 将写入 plugins/${entry.name}.json -> ${entry.source.repo}${entry.source.ref ? ` @ ${entry.source.ref}` : "（未钉）"}`);
  } else {
    writeFileSync(target, `${JSON.stringify(entry, null, 2)}\n`);
    console.log(`已写入 plugins/${entry.name}.json -> ${entry.source.repo}${entry.source.ref ? ` @ ${entry.source.ref}` : "（未钉）"}`);
  }
}

if (skipped.length > 0) {
  console.log("\n跳过：");
  for (const line of skipped) console.log(`  - ${line}`);
}
console.log(`\n结果：${finalEntries.length} 个新候选${dryRun ? "（dry-run 未落盘）" : ""}，跳过 ${skipped.length} 个。`);
