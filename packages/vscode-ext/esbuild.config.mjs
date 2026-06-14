/**
 * esbuild 配置 — 把 vscode-ext + @fileguard/cli-shared 打成单文件
 *
 * 解决问题: vsce --no-dependencies 打的 vsix 不含 cli-shared,
 * VS Code 装扩展时无法从 npm 解析 workspace 包, 导致激活崩溃。
 * esbuild bundle 后, out/extension.js 自包含所有依赖, vsix 独立可用。
 *
 * 注意:
 * - vscode 模块标记 external(由 VS Code 运行时提供, 不打包)
 * - 产物单文件, 体积小, 加载快
 */

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'out/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  // 保留 vscode API 的动态 require(运行时注入)
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
};

if (production) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
}
