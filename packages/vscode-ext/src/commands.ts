/**
 * 命令注册 — fileguard.* 全套命令
 *
 * 替代原版的 gaokao-ai.* 前缀，并在 package.json 的 contributes.commands 正式注册
 * （原版只 registerCommand 没注册 manifest，命令面板里根本找不到）。
 */

import * as vscode from 'vscode';
import { FileGuard } from './guard';
import { LockStore } from './lockStore';
import { LockSource } from './types';

export function registerCommands(
  context: vscode.ExtensionContext,
  guard: FileGuard,
  store: LockStore
): void {

  // fileguard.lock — 锁定当前文件
  context.subscriptions.push(vscode.commands.registerCommand('fileguard.lock', async (uri?: vscode.Uri) => {
    const target = uri || vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showWarningMessage('File Guard: 没有打开的文件可锁定');
      return;
    }
    guard.lockCurrent(target.fsPath);
    void vscode.window.showInformationMessage(`File Guard: 已锁定 ${getRelPath(target)}`);
    void vscode.commands.executeCommand('setContext', 'fileguard.locked', true);
  }));

  // fileguard.unlock — 解锁当前文件
  context.subscriptions.push(vscode.commands.registerCommand('fileguard.unlock', async (uri?: vscode.Uri) => {
    const target = uri || vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      void vscode.window.showWarningMessage('File Guard: 没有打开的文件');
      return;
    }
    const had = guard.unlockCurrent(target.fsPath);
    void vscode.window.showInformationMessage(
      had ? `File Guard: 已解锁 ${getRelPath(target)}` : `File Guard: ${getRelPath(target)} 未被锁定`
    );
    void vscode.commands.executeCommand('setContext', 'fileguard.locked', false);
  }));

  // fileguard.unlockAll — 解锁本窗口全部
  context.subscriptions.push(vscode.commands.registerCommand('fileguard.unlockAll', async () => {
    const n = guard.unlockAll();
    void vscode.window.showInformationMessage(`File Guard: 已释放本窗口 ${n} 把锁`);
  }));

  // fileguard.list — QuickPick 列出所有锁
  context.subscriptions.push(vscode.commands.registerCommand('fileguard.list', async () => {
    const records = store.all();
    if (records.length === 0) {
      void vscode.window.showInformationMessage('File Guard: 当前没有文件被锁定');
      return;
    }
    const items: (vscode.QuickPickItem & { record: typeof records[number] })[] = records
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(r => ({
        label: r.relPath || r.filePath,
        description: guard.fmtOwner(r),
        detail: `${guard.fmtSource(r.source)}　${new Date(r.timestamp).toLocaleString()}${r.desc ? '　' + r.desc : ''}`,
        record: r,
      }));

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `共 ${items.length} 个文件被锁定 — 选择查看`,
      title: 'File Guard — 锁定文件清单',
    });

    if (pick) {
      const choice = await vscode.window.showInformationMessage(
        pick.label,
        { modal: true, detail: pick.detail },
        '打开文件',
        '强制解锁',
        '关闭'
      );
      if (choice === '打开文件') {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pick.record.filePath));
      } else if (choice === '强制解锁') {
        store.unlock(pick.record.filePath);
        void vscode.window.showInformationMessage(`File Guard: 已解锁 ${pick.label}`);
      }
    }
  }));

  // fileguard.toggleAutoGuard — 开关自动锁
  context.subscriptions.push(vscode.commands.registerCommand('fileguard.toggleAutoGuard', async () => {
    const cfg = vscode.workspace.getConfiguration('fileguard');
    const cur = cfg.get<boolean>('autoGuard', true);
    await cfg.update('autoGuard', !cur, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(
      `File Guard: 自动锁已${!cur ? '开启' : '关闭'}`
    );
  }));
}

function getRelPath(uri: vscode.Uri): string {
  const ws = vscode.workspace.getWorkspaceFolder(uri);
  if (ws) {
    const rel = uri.fsPath.slice(ws.uri.fsPath.length).replace(/^[\\/]/, '');
    return rel || uri.fsPath;
  }
  return uri.fsPath;
}

/** 工具：导入 LockSource 供 setContext 一致性校验 */
export const _SOURCE = LockSource;
