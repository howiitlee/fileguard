/**
 * 守卫核心 — 这是整个扩展的灵魂
 *
 * 修复原版最致命的缺陷：原版没有任何真正的删除拦截，只靠代码主动调
 * checkCanDelete()（opt-in），等于"防君子不防小人"。
 *
 * 本模块提供三层防护：
 *   1. 自动锁：本窗口打开/有未保存修改的文件 → 自动锁定
 *   2. 拦截删：onWillDeleteFiles 命中锁 → e.waitUntil(reject) 阻断
 *   3. 自动释放：文档关闭 / 扩展卸载 → 自动释放对应锁
 */

import * as vscode from 'vscode';
import { FileOperateType, FileRecord, GuardConfig, LockSource } from './types';
import { LockStore } from './lockStore';
import { Broadcaster } from './multiExtension';

/** 生成本窗口唯一 ID（持久化在 workspaceState） */
function getWindowId(context: vscode.ExtensionContext): string {
  let id = context.workspaceState.get<string>('fileguard.windowId');
  if (!id) {
    id = `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    void context.workspaceState.update('fileguard.windowId', id);
  }
  return id;
}

export class FileGuard {
  readonly windowId: string;
  readonly extensionId: string;
  private disposables: vscode.Disposable[] = [];
  private readonly OWN_EXT_PREFIX = 'fileguard';

  constructor(
    context: vscode.ExtensionContext,
    private store: LockStore,
    private broadcaster: Broadcaster,
    private getCfg: () => GuardConfig
  ) {
    this.extensionId = context.extension.id || 'fileguard';
    this.windowId = getWindowId(context);
  }

  activate(): void {
    const cfg = this.getCfg();

    // ① 启动时：清理过期锁，并对当前已打开的文档补锁
    this.store.cleanup(cfg.ttlHours * 60 * 60 * 1000);
    if (cfg.autoGuard) {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme === 'file') this.maybeAutoLock(doc);
      }
    }

    // ② 删除拦截（核心）
    if (cfg.interceptDelete) {
      this.disposables.push(vscode.workspace.onWillDeleteFiles(this.onWillDelete, this));
    }

    // ③ 自动锁：编辑器切换 + 文档打开
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(e => {
      if (e && e.document.uri.scheme === 'file' && this.getCfg().autoGuard) {
        this.maybeAutoLock(e.document);
      }
    }));
    this.disposables.push(vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.uri.scheme === 'file' && this.getCfg().autoGuard) {
        this.maybeAutoLock(doc);
      }
    }));

    // ④ 自动释放：文档关闭（仅释放本窗口的 auto 锁，不动 explicit 锁）
    this.disposables.push(vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme !== 'file') return;
      const r = this.store.get(doc.uri.fsPath);
      if (!r) return;
      if ((r.source === LockSource.AUTO_OPEN || r.source === LockSource.AUTO_DIRTY) &&
          (r.windowId === this.windowId || r.extensionId === this.extensionId)) {
        this.release(doc.uri.fsPath, '文档关闭，自动释放');
      }
    }));

    // ⑤ 启动定时清理
    this.disposables.push(this.store.startCleanupTimer(cfg.ttlHours));
  }

  // ────────────────────────────────────────────────
  // 自动锁
  // ────────────────────────────────────────────────

  private maybeAutoLock(doc: vscode.TextDocument): void {
    const cfg = this.getCfg();
    if (!cfg.autoGuard) return;

    const path = doc.uri.fsPath;
    const existing = this.store.get(path);
    // 已经被自己锁了，刷新时间戳即可
    if (existing && existing.extensionId === this.extensionId) {
      this.store.lock(path, existing.operator, {
        source: existing.source,
        extensionId: this.extensionId,
        windowId: this.windowId,
        desc: existing.desc,
      });
      return;
    }
    // 已被别人锁，不动
    if (existing) return;

    // guardDirtyOnly 模式只锁脏文档
    const isDirty = doc.isDirty;
    const source = isDirty ? LockSource.AUTO_DIRTY : LockSource.AUTO_OPEN;
    if (cfg.guardDirtyOnly && !isDirty) return;

    const record = this.store.lock(path, this.extensionId, {
      source,
      extensionId: this.extensionId,
      windowId: this.windowId,
      desc: isDirty ? '有未保存修改，自动锁定' : '在本窗口打开，自动锁定',
    });
    this.broadcaster.broadcast(record);
  }

  // ────────────────────────────────────────────────
  // 删除拦截（核心）
  // ────────────────────────────────────────────────

  private async onWillDelete(e: vscode.FileWillDeleteEvent): Promise<void> {
    const cfg = this.getCfg();
    const blocked: FileRecord[] = [];

    for (const uri of e.files) {
      const path = uri.fsPath;
      const r = this.store.get(path);
      if (!r) continue;
      // 自己显式锁的文件，由自己解锁，不拦截
      if (r.source === LockSource.EXPLICIT && r.extensionId === this.extensionId) continue;
      blocked.push(r);
    }

    if (blocked.length === 0) return;

    // 阻断删除
    e.waitUntil(Promise.reject(new Error(`File Guard blocked deletion of ${blocked.length} locked file(s)`)));

    if (!cfg.silent) {
      const lines = blocked.map(r => {
        const owner = this.fmtOwner(r);
        const since = new Date(r.timestamp).toLocaleTimeString();
        return `• ${r.relPath || r.filePath}\n    占用方: ${owner}　来源: ${this.fmtSource(r.source)}　时间: ${since}`;
      });
      const detail = lines.join('\n');

      const choice = await vscode.window.showWarningMessage(
        `File Guard 拦截了 ${blocked.length} 个文件的删除 —— 它们正被其他窗口/扩展占用`,
        { modal: true, detail },
        '强制删除（我知道风险）',
        '保留'
      );

      if (choice === '强制删除（我知道风险）') {
        await this.forceDelete(blocked);
      }
    }
  }

  private async forceDelete(records: FileRecord[]): Promise<void> {
    // 先解锁再删（用文件系统 API，会重新触发一次 onWillDelete 但此时已无锁）
    for (const r of records) {
      this.store.unlock(r.filePath);
      this.broadcaster.broadcast({ ...r, operateType: FileOperateType.RELEASE });
    }
    const uris = records.map(r => vscode.Uri.file(r.filePath));
    for (const uri of uris) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: true });
      } catch {
        // 忽略单个失败，继续删其它
      }
    }
  }

  // ────────────────────────────────────────────────
  // 公共操作（命令调用）
  // ────────────────────────────────────────────────

  lockCurrent(filePath: string, desc?: string): FileRecord {
    const r = this.store.lock(filePath, this.extensionId, {
      source: LockSource.EXPLICIT,
      extensionId: this.extensionId,
      windowId: this.windowId,
      desc: desc || '手动锁定',
    });
    this.broadcaster.broadcast(r);
    return r;
  }

  unlockCurrent(filePath: string): boolean {
    const had = this.store.unlock(filePath);
    if (had) {
      this.broadcaster.broadcast({
        filePath,
        operateType: FileOperateType.RELEASE,
        operator: this.extensionId,
        source: LockSource.EXPLICIT,
        extensionId: this.extensionId,
        windowId: this.windowId,
        timestamp: Date.now(),
      });
    }
    return had;
  }

  unlockAll(): number {
    const n = this.store.unlockByOwner(this.extensionId, this.windowId);
    return n;
  }

  release(filePath: string, reason: string): void {
    this.store.unlock(filePath);
    this.broadcaster.broadcast({
      filePath,
      operateType: FileOperateType.RELEASE,
      operator: this.extensionId,
      source: LockSource.AUTO_OPEN,
      extensionId: this.extensionId,
      windowId: this.windowId,
      desc: reason,
      timestamp: Date.now(),
    });
  }

  // ────────────────────────────────────────────────
  // 关闭
  // ────────────────────────────────────────────────

  /** 扩展 deactivate 调用：只释放 auto 锁（保留 explicit 锁，因为用户可能想长期占用） */
  dispose(): void {
    // 释放本窗口的自动锁
    for (const r of this.store.all()) {
      if ((r.source === LockSource.AUTO_OPEN || r.source === LockSource.AUTO_DIRTY) &&
          r.windowId === this.windowId) {
        this.store.unlock(r.filePath);
      }
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ────────────────────────────────────────────────
  // 格式化
  // ────────────────────────────────────────────────

  fmtOwner(r: FileRecord): string {
    if (r.extensionId && r.extensionId !== this.extensionId && !r.extensionId.startsWith(this.OWN_EXT_PREFIX)) {
      const own = this.getCfg().ownExtensionIds;
      return own.includes(r.extensionId) ? `${r.operator}（友军）` : `${r.operator}（其他扩展）`;
    }
    if (r.windowId && r.windowId === this.windowId) return `${r.operator}（本窗口）`;
    return r.operator;
  }

  fmtSource(s: LockSource): string {
    switch (s) {
      case LockSource.EXPLICIT: return '显式锁';
      case LockSource.AUTO_OPEN: return '自动锁·打开';
      case LockSource.AUTO_DIRTY: return '自动锁·脏文档';
      case LockSource.REMOTE: return '远程广播';
    }
  }
}
