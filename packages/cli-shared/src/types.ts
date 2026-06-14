/**
 * FileGuard — 核心类型定义
 * 所有包(vscode-ext / fs-watchdog / claude-hook / codex-hook)共用
 */

/** 文件操作类型 */
export enum FileOperateType {
  CREATE = 'create',
  MODIFY = 'modify',
  COMPLETE = 'complete',
  RELEASE = 'release',
}

/** 锁来源 — 决定释放策略 */
export enum LockSource {
  /** 用户/扩展显式锁 */
  EXPLICIT = 'explicit',
  /** 在某窗口打开自动锁 */
  AUTO_OPEN = 'auto-open',
  /** 有未保存修改自动锁 */
  AUTO_DIRTY = 'auto-dirty',
  /** 远程 agent hook 上报 */
  REMOTE = 'remote',
}

/** 上锁的工具类型 — 用于通知展示 */
export type AgentKind = 'vscode' | 'claude' | 'codex' | 'zcode' | 'cli' | 'other';

/** 锁记录 */
export interface FileRecord {
  /** 标准化绝对路径(正斜杠, drive小写) */
  filePath: string;
  /** 项目相对路径(展示用) */
  relPath?: string;
  operateType: FileOperateType;
  /** 占用方标识 */
  operator: string;
  /** 锁来源 */
  source: LockSource;
  /** 哪种工具上的锁 */
  agent: AgentKind;
  /** 上报此锁的扩展/agent 进程 ID */
  extensionId?: string;
  /** 窗口/会话 ID */
  windowId?: string;
  /** 备注 */
  desc?: string;
  /** 时间戳 ms */
  timestamp: number;
}

/** 磁盘上的锁文件结构 */
export interface LockFile {
  /** 注册表版本 */
  version: 1;
  /** 项目根绝对路径 */
  projectRoot: string;
  /** 项目 hash(短) */
  projectHash: string;
  /** 上次更新时间 */
  updatedAt: number;
  /** 锁列表(filePath -> record) */
  locks: Record<string, FileRecord>;
}

/** fg 命令的查询结果 */
export interface CheckResult {
  locked: boolean;
  record?: FileRecord;
  reason?: string;
}

/** 配置 */
export interface GuardConfig {
  ttlHours: number;
  /** watchdog 监听的项目根列表 */
  watchRoots: string[];
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const REGISTRY_DIR_NAME = '.fileguard';
export const PROJECTS_DIR = 'projects';
export const LOCKS_FILE = 'locks.json';
export const BACKUP_DIR = 'backups';
export const REGISTRY_FILE = 'registry.json';
