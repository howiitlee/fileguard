/**
 * 跨扩展广播 — 用 VS Code 内置的 commands.executeCommand 实现扩展间通信
 *
 * VS Code 不提供扩展间直接调用 API，标准做法是约定一个命令 ID，
 * 各扩展 executeCommand 这个 ID 来传递消息。本模块封装这一机制。
 */

import * as vscode from 'vscode';
import { BroadcastMsg, CMD_BROADCAST, CMD_QUERY, FileRecord } from './types';
import { LockStore } from './lockStore';

/** 跨扩展广播接收回调 */
type BroadcastHandler = (msg: BroadcastMsg) => void;

export class Broadcaster {
  private handlers: BroadcastHandler[] = [];

  constructor(private context: vscode.ExtensionContext, private store: LockStore, private selfId: string) {
    this.register();
  }

  private register(): void {
    // 接收其它扩展广播来的锁
    const sub1 = vscode.commands.registerCommand(CMD_BROADCAST, (msg: BroadcastMsg) => {
      if (!msg || msg.source === this.selfId) return; // 忽略自己发的
      this.handlers.forEach(h => h(msg));
    });

    // 接收其它扩展的查询请求（返回本扩展持有的锁列表）
    const sub2 = vscode.commands.registerCommand(CMD_QUERY, (): FileRecord[] => {
      return this.store.all();
    });

    this.context.subscriptions.push(sub1, sub2);
  }

  /** 广播一条锁变更给所有扩展 */
  broadcast(record: FileRecord): void {
    const msg: BroadcastMsg = {
      msgType: 'fileState',
      data: record,
      source: this.selfId,
    };
    // fire-and-forget：其它扩展的 fileguard._broadcast 会收到
    void vscode.commands.executeCommand(CMD_BROADCAST, msg).then(
      () => {},
      () => {
        // 没人监听也无所谓（这是正常的，不是每个扩展都装了 File Guard）
      }
    );
  }

  /** 主动向所有已装 File Guard 的扩展查询锁列表（去重合并） */
  async collectAll(): Promise<FileRecord[]> {
    const local = this.store.all();
    // 这里我们靠各扩展在广播时被动同步，主动查询用 CMD_QUERY 触发其它扩展响应
    // 注意：executeCommand 只能触发本扩展内的注册，跨扩展查询依赖对方也注册了 CMD_QUERY
    const remote: FileRecord[] = [];
    try {
      const r = await vscode.commands.executeCommand(CMD_QUERY);
      if (Array.isArray(r)) remote.push(...(r as FileRecord[]));
    } catch {
      // 自己注册过 CMD_QUERY 的话会返回本扩展的锁，已经合并到 local
    }
    // 合并去重（按 filePath）
    const map = new Map<string, FileRecord>();
    for (const r of local) map.set(r.filePath, r);
    for (const r of remote) if (!map.has(r.filePath)) map.set(r.filePath, r);
    return Array.from(map.values());
  }

  /** 订阅广播 */
  onBroadcast(handler: BroadcastHandler): vscode.Disposable {
    this.handlers.push(handler);
    return { dispose: () => {
      this.handlers = this.handlers.filter(h => h !== handler);
    }};
  }

  dispose(): void {
    this.handlers = [];
  }
}
