/**
 * File Guard — 核心类型定义
 *
 * 泛化自原 GAOKAO-AI/collaboration/types.ts：
 * - 去掉一切业务耦合（gaokao-ai 字样）
 * - source/operator 字段语义对齐：source = 上报来源，operator = 占用方标识
 */

/** 文件操作类型 */
export enum FileOperateType {
  /** 新建文件 */
  CREATE = 'create',
  /** 修改文件 */
  MODIFY = 'modify',
  /** 任务完成，文件定型 */
  COMPLETE = 'complete',
  /** 释放占用（可删除） */
  RELEASE = 'release',
}

/** 锁定来源 — 决定锁的优先级和释放策略 */
export enum LockSource {
  /** 用户/扩展通过 lock 命令显式锁定 */
  EXPLICIT = 'explicit',
  /** 文件在本窗口打开自动锁定 */
  AUTO_OPEN = 'auto-open',
  /** 文件有未保存修改自动锁定 */
  AUTO_DIRTY = 'auto-dirty',
  /** 来自其它扩展的广播 */
  REMOTE = 'remote',
}

/**
 * 文件锁记录
 *
 * 与原版的差异：
 * - 增加 `source` 区分锁定来源（自动锁和显式锁的释放策略不同）
 * - 增加 `extensionId` 区分是哪个扩展上的锁
 * - 增加 `windowId` 区分同一扩展的不同窗口
 */
export interface FileRecord {
  /** 标准化后的绝对路径（统一用 fsPath，正斜杠），作为锁的 key */
  filePath: string;
  /** 工作区相对路径（仅用于展示，可能为 undefined 如外部文件） */
  relPath?: string;
  operateType: FileOperateType;
  /** 占用方标识：扩展名 / 窗口 ID / 用户 */
  operator: string;
  /** 锁定来源 */
  source: LockSource;
  /** 上报此锁的扩展 ID（用于跨扩展归属判断） */
  extensionId?: string;
  /** 窗口标识（同一扩展的多个窗口） */
  windowId?: string;
  /** 操作备注 */
  desc?: string;
  /** 创建/最后刷新时间戳（ms） */
  timestamp: number;
}

/** 广播消息体（跨扩展用 commands.executeCommand 传递） */
export interface BroadcastMsg {
  msgType: 'fileState';
  data: FileRecord;
  /** 消息来源 extension id */
  source: string;
}

/** Webview 请求消息 */
export interface WebviewRequest {
  type: 'request' | 'invokeCommand';
  requestId: string;
  command?: string;
  args?: unknown[];
  filePath?: string;
}

/** Webview 响应消息（修复原版 postMessage 拿不到返回值的 bug） */
export interface WebviewResponse {
  type: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type WebviewMessage = WebviewRequest | WebviewResponse;

/** 配置项（与 package.json contributes.configuration 对齐） */
export interface GuardConfig {
  autoGuard: boolean;
  guardDirtyOnly: boolean;
  ttlHours: number;
  silent: boolean;
  interceptDelete: boolean;
  ownExtensionIds: string[];
}

/** workspaceState 持久化的 key */
export const STATE_KEY_LOCK_LIST = 'fileguard.lockList';
export const STATE_KEY_WINDOW_ID = 'fileguard.windowId';

/** 跨扩展广播的固定命令 ID */
export const CMD_BROADCAST = 'fileguard._broadcast';
export const CMD_QUERY = 'fileguard._query';

/** 24 小时兜底（实际读 config.ttlHours） */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
