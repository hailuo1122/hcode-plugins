#!/usr/bin/env node
// 校验 plugins/*.json 投稿条目。
//
// 用法:
//   node scripts/validate-entry.mjs            全量校验（含联网：仓库可达 / 版本钉可达 / plugin.json 名称一致）
//   node scripts/validate-entry.mjs --offline  只做字段校验，不联网
//
// CI 里由 .github/workflows/validate.yml 调用；本地投稿前建议先跑一遍。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginsDir = join(rootDir, "plugins");
const offline = process.argv.includes("--offline");
const inActions = process.env.GITHUB_ACTIONS === "true";

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTRY_FIELDS = new Set([
  "name",
  "description",
  "source",
  "author",
  "homepage",
  "icon",
  "category",
  "displayName",
  "tags",
  "examplePrompts",
  "privacyPolicy",
  "termsOfService",
]);
const SOURCE_FIELDS = {
  github: new Set(["source", "repo", "ref", "sha", "commit", "path"]),
  git: new Set(["source", "url", "ref", "sha", "commit", "path"]),
  url: new Set(["source", "type", "url", "sha256", "path", "stripRoot"]),
};

const errors = [];
const warnings = [];
const fail = (file, message) => errors.push({ file, message });
const warn = (file, message) => warnings.push({ file, message });

function validateEntryShape(file, entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    fail(file, "条目必须是一个 JSON 对象");
    return false;
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_FIELDS.has(key)) fail(file, `未知字段 "${key}"（拼写错误？可用字段见 CONTRIBUTING.md）`);
  }
  if (typeof entry.name !== "string" || !NAME_PATTERN.test(entry.name)) {
    fail(file, `"name" 必须匹配 ${NAME_PATTERN}（小写字母/数字/._-，且不以符号开头）`);
  } else if (`${entry.name}.json` !== file) {
    fail(file, `文件名必须是 "${entry.name}.json"（与 "name" 字段一致）`);
  }
  if (typeof entry.description !== "string" || entry.description.trim() === "") {
    fail(file, '"description" 必填且必须是非空字符串');
  }
  const author = entry.author;
  if (
    author !== undefined &&
    typeof author !== "string" &&
    !(
      typeof author === "object" &&
      author !== null &&
      !Array.isArray(author) &&
      (typeof author.name === "string" || typeof author.url === "string")
    )
  ) {
    fail(file, '"author" 必须是字符串或 { "name"?, "url"? }');
  }
  if (
    entry.tags !== undefined &&
    (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== "string"))
  ) {
    fail(file, '"tags" 必须是字符串数组');
  }
  for (const key of ["homepage", "icon", "category", "displayName", "privacyPolicy", "termsOfService"]) {
    if (entry[key] !== undefined && typeof entry[key] !== "string") {
      fail(file, `"${key}" 必须是字符串`);
    }
  }
  if (
    entry.examplePrompts !== undefined &&
    (!Array.isArray(entry.examplePrompts) ||
      entry.examplePrompts.some((prompt) => typeof prompt !== "string"))
  ) {
    fail(file, '"examplePrompts" 必须是字符串数组');
  }
  return true;
}

