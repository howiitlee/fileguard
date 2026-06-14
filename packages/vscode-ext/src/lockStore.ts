/**
 * vscode-ext 的锁存储 — 双写桥接
 *
 * 数据流:
 *   ┌─ cli-shared LockStore(磁盘 ~/.fileguard/projects/<hash>/locks.json) ─┐
 *   │                       ← 权威源, 所有工具看这个                         │
 *   └──────────────────────────────┬─────────────────────────────────────────┘
 *                                  │ 双向同步
 *   ┌──────────────────────────────▼─────────────────────────────────────────┐
 *   │ workspaceState 缓存(启动加速) + 内存 Map(运行时查询)                   │
 *   │ ← 只为 VS Code 进程内的快速查询, 不对外                                  │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * 写: 同时写磁盘(权威) + workspaceState(缓存) + 内存
 * 读: 优先内存; 查"跨工具锁"时回磁盘
 *
 * 这样 Claude Code / Codex / fs-watchdog 都能看到 VS Code 锁的文件。
 */

import * as vscode from 'vscode';
import {
  FileOperateType,
  FileRecord,
  LockSource,
  STATE_KEY_LOCK_LIST,
  DEFAULT_TTL_MS,
} from './types';
import {
  LockStore as DiskStore,
  AgentKind,
  FileOperateType as DiskOperateType,
  FileRecord as DiskRecord,
  LockSource as DiskSource,
  findProjectRoot,
} from '@fileguard/cli-shared';

const HOUR_MS = 60 * 60 * 1000;

/** 标准化路径：统一大小写、统一正斜杠、绝对路径 */
export function normalizePath(uri: vscode.Uri | string): string {
  const fsPath = typeof uri === 'string' ? uri : uri.fsPath;
  const normalized = fsPath.replace(/\\/g, '/');
  return normalized.replace(/^([A-Z]):/, (_m, d) => d.toLowerCase() + ':');
}

/** 把 vscode-ext 的 FileRecord 转成 cli-shared 的 DiskRecord */
function toDiskRecord(r: FileRecord, agent: AgentKind = 'vscode'): DiskRecord {
  return {
    filePath: r.filePath,
    relPath: r.relPath,
    operateType: r.operateType as unknown as DiskOperateType,
    operator: r.operator,
    source: r.source as unknown as DiskSource,
    agent,
    extensionId: r.extensionId,
    windowId: r.windowId,
    desc: r.desc,
    timestamp: r.timestamp,
  };
}

export class LockStore {
  private locks = new Map<string, FileRecord>();
  private onChangeEmitter = new vscode.EventEmitter<void>();
  /** 锁变更事件（statusBar 等监听） */
  readonly onChange = this.onChangeEmitter.event;
  /** 磁盘 store 缓存(按 projectRoot 分桶, 惰性创建) */
  private diskStores = new Map<string, DiskStore>();

  constructor(private context: vscode.ExtensionContext) {
    this.load();
  }

  // ────────────────────────────────────────────────
  // 磁盘桥
  // ────────────────────────────────────────────────

  /** 获取/创建某文件对应的磁盘 store */
  private getDiskStore(filePath: string): DiskStore | null {
    const root = findProjectRoot(filePath);
    if (!root) return null; // 不属于受保护项目
    let s = this.diskStores.get(root);
    if (!s) {
      s = new DiskStore(root);
      this.diskStores.set(root, s);
    }
    return s;
  }

  // ────────────────────────────────────────────────
  // 持久化(双写)
  // ────────────────────────────────────────────────

  /** 从 workspaceState 回载(启动加速) */
  private load(): void {
    const list = this.context.workspaceState.get<FileRecord[]>(STATE_KEY_LOCK_LIST) || [];
    this.locks.clear();
    for (const r of list) {
      if (Date.now() - (r.timestamp || 0) < DEFAULT_TTL_MS) {
        this.locks.set(r.filePath, r);
      }
    }
  }

  /** 同步到 workspaceState(缓存) + 内存已就地 + 磁盘(权威) */
  private persist(record?: FileRecord): void {
    // workspaceState 缓存: 写整张表
    const list = Array.from(this.locks.values());
    void this.context.workspaceState.update(STATE_KEY_LOCK_LIST, list);

    // 磁盘权威源: 只写变更的那一条
    if (record) {
      const disk = this.getDiskStore(record.filePath);
      if (disk) {
        if (record.operateType === FileOperateType.RELEASE) {
          disk.release(record.filePath);
        } else {
          disk.report(record.filePath, {
            operator: record.operator,
            agent: 'vscode',
            source: record.source as unknown as DiskSource,
            extensionId: record.extensionId,
            windowId: record.windowId,
            desc: record.desc,
            relPath: record.relPath,
          });
        }
      }
    }

    this.onChangeEmitter.fire();
  }

  // ────────────────────────────────────────────────
  // 读写
  // ────────────────────────────────────────────────

  /** 上报 / 更新一条锁。RELEASE 等价于删除。 */
  report(record: FileRecord): void {
    const key = normalizePath(record.filePath);
    if (record.operateType === FileOperateType.RELEASE) {
      this.locks.delete(key);
    } else {
      this.locks.set(key, { ...record, filePath: key, timestamp: Date.now() });
    }
    this.persist({ ...record, filePath: key });
  }

