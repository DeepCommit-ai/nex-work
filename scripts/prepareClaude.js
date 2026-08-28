#!/usr/bin/env node
/**
 * 把 pinned 的 Claude Code 原生二进制下载解包到 resources/bundled-claude/<plat>-<arch>/。
 * cynapse issue #8：员工机器离线也必须有 claude 可用，所以在【构建时】取好、
 * 随安装包分发；运行时零下载。
 *
 * 载荷来源：npm 平台包 `@anthropic-ai/claude-code-<plat>-<arch>`（官方按平台发布
 * 的原生二进制包，`package/claude` 即真身；上层的 @anthropic-ai/claude-code 只是
 * 下载器壳，装它反而要在运行时联网——所以直接取平台包）。
 *
 * 版本来源（优先级）：AIONUI_CLAUDE_VERSION 环境变量 > 根 package.json 的
 * "claudeCodeVersion"（钉死的主来源，不接受 latest 漂移）。
 * 目标平台：--platform/--arch 参数 > 当前机器。
 * 幂等：<plat>-<arch>/VERSION 与目标一致则跳过。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function resolveVersion() {
  const env = (process.env.AIONUI_CLAUDE_VERSION || '').trim();
  if (env) return env;
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  const pinned = typeof pkg.claudeCodeVersion === 'string' ? pkg.claudeCodeVersion.trim() : '';
  if (!pinned) {
    throw new Error('package.json 缺少 "claudeCodeVersion"——版本必须钉死，不接受 latest 漂移');
  }
  return pinned;
}

function prepareClaude({ platform, arch, version } = {}) {
  const plat = platform || argValue('--platform') || process.platform;
  const targetArch = arch || argValue('--arch') || process.arch;
  const ver = version || resolveVersion();
  const key = `${plat}-${targetArch}`;
  const bin = plat === 'win32' ? 'claude.exe' : 'claude';

  const destDir = path.join(repoRoot, 'resources', 'bundled-claude', key);
  const versionFile = path.join(destDir, 'VERSION');
  const binPath = path.join(destDir, bin);
  if (fs.existsSync(versionFile) && fs.existsSync(binPath) && fs.readFileSync(versionFile, 'utf-8').trim() === ver) {
    console.log(`[prepare-claude] 已就位：${key} ${ver}（跳过）`);
    return binPath;
  }

  const pkgName = `@anthropic-ai/claude-code-${key}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-claude-'));
  try {
    console.log(`[prepare-claude] npm pack ${pkgName}@${ver} ...`);
    const out = execSync(`npm pack ${pkgName}@${ver} --silent`, { cwd: tmp, encoding: 'utf-8', timeout: 600_000 })
      .trim().split(/\r?\n/).pop();
    const tarball = path.join(tmp, out);
    execSync(`tar -xzf "${tarball}"`, { cwd: tmp, timeout: 300_000 });
    const staged = path.join(tmp, 'package', bin);
    if (!fs.existsSync(staged)) throw new Error(`解包后没有 package/${bin}——平台包结构变了？`);

    // 先清后放，最后写 VERSION——VERSION 是"完整就位"的见证，半截解包不会带着它。
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(staged, binPath);
    if (plat !== 'win32') fs.chmodSync(binPath, 0o755); // 打包机不在这补,客户机(只读资源区)就补不了了
    fs.writeFileSync(versionFile, `${ver}\n`);
    console.log(`[prepare-claude] 完成：${binPath}（${ver}）`);
    return binPath;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) prepareClaude();
module.exports = { prepareClaude };