function validateSource(file, source) {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    fail(file, '"source" 必填且必须是对象');
    return null;
  }
  const kind = source.source;
  if (typeof kind !== "string" || !(kind in SOURCE_FIELDS)) {
    fail(file, '"source.source" 只支持 "github" / "git" / "url"（zip）');
    return null;
  }
  for (const key of Object.keys(source)) {
    if (!SOURCE_FIELDS[kind].has(key)) {
      fail(file, `source 里的未知字段 "${key}"（${kind} 源可用：${[...SOURCE_FIELDS[kind]].join(", ")}）`);
    }
  }
  if (source.sha !== undefined && (typeof source.sha !== "string" || !SHA1_PATTERN.test(source.sha))) {
    fail(file, '"source.sha" 必须是 40 位十六进制 commit hash');
    return null;
  }
  if (source.commit !== undefined && (typeof source.commit !== "string" || !SHA1_PATTERN.test(source.commit))) {
    fail(file, '"source.commit" 必须是 40 位十六进制 commit hash');
    return null;
  }
  if (source.ref !== undefined && (typeof source.ref !== "string" || source.ref.trim() === "")) {
    fail(file, '"source.ref" 必须是非空字符串');
    return null;
  }
  if (source.path !== undefined) {
    if (typeof source.path !== "string" || source.path.trim() === "") {
      fail(file, '"source.path" 必须是非空字符串');
      return null;
    }
    if (source.path.startsWith("/") || source.path.split(/[\\/]/).includes("..")) {
      fail(file, '"source.path" 必须是仓库内相对路径，且不能包含 ".."');
      return null;
    }
  }
  if (kind === "github") {
    if (typeof source.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(source.repo)) {
      fail(file, '"source.repo" 必须是 "owner/repo" 格式');
      return null;
    }
  }
  if (kind === "git" && (typeof source.url !== "string" || source.url.trim() === "")) {
    fail(file, '"source.url" 必填（git 仓库地址）');
    return null;
  }
  if (kind === "url") {
    if (source.type !== "zip") {
      fail(file, '"source.type" 目前只支持 "zip"');
      return null;
    }
    if (typeof source.url !== "string" || source.url.trim() === "") {
      fail(file, '"source.url" 必填（zip 下载地址）');
      return null;
    }
    if (typeof source.sha256 !== "string" || !SHA256_PATTERN.test(source.sha256)) {
      fail(file, '"source.sha256" 必填且必须是 64 位十六进制（zip 完整性校验）');
      return null;
    }
  }
  return kind;
}

async function githubRequest(apiPath, { attempts = 3 } = {}) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "hcode-community-index" };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await fetch(`https://api.github.com${apiPath}`, { headers });
    // 403/429 多为共享 IP 的二级限流（core 额度未必耗尽），短暂退避后重试；
    // 重试仍失败则按真实响应上报，避免把限流伪装成条目错误。
    if (response.status !== 403 && response.status !== 429) return response;
    if (attempt >= attempts) return response;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 30_000)
        : 5_000 * attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return response;
}

async function checkGithubSource(file, name, source) {
  const repo = source.repo;
  const repoResponse = await githubRequest(`/repos/${repo}`);
  if (repoResponse.status === 404) {
    fail(file, `GitHub 仓库不存在或不是 public：${repo}`);
    return;
  }
  if (repoResponse.status !== 200) {
    fail(file, `查询 ${repo} 时 GitHub API 返回 ${repoResponse.status}`);
    return;
  }

  const pin = source.sha ?? source.commit ?? source.ref;
  if (pin) {
    const pinResponse = await githubRequest(`/repos/${repo}/commits/${encodeURIComponent(pin)}`);
    if (pinResponse.status === 404 || pinResponse.status === 422) {
      fail(file, `版本钉 "${pin}" 在 ${repo} 中找不到（tag 没打 / 没 push？）`);
      return;
    }
    if (pinResponse.status !== 200) {
      fail(file, `检查版本钉 ${pin} 时 GitHub API 返回 ${pinResponse.status}`);
      return;
    }
  }

  const subPath =
    typeof source.path === "string" ? `${source.path.replace(/^\.?\//, "")}/` : "";
  const manifestPath = `${subPath}.zcode-plugin/plugin.json`;
  const query = pin ? `?ref=${encodeURIComponent(pin)}` : "";
  const manifestResponse = await githubRequest(`/repos/${repo}/contents/${manifestPath}${query}`);
  if (manifestResponse.status === 404) {
    fail(
      file,
      `缺少 ${manifestPath}（仓库需要 .zcode-plugin/plugin.json；monorepo 请用 source.path 指向子目录）`,
    );
    return;
  }
  if (manifestResponse.status !== 200) {
    fail(file, `读取 ${manifestPath} 时 GitHub API 返回 ${manifestResponse.status}`);
    return;
  }
  const body = await manifestResponse.json();
  if (body.encoding !== "base64" || typeof body.content !== "string") {
    fail(file, `读取 ${manifestPath} 返回了意外的内容格式`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
  } catch {
    fail(file, `${manifestPath} 不是合法 JSON`);
    return;
  }
  if (manifest.name !== name) {
    fail(
      file,
      `plugin.json 里的 name "${manifest.name}" 与条目名 "${name}" 不一致（改名需同时改仓库、本文件名与本文件 name）`,
    );
  }
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    warn(file, `plugin.json 没有 version 字段；建议同时在 source.ref 里钉一个 release tag`);
  }
  if (!pin) {
    warn(file, "未钉版本（source.ref / source.sha）：上游每次 push 都会改变用户装到的内容，建议钉 release tag");
  }
}