  /** 显式锁定 */
  lock(
    filePath: string,
    operator: string,
    opts: {
      source?: LockSource;
      extensionId?: string;
      windowId?: string;
      desc?: string;
    } = {}
  ): FileRecord {
    const record: FileRecord = {
      filePath: normalizePath(filePath),
      operateType: FileOperateType.COMPLETE,
      operator,
      source: opts.source ?? LockSource.EXPLICIT,
      extensionId: opts.extensionId,
      windowId: opts.windowId,
      desc: opts.desc,
      timestamp: Date.now(),
    };
    this.report(record);
    return record;
  }

  /** 解锁单文件 */
  unlock(filePath: string): boolean {
    const key = normalizePath(filePath);
    const had = this.locks.has(key);
    if (had) {
      this.locks.delete(key);
      // 释放也写磁盘
      this.persist({
        filePath: key,
        operateType: FileOperateType.RELEASE,
        operator: '',
        source: LockSource.EXPLICIT,
        timestamp: Date.now(),
      });
    }
    return had;
  }

  /** 解锁本窗口（同 windowId 或同 extensionId + source=auto）的全部 */
  unlockByOwner(extensionId: string, windowId?: string): number {
    let removed = 0;
    const toRemove: FileRecord[] = [];
    for (const [key, r] of this.locks) {
      const mine =
        r.extensionId === extensionId &&
        (windowId ? r.windowId === windowId || r.source === LockSource.AUTO_OPEN || r.source === LockSource.AUTO_DIRTY : true);
      if (mine) {
        toRemove.push(r);
        this.locks.delete(key);
        removed++;
      }
    }
    // 逐条同步到磁盘
    for (const r of toRemove) {
      this.persist({ ...r, operateType: FileOperateType.RELEASE });
    }
    if (removed > 0) {
      void this.context.workspaceState.update(STATE_KEY_LOCK_LIST, Array.from(this.locks.values()));
    }
    return removed;
  }

  /**
   * 查询单文件锁
   * 优先内存; 如内存没有, 回磁盘查(其它工具可能锁了它)
   */
  get(filePath: string): FileRecord | undefined {
    const key = normalizePath(filePath);
    const mem = this.locks.get(key);
    if (mem) return mem;
    // 回磁盘查(其它工具锁的)
    const disk = this.getDiskStore(filePath);
    if (disk) {
      const dr = disk.get(filePath);
      if (dr) {
        // 转回 vscode-ext FileRecord(不带 agent 字段, 但可读)
        const r: FileRecord = {
          filePath: dr.filePath,
          relPath: dr.relPath,
          operateType: dr.operateType as unknown as FileOperateType,
          operator: `${dr.operator} (${dr.agent})`,
          source: dr.source as unknown as LockSource,
          extensionId: dr.extensionId,
          windowId: dr.windowId,
          desc: dr.desc,
          timestamp: dr.timestamp,
        };
        return r;
      }
    }
    return undefined;
  }

  isLocked(filePath: string): boolean {
    return this.get(filePath) !== undefined;
  }

  /**
   * 列出所有锁
   * 合并本扩展内存锁 + 各磁盘项目的锁
   */
  all(): FileRecord[] {
    const result = new Map<string, FileRecord>();
    // 内存锁
    for (const [k, v] of this.locks) result.set(k, v);
    // 各磁盘项目锁(补齐跨工具的)
    for (const [, disk] of this.diskStores) {
      for (const dr of disk.all()) {
        if (!result.has(dr.filePath)) {
          result.set(dr.filePath, {
            filePath: dr.filePath,
            relPath: dr.relPath,
            operateType: dr.operateType as unknown as FileOperateType,
            operator: `${dr.operator} (${dr.agent})`,
            source: dr.source as unknown as LockSource,
            extensionId: dr.extensionId,
            windowId: dr.windowId,
            desc: dr.desc,
            timestamp: dr.timestamp,
          });
        }
      }
    }
    return Array.from(result.values());
  }

  // ────────────────────────────────────────────────
  // 维护
  // ────────────────────────────────────────────────

  /** 清理过期锁 */
  cleanup(ttlMs: number = DEFAULT_TTL_MS): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, r] of this.locks) {
      if (now - (r.timestamp || 0) > ttlMs) {
        this.locks.delete(key);
        removed++;
      }
    }
    // 磁盘清理
    for (const [, disk] of this.diskStores) {
      removed += disk.cleanup(ttlMs);
    }
    if (removed > 0) {
      void this.context.workspaceState.update(STATE_KEY_LOCK_LIST, Array.from(this.locks.values()));
      this.onChangeEmitter.fire();
    }
    return removed;
  }

  /** 启动定时清理（返回 disposable） */
  startCleanupTimer(ttlHours: number): vscode.Disposable {
    const interval = setInterval(() => this.cleanup(ttlHours * HOUR_MS), HOUR_MS);
    return { dispose: () => clearInterval(interval) };
  }

  dispose(): void {
    this.onChangeEmitter.dispose();
  }
}

/** 导出 cli-shared 类型转换工具(供其它模块用) */
export { toDiskRecord };
