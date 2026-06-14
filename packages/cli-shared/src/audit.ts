/**
 * audit.ts — 审计日志(可观测)
 *
 * 对照竞品 MACS 的事件溯源。但走轻量路线:
 * - JSONL 追加写(单文件, 无数据库依赖)
 * - 每个项目独立一份 audit.log(隔离)
 * - 只记关键事件: lock / unlock / block / restore / force-delete / trust-change
 *
 * 文件位置: ~/.fileguard/projects/<hash>/audit.log
 * 格式: 每行一个 JSON, 字段:
 *   { ts, event, filePath, relPath, operator, agent, trust, detail }
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProjectDir } from './paths';
import { AgentKind } from './types';

export type AuditEvent =
  | 'lock'
  | 'unlock'
  | 'block'
  | 'restore'
  | 'force-delete'
  | 'restore-failed'
  | 'trust-change'
  | 'expire';

export interface AuditEntry {
  /** ISO 时间戳 */
  ts: string;
  /** 事件类型 */
  event: AuditEvent;
  /** 绝对路径(标准化) */
  filePath: string;
  /** 项目相对路径(展示用, 可选) */
  relPath?: string;
  /** 操作发起方 */
  operator: string;
  /** 工具类型 */
  agent?: AgentKind;
  /** 该 agent 的信任等级(便于事后审计) */
  trust?: TrustLevel;
  /** 额外细节 */
  detail?: string;
}

export type TrustLevel = 'trusted' | 'normal' | 'untrusted' | 'unknown';

/** 单例 logger 缓存(按 projectRoot), 避免频繁开关 fd */
const loggers = new Map<string, AuditLogger>();

export class AuditLogger {
  private logPath: string;

  private constructor(projectRoot: string) {
    this.logPath = path.join(getProjectDir(projectRoot), 'audit.log');
  }

  /** 获取/创建某项目的 logger */
  static for(projectRoot: string): AuditLogger {
    let l = loggers.get(projectRoot);
    if (!l) {
      l = new AuditLogger(projectRoot);
      loggers.set(projectRoot, l);
    }
    return l;
  }

  /** 写一条审计记录 */
  log(entry: Omit<AuditEntry, 'ts'>): void {
    const full: AuditEntry = {
      ts: new Date().toISOString(),
      ...entry,
    };
    const line = JSON.stringify(full) + '\n';
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      fs.appendFileSync(this.logPath, line, 'utf8');
    } catch {
      // 日志写失败不应影响主流程(锁/拦截仍要工作)
    }
  }

  /** 读最近 N 条(默认 100) */
  recent(limit = 100): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];
      const raw = fs.readFileSync(this.logPath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const tail = lines.slice(-limit);
      const entries: AuditEntry[] = [];
      for (const line of tail) {
        try { entries.push(JSON.parse(line) as AuditEntry); } catch { /* 跳过坏行 */ }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /** 按事件类型过滤 */
  filter(event: AuditEvent, limit = 100): AuditEntry[] {
    return this.recent(limit * 4).filter(e => e.event === event).slice(-limit);
  }

  /** 清空(慎用, 仅 fg audit clear 调用) */
  clear(): void {
    try { fs.writeFileSync(this.logPath, '', 'utf8'); } catch { /* ignore */ }
  }

  /** 日志文件路径(展示用) */
  getPath(): string {
    return this.logPath;
  }
}

/** 便捷: 不持有 projectRoot 时也能记一条(从文件反查) */
export function logForFile(entry: Omit<AuditEntry, 'ts'> & { filePath: string }): void {
  // 复用 paths 的 findProjectRoot
  const { findProjectRoot } = require('./paths') as typeof import('./paths');
  const root = findProjectRoot(entry.filePath);
  if (!root) return;
  AuditLogger.for(root).log(entry);
}
