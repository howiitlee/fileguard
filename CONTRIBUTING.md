# 贡献指南

感谢你对 FileGuard 的兴趣！本文档说明如何参与贡献。

## 开发环境

```bash
git clone https://github.com/howiitlee/fileguard.git
cd fileguard
npm install        # 安装所有 workspace 依赖
npm run build      # 编译所有包
npm run type-check # 类型检查(零 error 是硬要求)
```

## 项目结构

- `packages/cli-shared` — 核心库(锁表 + fg 命令 + 审计 + 信任)
- `packages/vscode-ext` — VS Code 扩展
- `packages/fs-watchdog` — 文件系统兜底守护进程
- `packages/claude-hook` — Claude Code PreToolUse 脚本(纯 JS)
- `packages/codex-hook` — Codex CLI hook 脚本(纯 JS)
- `tests/` — 端到端测试(自包含, 用临时项目)

## 开发铁律

1. **类型检查零 error** — 改完任何 .ts 必须 `npm run type-check` 全绿
2. **不用 PowerShell 改 .ts/.tsx** — 中文会损坏。用编辑器或 `node` 脚本(encoding=utf-8)
3. **e2e 测试必须自包含** — 用 `os.tmpdir()` + 自清理, 不依赖外部固定路径
4. **不引入 `as any`** — 逃逸类型检查是技术债
5. **新增功能配测试** — 在 `tests/` 加对应 e2e 用例

## 测试

```bash
chcp 65001                        # Windows 切 UTF-8 代码页(避免中文乱码)
node tests/e2e-test.js            # fg 命令核心
node tests/e2e-hook.js            # claude/codex hook 拦截
node tests/e2e-trust.js           # 信任分级 + 审计日志
```

全 PASS 才能提交。

## 提交规范

- 用中文或英文皆可, 描述清楚改了什么、为什么
- 不 `--no-verify` 跳过 hooks
- 一个 PR 聚焦一件事

## 报告问题

- Bug 请附: 复现步骤、`fg log` 输出、平台/Node 版本
- 功能建议请说明使用场景

## License

贡献即意味着你同意以 MIT 协议发布你的代码。
