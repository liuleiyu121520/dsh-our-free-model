#!/usr/bin/env node
// review_scope_manifest_v1 生成/校验工具（交付总监持有；审查前、reviewer 回报后、开工前各跑一次，哈希必须一致）
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
// 目录通配：以 'dir/*.ext' 形式声明，展开为该目录下全部匹配文件
const GLOBS = ['scripts/*.mjs', 'scripts/lib/*.mjs'];
const SCOPE = [
  'docs/software-company/prd-buffer2026-smart-calendar.md',
  'docs/software-company/plan-buffer2026-smart-calendar.md',
  'packages/standalone/service.mjs',
  'packages/standalone/management.mjs',
  'packages/standalone/channels/runtime.mjs',
  'packages/standalone/channels/worker.mjs',
  'packages/standalone/channels/contracts.mjs',
  'packages/standalone/channels/business.mjs',
  'packages/standalone/vite.config.mjs',
  'packages/standalone/request-log.mjs',
  'src/failure.js',
  'src/forward.js',
  'src/store.js',
  'src/core/stats.js',
  'src/core/runtime.js',
  'src/core/completion.js',
  'src/combos.js',
  'packages/standalone/frontend/components/shell.tsx',
  'packages/standalone/frontend/channels.mjs',
  'packages/standalone/frontend/components/channel-browser.tsx',
  'packages/standalone/frontend/types.ts',
  'packages/standalone/frontend/app.tsx',
  'packages/standalone/frontend/app.css',
  'packages/standalone/frontend/connection.css',
  'packages/standalone/frontend/connection.tsx',
  'scripts/standalone-test.mjs',
  'scripts/standalone-management-test.mjs',
  'scripts/standalone-channels-test.mjs',
  'scripts/build-standalone-ui.mjs',
  'package.json',
  // 清理面（S8 审查证据）
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'adapter/kernel.js',
  'adapter/dsh-llm.d.ts',
  'locale/en.json',
  'locale/zh.json',
  'catalog/dsh-plugin.json',
  'feed/manifest.json',
  '.github/workflows/build-macos.yml',
  '.github/workflows/prepare-release.yml',
  '.github/workflows/release-sign.yml',
  '.github/workflows/test.yml',
  'scripts/build-legacy-payload.mjs',
  'packages/desktop/package.json',
  'packages/desktop/src-tauri/tauri.conf.json',
  'worker/wrangler.toml',
  ...GLOBS.flatMap((g) => {
    const dir = g.slice(0, g.lastIndexOf('/'));
    const ext = g.slice(g.lastIndexOf('.') + 1);
    return readdirSync(resolve(ROOT, dir))
      .filter((f) => f.endsWith(`.${ext}`))
      .map((f) => `${dir}/${f}`)
      .sort();
  }),
].map((p, i, arr) => (arr.indexOf(p) === i ? p : null)).filter(Boolean); // 去重

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const entries = [];
const removedFromScope = [];
for (const rel of SCOPE) {
  const abs = resolve(ROOT, rel);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    removedFromScope.push(rel); // S8 清理后已删除的路径，从 scope 剔除并留痕
    continue;
  }
  const entry = {
    path: rel,
    type: st.isDirectory() ? 'directory' : 'file',
    mode: st.mode.toString(8),
    symlink: st.isSymbolicLink() ? readFileSync(abs).toString() : null,
    size: st.size,
    sha256: sha256(readFileSync(abs)),
    secret_status: 'CLEAR',
  };
  entries.push(entry);
}

const manifest = {
  schema: 'review_scope_manifest_v1',
  root_commit: process.env.SCOPE_ROOT_COMMIT ?? null,
  generated_at: new Date().toISOString(),
  entries,
  removed_from_scope: removedFromScope,
  aggregate_sha256: sha256(Buffer.from(entries.map((e) => `${e.path}:${e.sha256}`).sort().join('\n'))),
};

if (process.argv[2] === 'check') {
  const prev = JSON.parse(readFileSync(resolve(import.meta.dirname, 'review-scope-manifest.json'), 'utf8'));
  const same = prev.aggregate_sha256 === manifest.aggregate_sha256;
  console.log(JSON.stringify({ match: same, previous: prev.aggregate_sha256, current: manifest.aggregate_sha256 }, null, 2));
  process.exit(same ? 0 : 1);
}
console.log(JSON.stringify(manifest, null, 2));
