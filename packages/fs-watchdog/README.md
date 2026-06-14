# @fileguard/fs-watchdog

FileGuard 的文件系统兜底守护进程 —— 对**所有**工具（含无法装 hook 的）都有效的最后防线。

## 工作原理（诚实说明）

chokidar 的 `unlink` 是"文件已删"的**事后**事件，无法真正阻止删除。
所以 watchdog 的策略是：**检测到锁定文件被删 → 立即恢复**。

设计权衡：
- 前置 hook（claude/codex/vscode）已经给了"删前拦截"的机会
- 到了 watchdog 这层说明删除已经发生 → 应果断恢复，避免数据丢失
- 通知是**非阻塞**的（异步 spawn），告知用户"已自动恢复，如确实要删请先 `fg unlock`"

## 恢复优先级

1. **git checkout**（最可靠，能恢复完整历史）—— 项目是 git 仓库 + 文件被 tracked
2. **备份快照**（`~/.fileguard/projects/<hash>/backups/`）—— 文件被锁时自动备份
3. 都没有 → 通知用户手动恢复

## 使用

```bash
# 前台运行(监控当前目录)
npm start

# 监控多个项目
node out/main.js D:\GAOKAO-AI D:\other-project

# 注册开机自启
node out/install.js install D:\GAOKAO-AI D:\other-project
# 卸载
node out/install.js uninstall
```

## 系统集成

| 平台 | 自启机制 |
|------|---------|
| Windows | 启动文件夹放 `.vbs`（静默启动，不弹黑窗） |
| macOS | `~/Library/LaunchAgents/com.fileguard.watchdog.plist` |
| Linux | `~/.config/systemd/user/fileguard-watchdog.service` |

## 忽略的目录

默认不监控（避免噪音）：
- `node_modules/` `.git/objects/` `out/` `dist/` `.fileguard/`

## 验证

```bash
chcp 65001
node ../../tests/e2e-watchdog.js   # 应 PASS, 秒级恢复
```