async function checkZipSource(file, source) {
  try {
    const response = await fetch(source.url, { method: "HEAD", redirect: "follow" });
    if (!response.ok) fail(file, `zip 源不可达：HTTP ${response.status}`);
  } catch (error) {
    fail(file, `zip 源不可达：${error.message}`);
  }
}

function validateMeta() {
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(rootDir, "marketplace.meta.json"), "utf8"));
  } catch (error) {
    fail("marketplace.meta.json", `无法解析：${error.message}`);
    return { featured: [] };
  }
  if (typeof meta.name !== "string" || !NAME_PATTERN.test(meta.name)) {
    fail("marketplace.meta.json", `"name" 必须匹配 ${NAME_PATTERN}`);
  }
  return { featured: Array.isArray(meta.featured) ? meta.featured : [] };
}

async function main() {
  const { featured } = validateMeta();

  const files = readdirSync(pluginsDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const byName = new Map();
  const sources = [];
  for (const file of files) {
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(pluginsDir, file), "utf8"));
    } catch (error) {
      fail(file, `JSON 解析失败：${error.message}`);
      continue;
    }
    if (!validateEntryShape(file, entry)) continue;
    if (byName.has(entry.name)) {
      fail(file, `插件名 "${entry.name}" 重复（已存在于 ${byName.get(entry.name)}）`);
    } else {
      byName.set(entry.name, file);
    }
    const kind = validateSource(file, entry.source);
    if (kind) sources.push({ file, name: entry.name, kind, source: entry.source });
  }

  for (const name of featured) {
    if (!byName.has(name)) {
      fail("marketplace.meta.json", `featured 里的 "${name}" 没有对应条目`);
    }
  }

  if (!offline) {
    for (const item of sources) {
      if (item.kind === "github") {
        await checkGithubSource(item.file, item.name, item.source);
      } else if (item.kind === "url") {
        await checkZipSource(item.file, item.source);
      } else {
        warn(item.file, "非 GitHub 源跳过深度校验（只检查字段格式）");
      }
    }
  }

  const escapeAnnotation = (message) =>
    message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  for (const { file, message } of warnings) {
    if (inActions) console.log(`::warning file=${file.startsWith("plugins/") ? file : `plugins/${file}`}::${escapeAnnotation(message)}`);
    else console.warn(`warning: ${file}: ${message}`);
  }
  for (const { file, message } of errors) {
    if (inActions) console.log(`::error file=${file.startsWith("plugins/") ? file : `plugins/${file}`}::${escapeAnnotation(message)}`);
    else console.error(`error: ${file}: ${message}`);
  }

  if (errors.length > 0) {
    console.error(`\n校验失败：${errors.length} 个错误，${warnings.length} 个警告。`);
    process.exit(1);
  }
  console.log(
    `校验通过：${files.length} 个条目，${warnings.length} 个警告${offline ? "（--offline，未联网检查）" : ""}。`,
  );
}

main().catch((error) => {
  console.error(`校验器异常：${error.stack ?? error.message}`);
  process.exit(1);
});
