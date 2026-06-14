# @fileguard/cli-shared

FileGuard 的核心库 —— 全局锁注册表 + 公共 API + `fg` 命令行。所有其它包（vscode-ext / fs-watchdog / claude-hook / codex-hook）都依赖它。

## 全局锁表布局

```
~/.fileguard/
  └─ projects/<sha1(projectRoot)[0:12]>/
       ├─ locks.json     ← 该项目所有锁(权威源)
       └─ backups/       ← watchdog 删前备份
```

按项目 hash 分桶 —— 不同项目的同名文件（如 `src/index.ts`）互不干扰。

## API

```typescript
import { LockStore, findProjectRoot, backupFile, restoreFile } from '@fileguard/cli-shared';

// 写锁
const store = new LockStore('/path/to/project');
store.lock('/abs/file.ts', {
  operator: 'my-tool',
  agent: 'claude',
  source: LockSource.EXPLICIT,
  desc: '正在重构',
});

// 查锁
const record = store.get('/abs/file.ts');  // FileRecord | undefined
const locked = store.isLocked('/abs/file.ts');

// 释放
store.release('/abs/file.ts');
store.releaseByOwner('my-extension-id', 'window-1');

// 恢复(watchdog 用)
const r = restoreFile('/path/to/project', '/abs/file.ts');
// → { ok: true, method: 'git checkout' | 'backup snapshot' | 'no source available' }
```

## `fg` 命令

```bash
fg lock <file> [--operator X] [--agent cli] [--desc "..."]
fg unlock <file>
fg list [projectRoot]
fg check <file>            # ★ hook 关键命令
                           #   exit 0 = 可删
                           #   exit 1 = 锁定(stderr 给原因)
fg release-all <projectRoot> [--operator X]
fg cleanup [projectRoot]
```

## 构建

```bash
npm run build       # tsc -p ./  → out/
npm run type-check  # tsc --noEmit
```
