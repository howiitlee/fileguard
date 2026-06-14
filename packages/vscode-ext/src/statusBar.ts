/**
 * 状态栏指示器 — 显示当前工作区被锁定的文件数
 */

import * as vscode from 'vscode';
import { LockStore } from './lockStore';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor(private store: LockStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'fileguard.list';
    this.item.tooltip = 'File Guard — 点击查看所有锁定文件';
    this.item.name = 'File Guard';
  }

  activate(): vscode.Disposable {
    const sub = this.store.onChange(() => this.refresh());
    this.refresh();
    this.item.show();
    return { dispose: () => {
      sub.dispose();
      this.item.dispose();
    }};
  }

  private refresh(): void {
    const n = this.store.all().length;
    if (n === 0) {
      this.item.text = '$(lock) 0';
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(lock) ${n}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
  }
}
