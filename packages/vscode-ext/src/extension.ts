/**
 * File Guard — 扩展入口
 *
 * activate()：装配所有模块，注册命令，启动守卫
 * deactivate()：释放本窗口的自动锁（修复原版无 deactivate 的 bug）
 */

import * as vscode from 'vscode';
import { GuardConfig } from './types';
import { LockStore } from './lockStore';
import { FileGuard } from './guard';
import { Broadcaster } from './multiExtension';
import { StatusBar } from './statusBar';
import { registerCommands } from './commands';

let store: LockStore | undefined;
let guard: FileGuard | undefined;
let broadcaster: Broadcaster | undefined;

/** 读取配置（动态，每次调用都读最新值） */
function readConfig(): GuardConfig {
  const cfg = vscode.workspace.getConfiguration('fileguard');
  return {
    autoGuard: cfg.get<boolean>('autoGuard', true),
    guardDirtyOnly: cfg.get<boolean>('guardDirtyOnly', false),
    ttlHours: cfg.get<number>('ttlHours', 24),
    silent: cfg.get<boolean>('silent', false),
    interceptDelete: cfg.get<boolean>('interceptDelete', true),
    ownExtensionIds: cfg.get<string[]>('ownExtensionIds', []),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // 装配
  store = new LockStore(context);
  broadcaster = new Broadcaster(context, store, context.extension.id || 'fileguard');
  guard = new FileGuard(context, store, broadcaster, readConfig);

  // 启动守卫
  guard.activate();

  // 跨扩展广播监听：把其它扩展上报的锁同步进本扩展的 store
  const onBroadcast = broadcaster.onBroadcast(msg => {
    store!.report(msg.data);
  });

  // 配置变更时刷新
  const onCfgChange = vscode.workspace.onDidChangeConfiguration(e => {
    if (!e.affectsConfiguration('fileguard')) return;
    // 自动锁开关切换时不重启 guard（运行时实时读 cfg），仅刷新状态栏
  });

  // 状态栏
  const statusBar = new StatusBar(store);
  const statusDisposable = statusBar.activate();

  // 命令
  registerCommands(context, guard, store);

  context.subscriptions.push(onBroadcast, onCfgChange, statusDisposable, {
    dispose: () => {
      store?.dispose();
      broadcaster?.dispose();
    },
  });

  void vscode.window.showInformationMessage(
    `File Guard 已激活 — 当前 ${store.all().length} 个文件被锁定`
  );

  console.log('[File Guard] activated, windowId =', guard.windowId);
}

export function deactivate(): void {
  // 释放本窗口的自动锁（保留显式锁，因为 deactivate 不代表用户想放弃手动锁）
  guard?.dispose();
  console.log('[File Guard] deactivated, auto locks released');
}
