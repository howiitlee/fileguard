/**
 * install.ts — 把 watchdog 注册成系统服务(开机自启)
 *
 * 平台方案:
 * - Windows: 创建一个 .bat + 注册表 Run 键(用户级, 无需管理员)
 * - macOS: launchd plist (~/Library/LaunchAgents/)
 * - Linux: systemd user unit (~/.config/systemd/user/)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const LAUNCHER_NAME = 'fileguard-watchdog';

function getMainJs(): string {
  return path.resolve(__dirname, 'main.js');
}

function getNodePath(): string {
  return process.execPath;
}

/** 安装 */
export function install(projects: string[]): void {
  const platform = os.platform();
  const args = projects.length > 0 ? ' ' + projects.map(p => `"${p}"`).join(' ') : '';

  if (platform === 'win32') {
    installWindows(args);
  } else if (platform === 'darwin') {
    installMac(args);
  } else {
    installLinux(args);
  }
  console.log(`\n✓ FileGuard watchdog 已安装为开机自启`);
  console.log(`  监控项目: ${projects.length > 0 ? projects.join(', ') : '(当前目录)'}`);
}

/** 卸载 */
export function uninstall(): void {
  const platform = os.platform();
  if (platform === 'win32') uninstallWindows();
  else if (platform === 'darwin') uninstallMac();
  else uninstallLinux();
  console.log('✓ 已卸载 FileGuard watchdog');
}

// ────────────────────────────────────────────────
// Windows: 启动文件夹放 .vbs 静默启动器(不弹黑窗)
// ────────────────────────────────────────────────
function installWindows(args: string): void {
  const startupDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
  );
  fs.mkdirSync(startupDir, { recursive: true });

  const vbsPath = path.join(startupDir, `${LAUNCHER_NAME}.vbs`);
  // 用 wscript 运行 node, 静默
  const vbs = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """" & "${getNodePath()}" & """ """ & "${getMainJs()}" & """" & "${args}", 0, False`;

  // 注意: VBS 里双引号转义, 这里用 Write 工具写 UTF-8(踩坑铁律: 不用 PowerShell 写)
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  console.log(`  启动项: ${vbsPath}`);
}

function uninstallWindows(): void {
  const startupDir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
  );
  const vbsPath = path.join(startupDir, `${LAUNCHER_NAME}.vbs`);
  try { fs.unlinkSync(vbsPath); } catch { /* 已不存在 */ }
}

// ────────────────────────────────────────────────
// macOS: launchd plist
// ────────────────────────────────────────────────
function installMac(args: string): void {
  const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const plistPath = path.join(agentsDir, `com.fileguard.watchdog.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fileguard.watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>${getNodePath()}</string>
    <string>${getMainJs()}</string>${args.split(' ').filter(Boolean).map(a => `\n    <string>${a.replace(/"/g, '')}</string>`).join('')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>`;
  fs.writeFileSync(plistPath, plist, 'utf8');
  try { execSync(`launchctl load "${plistPath}"`); } catch { /* ignore */ }
  console.log(`  plist: ${plistPath}`);
}

function uninstallMac(): void {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.fileguard.watchdog.plist');
  try { execSync(`launchctl unload "${plistPath}"`); } catch { /* ignore */ }
  try { fs.unlinkSync(plistPath); } catch { /* ignore */ }
}

// ────────────────────────────────────────────────
// Linux: systemd user unit
// ────────────────────────────────────────────────
function installLinux(args: string): void {
  const unitsDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(unitsDir, { recursive: true });
  const unitPath = path.join(unitsDir, `${LAUNCHER_NAME}.service`);
  const unit = `[Unit]
Description=FileGuard Watchdog
After=network.target

[Service]
ExecStart=${getNodePath()} ${getMainJs()}${args}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target`;
  fs.writeFileSync(unitPath, unit, 'utf8');
  try {
    execSync('systemctl --user daemon-reload');
    execSync(`systemctl --user enable ${LAUNCHER_NAME}.service`);
    execSync(`systemctl --user start ${LAUNCHER_NAME}.service`);
  } catch { /* ignore */ }
  console.log(`  unit: ${unitPath}`);
}

function uninstallLinux(): void {
  const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `${LAUNCHER_NAME}.service`);
  try {
    execSync(`systemctl --user stop ${LAUNCHER_NAME}.service`);
    execSync(`systemctl --user disable ${LAUNCHER_NAME}.service`);
  } catch { /* ignore */ }
  try { fs.unlinkSync(unitPath); } catch { /* ignore */ }
  try { execSync('systemctl --user daemon-reload'); } catch { /* ignore */ }
}

// CLI 入口
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'uninstall') {
    uninstall();
  } else if (cmd === 'install') {
    install(process.argv.slice(3));
  } else {
    console.log(`用法:
  node install.js install [projectRoot1] [projectRoot2] ...
  node install.js uninstall`);
  }
}
