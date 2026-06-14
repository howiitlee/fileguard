/**
 * LockStore — 全局锁注册表的核心读写层
 *
 * 这是所有包共用的唯一数据源:
 * - vscode-ext 通过它写"打开的文档锁"
 * - claude/codex hook 通过它查"能不能删"
 * - fs-watchdog 通过它判断"被删文件是否锁定"
 *
 * 设计:
 * - 数据持久在 ~/.fileguard/projects/<hash>/locks.json
 * - 进程内 Map 做缓存, 写操作同步落盘
 * - 文件级 mutex(同项目写时用 .lock 文件, 防止并发损坏)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AgentKind,
  DEFAULT_TTL_MS,
  FileOperateType,
  FileRecord,
  LockFile,
  LockSource,
} from './types';
import {
  getLocksFile,
  getProjectDir,
  normalizePath,
} from './paths';
import { AuditLogger, TrustLevel } from './audit';
import { getAgentTrust } from './agentTrust';

export interface ReportOptions {
  operator: string;
  agent: AgentKind;
  source?: LockSource;
  extensionId?: string;
  windowId?: string;
  desc?: string;
  relPath?: string;
}

export class LockStore {
  private locks = new Map<string, FileRecord>();
  private loaded = false;

  constructor(private projectRoot: string) {}

  // ────────────────────────────────────────────────
  // 加载/落盘
  // ────────────────────────────────────────────────

  /** 从磁盘加载(惰性, 首次访问时自动触发) */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const file = getLocksFile(this.projectRoot);
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw) as LockFile;
        const map = data.locks || {};
        const now = Date.now();
        for (const [k, v] of Object.entries(map)) {
          // 回载顺手清过期
          if (now - (v.timestamp || 0) < DEFAULT_TTL_MS) {
            this.locks.set(normalizePath(k), v);
          }
        }
      }
    } catch {
      // 损坏的 JSON — 当作空表, 不抛(防止单点故障)
      this.locks.clear();
    }
  }

  /** 落盘 */
  private persist(): void {
    const file = getLocksFile(this.projectRoot);
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });

    const locksObj: Record<string, FileRecord> = {};
    for (const [k, v] of this.locks) locksObj[k] = v;

    const data: LockFile = {
      version: 1,
      projectRoot: normalizePath(this.projectRoot),
      projectHash: '', // 由 paths 层填, 这里留空
      updatedAt: Date.now(),
      locks: locksObj,
    };

    // 原子写: 写临时文件再 rename(防写一半崩溃)
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  // ────────────────────────────────────────────────
  // 读写 API
  // ────────────────────────────────────────────────

  /** 上报/更新一条锁; RELEASE 等价删除 */
  report(filePath: string, opts: ReportOptions): FileRecord {
    this.ensureLoaded();
    const key = normalizePath(filePath);

    const record: FileRecord = {
      filePath: key,
      relPath: opts.relPath,
      operateType: FileOperateType.COMPLETE,
      operator: opts.operator,
      source: opts.source ?? LockSource.REMOTE,
      agent: opts.agent,
      extensionId: opts.extensionId,
      windowId: opts.windowId,
      desc: opts.desc,
      timestamp: Date.now(),
    };

    this.locks.set(key, record);
    this.persist();
    // 审计: 记录 lock 事件
    AuditLogger.for(this.projectRoot).log({
      event: 'lock',
      filePath: key,
      relPath: opts.relPath,
      operator: opts.operator,
      agent: opts.agent,
      trust: getAgentTrust().get(opts.operator),
      detail: opts.desc,
    });
    // 顺带登记这个 agent(便于信任管理)
    getAgentTrust().observe(opts.operator);
    return record;
  }

  /** 显式锁 */
  lock(filePath: string, opts: ReportOptions): FileRecord {
    return this.report(filePath, { ...opts, source: opts.source ?? LockSource.EXPLICIT });
  }

  /** 释放单文件 */
  release(filePath: string, byOperator?: string): boolean {
    this.ensureLoaded();
    const key = normalizePath(filePath);
    const existing = this.locks.get(key);
    const had = this.locks.delete(key);
    if (had) {
      this.persist();
      AuditLogger.for(this.projectRoot).log({
        event: 'unlock',
        filePath: key,
        relPath: existing?.relPath,
        operator: byOperator || existing?.operator || 'unknown',
        agent: existing?.agent,
        trust: byOperator ? getAgentTrust().get(byOperator) : existing?.operator ? getAgentTrust().get(existing.operator) : undefined,
        detail: byOperator && existing && byOperator !== existing.operator ? `${byOperator} 释放了 ${existing.operator} 的锁` : '正常释放',
      });
    }
    return had;
  }

  /** 释放本 owner(windowId 或 extensionId 匹配)的全部 */
  releaseByOwner(extensionId?: string, windowId?: string): number {
    this.ensureLoaded();
    let n = 0;
    for (const [k, v] of this.locks) {
      const mine =
        (extensionId && v.extensionId === extensionId) ||
        (windowId && v.windowId === windowId);
      if (mine) {
        this.locks.delete(k);
        n++;
      }
    }
    if (n > 0) this.persist();
    return n;
  }

  /** 查询 */
  get(filePath: string): FileRecord | undefined {
    this.ensureLoaded();
    return this.locks.get(normalizePath(filePath));
  }

  /** 是否锁定 */
  isLocked(filePath: string): boolean {
    this.ensureLoaded();
    return this.locks.has(normalizePath(filePath));
  }

  /** 全部锁(快照) */
  all(): FileRecord[] {
    this.ensureLoaded();
    return Array.from(this.locks.values());
  }

  /** 清理过期 */
  cleanup(ttlMs: number = DEFAULT_TTL_MS): number {
    this.ensureLoaded();
    const now = Date.now();
    let n = 0;
    for (const [k, v] of this.locks) {
      if (now - (v.timestamp || 0) > ttlMs) {
        this.locks.delete(k);
        n++;
      }
    }
    if (n > 0) this.persist();
    return n;
  }

  /** 持久化目录(供 watchdog 用) */
  getProjectDir(): string {
    return getProjectDir(this.projectRoot);
  }

  /**
   * 决策: agent 想删 filePath, 是否允许? (信任分级核心)
   *
   * 返回:
   *   { allow: true }  → 没锁, 或 agent 是 trusted, 可删
   *   { allow: false, reason, owner, trust } → 拦截, 给出原因
   *
   * 副作用: 拦截时写 'block' 审计日志
   */
  checkDelete(filePath: string, agentName: string): {
    allow: boolean;
    reason?: string;
    owner?: string;
    trust?: TrustLevel;
  } {
    this.ensureLoaded();
    const key = normalizePath(filePath);
    const record = this.locks.get(key);

    // 没锁 → 放行
    if (!record) return { allow: true };

    // 有锁 → 走信任决策
    const decision = getAgentTrust().decideDelete(agentName, record.operator);

    if (!decision.allow) {
      // 拦截 → 写审计
      AuditLogger.for(this.projectRoot).log({
        event: 'block',
        filePath: key,
        relPath: record.relPath,
        operator: agentName,
        agent: record.agent,
        trust: decision.trust,
        detail: `尝试删除 ${record.operator} 锁定的文件。${decision.reason}`,
      });
    }

    return {
      allow: decision.allow,
      reason: decision.reason,
      owner: record.operator,
      trust: decision.trust,
    };
  }
}

/** 便捷工厂: 从文件路径反查项目根, 返回对应 LockStore */
export function createStoreForFile(filePath: string): { store: LockStore; projectRoot: string } | null {
  // 用 paths.findProjectRoot
  // 放这里避免循环 import
  const { findProjectRoot } = require('./paths') as typeof import('./paths');
  const root = findProjectRoot(filePath);
  if (!root) return null;
  return { store: new LockStore(root), projectRoot: root };
}
