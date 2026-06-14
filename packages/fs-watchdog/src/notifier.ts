/**
 * notifier.ts — 跨平台非阻塞系统通知
 *
 * 设计原则: watchdog 的通知必须**非阻塞**(不能卡住监听循环)。
 *   - 删除已发生 → watchdog 立即恢复 → 发通知告知用户(异步)
 *   - 通知失败不影响主流程(只记日志)
 *
 * 不引入额外依赖(避免 watchdog 进程臃肿):
 * - Windows: PowerShell BalloonTip(原生, 异步 spawn)
 * - macOS: osascript(异步)
 * - Linux: notify-send(异步)
 */

import { spawn, execSync } from 'child_process';
import * as os from 'os';

/**
 * 非阻塞系统通知 — 弹完即走, 不等用户
 * 调用方用 setImmediate 包装即可彻底解耦
 */
export function notifyInfo(title: string, body: string): void {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      windowsToast(title, body);
    } else if (platform === 'darwin') {
      macToast(title, body);
    } else {
      linuxToast(title, body);
    }
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** Windows: PowerShell NotifyIcon BalloonTip(异步, 不阻塞) */
function windowsToast(title: string, body: string): void {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Warning
$n.Visible = $true
$n.ShowBalloonTip(5000, '${escapePS(title)}', '${escapePS(body)}', [System.Windows.Forms.ToolTipIcon]::Warning)
Start-Sleep -Seconds 6
$n.Dispose()
`.trim();
  // 异步 spawn, 不 await
  spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/** macOS: osascript notification(异步) */
function macToast(title: string, body: string): void {
  const script = `display notification "${escapeShell(body)}" with title "${escapeShell(title)}"`;
  spawn('osascript', ['-e', script], { stdio: 'ignore' }).unref();
}

/** Linux: notify-send(异步) */
function linuxToast(title: string, body: string): void {
  spawn('notify-send', [title, body], { stdio: 'ignore' }).unref();
}

/** PowerShell 字符串转义 */
function escapePS(s: string): string {
  return s.replace(/'/g, "''");
}
/** Shell 字符串转义 */
function escapeShell(s: string): string {
  return s.replace(/"/g, '\\"');
}

/** 截短路径显示(日志用) */
export function shortPath(p: string): string {
  if (p.length <= 60) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) return p;
  return parts[0] + '/.../' + parts.slice(-2).join('/');
}

/** 后台日志(同步, 给 watchdog 主循环用) */
export function logEvent(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[fileguard ${ts}] ${msg}`);
}

// 避免未用 import 报错(execSync 保留供未来扩展)
void execSync;
