/**
 * Webview 协同工具 — 给 Webview 面板用的桥接层
 *
 * 修复原版 webview-helper.ts 的致命 bug：
 * 原版 `vscode.postMessage(...)` 想 await 返回值——但 postMessage 是
 * 触发即忘（fire-and-forget），返回的是 undefined，Promise 永远 pending。
 *
 * 修复方案：用 requestId + 等待响应消息的回调模式，真正拿到返回值。
 *
 * 注意：这部分代码同时需要给主进程（extension host）和 webview 运行时使用。
 * - 主进程侧用 registerRequestHandler 处理 Webview 发来的请求
 * - Webview 侧用 createWebviewClient（注入到 webview HTML 的脚本里）
 */

import * as vscode from 'vscode';
import { LockStore } from './lockStore';
import { WebviewRequest, WebviewResponse } from './types';

type RequestHandler = (command: string, args: unknown[]) => Promise<unknown>;

/**
 * 主进程侧：注册在某个 WebviewPanel 上，处理该 Webview 发来的 invokeCommand 请求。
 *
 * 用法：
 *   const bridge = new WebviewBridge(panel, store);
 *   bridge.onRequest(async (cmd, args) => {
 *     if (cmd === 'isLocked') return store.isLocked(args[0] as string);
 *   });
 */
export class WebviewBridge {
  constructor(
    private panel: vscode.WebviewPanel,
    private store: LockStore
  ) {
    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg));
  }

  private handler?: RequestHandler;

  /** 注册请求处理器 */
  onRequest(handler: RequestHandler): void {
    this.handler = handler;
  }

  /** 主动向 Webview 推送锁状态变更 */
  pushRecord(record: unknown): void {
    void this.panel.webview.postMessage({ type: 'fileState', data: record });
  }

  private async onMessage(msg: WebviewRequest | WebviewResponse): Promise<void> {
    // 只处理请求类型
    if (msg.type !== 'request' && msg.type !== 'invokeCommand') return;
    const req = msg as WebviewRequest;
    const requestId = req.requestId;

    if (req.type === 'request' && req.filePath) {
      // requestLockStatus
      const record = this.store.get(req.filePath);
      const resp: WebviewResponse = {
        type: 'response',
        requestId,
        ok: true,
        result: record,
      };
      void this.panel.webview.postMessage(resp);
      return;
    }

    if (req.type === 'invokeCommand' && req.command) {
      try {
        if (!this.handler) throw new Error('No handler registered');
        const result = await this.handler(req.command, req.args || []);
        const resp: WebviewResponse = { type: 'response', requestId, ok: true, result };
        void this.panel.webview.postMessage(resp);
      } catch (err) {
        const resp: WebviewResponse = {
          type: 'response',
          requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        void this.panel.webview.postMessage(resp);
      }
    }
  }
}

/**
 * Webview 侧脚本字符串 — 注入到 webview HTML 里使用。
 *
 * 修复 postMessage 拿不到返回值：维护 pending Map，按 requestId 匹配响应。
 */
export const WEBVIEW_CLIENT_SCRIPT = `
(function() {
  const vscode = acquireVsCodeApi();
  const pending = new Map(); // requestId -> {resolve, reject}
  const handlers = new Map(); // type -> callback

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'response' && pending.has(msg.requestId)) {
      const p = pending.get(msg.requestId);
      pending.delete(msg.requestId);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'failed'));
      return;
    }
    if (msg.type === 'fileState') {
      handlers.get('fileState')?.(msg.data);
    }
  });

  function genId() { return 'r' + Date.now() + Math.random().toString(36).slice(2,6); }

  window.FileGuardClient = {
    invoke(command, args = []) {
      return new Promise((resolve, reject) => {
        const requestId = genId();
        pending.set(requestId, { resolve, reject });
        vscode.postMessage({ type: 'invokeCommand', requestId, command, args });
        // 超时 30s
        setTimeout(() => {
          if (pending.has(requestId)) {
            pending.delete(requestId);
            reject(new Error('timeout'));
          }
        }, 30000);
      });
    },
    onFileState(cb) { handlers.set('fileState', cb); },
    getWindowId() { return ${'`win-${Date.now()}`'}; }
  };
})();
`;
