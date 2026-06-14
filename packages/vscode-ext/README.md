# File Guard 🛡️

> **防止多窗口/多扩展为同一项目开发时误删文件的 VS Code 扩展**

当多个 VS Code 窗口、多个扩展（AI 编码助手、自动化工具等）同时给同一个项目写代码时，一个窗口很容易把另一个窗口正在用的文件删掉。File Guard 解决的就是这个问题——**自动锁定 + 自动拦截删除 + 跨窗口跨扩展广播**。

适用任何项目，与具体业务无关。

---

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| 🔒 **自动锁** | 在当前窗口打开（尤其有未保存修改）的文件自动上锁 |
| 🚧 **拦截删** | 监听 `onWillDeleteFiles`，命中锁的删除操作被阻断 + 弹窗告知占用方 |
| 📡 **跨扩展广播** | 通过 `fileguard._broadcast` 命令向其它装了 File Guard 的扩展广播锁状态 |
| ♻️ **自动释放** | 文档关闭 / 扩展卸载时自动释放对应的自动锁 |
| 🔋 **持久化** | 锁存于 `workspaceState`，重启不丢；24h TTL 自动清理 |
| 📊 **状态栏** | 左下角实时显示锁定数量，点击查看清单 |

---

## 📦 安装

### 方式 1：从源码编译

```bash
git clone <repo> vscode-file-guard
cd vscode-file-guard
npm install
npm run compile
```

然后按 `F5`（VS Code 会以"扩展开发宿主"模式打开新窗口加载本扩展）。

### 方式 2：打包成 vsix

```bash
npm run package   # 生成 vscode-file-guard-1.0.0.vsix
code --install-extension vscode-file-guard-1.0.0.vsix
```

---

## 🎮 命令

打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），输入 `File Guard`：

| 命令 | 作用 |
|------|------|
| `File Guard: 锁定当前文件` | 显式锁定当前编辑的文件 |
| `File Guard: 解锁当前文件` | 解锁当前文件 |
| `File Guard: 解锁本窗口全部文件` | 释放本窗口持有的所有锁 |
| `File Guard: 列出所有锁定文件` | QuickPick 查看全部锁，可打开/强制解锁 |
| `File Guard: 开关自动锁（打开即锁）` | 切换 `fileguard.autoGuard` |

**右键菜单**：在资源管理器文件上右键也能直接 `锁定` / `解锁`。
**编辑器右上角**：当前文件未锁时显示锁图标，已锁时显示解锁图标。

---

## ⚙️ 配置

`文件 → 首选项 → 设置` 搜索 `fileguard`：

| 配置 | 默认 | 说明 |
|------|------|------|
| `fileguard.autoGuard` | `true` | 自动锁定在当前窗口打开的文件 |
| `fileguard.guardDirtyOnly` | `false` | 仅锁定有未保存修改的脏文档 |
| `fileguard.ttlHours` | `24` | 锁的存活时间（小时） |
| `fileguard.silent` | `false` | 静默拦截（不弹窗，仅记日志） |
| `fileguard.interceptDelete` | `true` | 是否拦截删除操作（核心，建议开启） |
| `fileguard.ownExtensionIds` | `[]` | 友军扩展 ID 列表，显示为"友军"而非"其他扩展" |

---

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────┐
│                      extension.ts                        │
│                  activate() / deactivate()               │
└───────┬───────────────────────────────────┬──────────────┘
        │                                   │
        ▼                                   ▼
┌───────────────┐                  ┌──────────────────┐
│   guard.ts    │ 自动锁+拦截删    │ multiExtension   │
│  (核心守卫)   │ ←─ onWillDelete  │ 跨扩展广播       │
└───────┬───────┘                  └────────┬─────────┘
        │                                   │
        ▼                                   ▼
┌───────────────┐                  ┌──────────────────┐
│  lockStore    │ 内存Map+持久化   │   statusBar      │
│  (单一数据源) │ ←─ workspaceState│  状态栏指示      │
└───────────────┘                  └──────────────────┘
        ▲
        │
┌───────┴───────┐
│   commands    │  fileguard.lock / unlock / list ...
│  (命令注册)   │
└───────────────┘
```

**数据流**：
1. 文件打开 → `guard.maybeAutoLock()` → 写 `lockStore` → `statusBar` 刷新
2. `lockStore.report()` 同步到 `workspaceState`（持久化）+ `broadcaster.broadcast()`（跨扩展）
3. 删除文件 → `onWillDelete` 命中锁 → `e.waitUntil(reject)` 阻断 + 弹窗

---

## 🔌 给其它扩展用（编程接口）

如果你在写另一个扩展，想让它的"自动生成文件"被 File Guard 保护：

```typescript
// 在你的扩展里
import * as vscode from 'vscode';

// 上报文件被你占用
await vscode.commands.executeCommand('fileguard._broadcast', {
  msgType: 'fileState',
  source: 'my-extension',
  data: {
    filePath: '/abs/path/to/file.ts',
    operateType: 'complete',
    operator: 'my-extension',
    source: 'remote',
    extensionId: 'my-extension',
    desc: '正在生成',
    timestamp: Date.now(),
  },
});
```

---

## 🧪 验证（开发者）

```bash
npm run type-check   # tsc --noEmit，零 error
npm run compile      # 产出 out/
```

---

## 📜 License

MIT
