# FileGuard 🛡️

> **跨工具防误删守卫** — VS Code 扩展 + Claude Code / Codex / ZCode 等 AI agent 的删除拦截 + 文件系统兜底恢复

当多个 AI 编码工具（VS Code 扩展、Claude Code、Codex、ZCode、其它 CLI agent）同时给同一个项目写代码时，一个工具很容易把另一个工具正在用的文件删掉。**FileGuard 解决的就是这个问题。**

通用版，对任何项目、任何工具适用。

## 为什么需要它

| 已有的文件保护扩展 | 它们解决什么 | 它们的盲区 |
|------|------|------|
| [Directory Lock](https://marketplace.visualstudio.com/items?itemName=shamantao.dirlock) | 静态保护某些固定文件 | 不支持动态、跨工具占用 |
| [lock-file-vscode-plugin](https://marketplace.visualstudio.com/items?itemName=JasonZhang155.lock-file-vscode-plugin) | 配置白名单文件 | 偏静态配置 |

**FileGuard 的差异化**：解决"多个 AI 工具**动态**协同改同一项目"——Claude Code 正在改 `recommendation.ts`，Codex 同时来删它，FileGuard 拦住。

## 架构

```
~/.fileguard/                                  ← 全局锁注册表(不污染项目)
  └─ projects/<projectHash>/
       ├─ locks.json                           ← 该项目的锁(权威源)
       └─ backups/<sanitized>.bak              ← watchdog 备份快照

D:\fileguard\                                  ← 本仓库
  ├─ packages\cli-shared\   核心库 + fg 命令   ← 所有包的依赖
  ├─ packages\vscode-ext\   VS Code 扩展       ← 锁打开的文档 + 拦 IDE 删
  ├─ packages\fs-watchdog\  兜底守护进程       ← 监听删除 + 自动恢复
  ├─ packages\claude-hook\  Claude Code 集成   ← PreToolUse 拦截
  ├─ packages\codex-hook\   Codex CLI 集成     ← /hooks 拦截
  └─ tests\                 端到端测试样例
```

### 数据流

```
       ┌─────────────────────────────────────────────────────────┐
       │   ~/.fileguard/projects/<hash>/locks.json  (权威源)     │
       └───────┬──────────────┬──────────────┬──────────────┬────┘
               │              │              │              │
        ┌──────▼─────┐  ┌─────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
        │ vscode-ext │  │claude-hook │ │ codex-hook │ │fs-watchdog │
        │ (写锁+拦删)│  │(删前查表)  │ │(删前查表)  │ │(删后恢复)  │
        └────────────┘  └────────────┘ └────────────┘ └────────────┘
```

## 各工具的拦截能力（诚实对照）

| 工具 | 拦截方式 | 拦得住? | 说明 |
|------|---------|--------|------|
| **VS Code / Cursor / MIMO** | `onWillDeleteFiles` | ✅ 真拦 | vscode-ext |
| **Claude Code** | `PreToolUse` + exit 2 | ✅ 真拦 | claude-hook |
| **Codex CLI** | `/hooks`(feature-flag,仅 Bash) | ⚠️ 部分 | codex-hook |
| **ZCode** | OpenCode 框架(入口待开放) | ⚠️ 暂无 | 靠 watchdog 兜底 |
| **任意其它工具** | — | ❌ 拦不住 | **watchdog 必中** |

**核心保证**：fs-watchdog 对**所有**工具都有效——即使前置 hook 漏了，删除发生后秒级恢复（git 优先，备份兜底）。

## 📦 安装 VS Code 扩展

> **推荐**：直接从 Release 下载 vsix 安装（无需自己编译）。

1. 下载 [vscode-file-guard-1.0.0.vsix](https://github.com/howiitlee/fileguard/releases/download/v1.0.0/vscode-file-guard-1.0.0.vsix)
2. 安装：
   ```bash
   code --install-extension vscode-file-guard-1.0.0.vsix
   ```
   或 VS Code 里 `Ctrl+Shift+P` → `Extensions: Install from VSIX` → 选下载的文件

> 注：扩展会自动拉起锁机制。CLI 工具（`fg` 命令）、watchdog、hooks 仍需从源码编译（见下方"快速开始"）。

## 快速开始

### 1. 编译所有包

```bash
cd D:\fileguard
npm install
npm run build
```

### 2. 装 VS Code 扩展

```bash
cd packages\vscode-ext
npm run package          # 生成 .vsix
code --install-extension vscode-file-guard-1.0.0.vsix
```

### 3. 启动 watchdog（兜底，对所有工具有效）

```bash
cd packages\fs-watchdog
npm start                # 前台运行, 监控当前目录
node out/install.js install D:\GAOKAO-AI D:\other-project   # 注册开机自启
```

### 4. 给 AI agent 装 hook（可选，按需）

```bash
# Claude Code
node packages\claude-hook\install.js            # 全局
node packages\claude-hook\install.js --project  # 仅当前项目

# Codex CLI
node packages\codex-hook\install.js
```

## 命令行 `fg`

```bash
fg lock <file> [--operator X] [--agent cli] [--desc "..."]
fg unlock <file>
fg list [projectRoot]
fg check <file>            # exit 0 可删 / exit 1 锁定 (hook 用)
fg release-all <projectRoot> [--operator X]
fg cleanup [projectRoot]
```

## 配置

锁表全局存在 `~/.fileguard/`，**不污染项目目录**（无需 .gitignore）。每个项目按 `sha1(projectRoot)` 前 12 位分桶。

## 端到端验证（已通过）

```bash
chcp 65001                       # 切 UTF-8 代码页(避免中文乱码)
node tests\e2e-test.js           # fg 锁/查/拦截  5/5 PASS
node tests\e2e-hook.js           # claude/codex hook 拦截  6/6 PASS
node tests\e2e-watchdog.js       # watchdog 恢复  PASS (秒级)
```

## 关键设计决策

1. **锁表全局而非项目内** — 不污染 git 历史，单 watchdog 管多项目
2. **watchdog 立即恢复而非弹窗确认** — 删除已发生就该果断恢复，避免通知阻塞监听（曾踩坑：阻塞版卡 30 秒）
3. **git 优先 + 备份兜底** — 恢复时先用 `git checkout`（最可靠），无 git 才用备份快照
4. **双写桥接** — vscode-ext 内部 workspaceState 缓存(性能) + 同步磁盘表(跨工具可见)

## 与 Git Worktree 的关系

不是替代，是互补：
- **Git Worktree**：多 AI 做**独立任务**，物理隔离根本不会误删（更稳，零开销）
- **FileGuard**：多 AI **协同改同一项目**，要实时共享，靠动态锁 + 拦截 + 兜底

## License

MIT
