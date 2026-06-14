# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-14

### Added
- 从 GAOKAO-AI 项目独立成通用 VS Code 扩展（原 `src/collaboration/`）
- 🛡️ **核心新增：删除拦截**（`onWillDeleteFiles` + `e.waitUntil(reject)`），阻断资源管理器/命令行删除，弹窗告知占用方，支持"强制删除"
- 🔒 **自动锁**：打开（含脏文档）自动锁定，无需手动
- ♻️ **自动释放**：文档关闭 / 扩展 `deactivate` 时释放对应自动锁
- 📊 **状态栏指示器**：实时显示锁数量，点击查看清单
- 📋 **命令面板完整注册**：`fileguard.lock/unlock/unlockAll/list/toggleAutoGuard`
- ⚙️ **配置项**：`autoGuard` / `guardDirtyOnly` / `ttlHours` / `silent` / `interceptDelete` / `ownExtensionIds`
- 📡 **跨扩展广播**：`fileguard._broadcast` / `_query`，去重合并所有扩展的锁

### Fixed
- 内存版锁重启即丢 → 统一 `workspaceState` 持久化 + 内存缓存
- 无 `deactivate()` → 加 `deactivate()` 释放本窗口自动锁
- Webview `postMessage` 拿不到返回值 → requestId + Promise + 超时模式
- 命令未在 `package.json contributes.commands` 注册 → 完整 manifest
- 命令前缀 `gaokao-ai.*` 硬编码业务 → 全改通用 `fileguard.*`

### Changed
- 部署位置：`D:\GAOKAO-AI\src\collaboration\` → 独立项目 `D:\vscode-file-guard\`
- 移动 App 的 `src/` 不再污染 IDE 扩展代码
