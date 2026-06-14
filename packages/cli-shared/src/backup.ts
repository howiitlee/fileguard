/**
 * backup.ts — 删前快照备份 + 恢复
 *
 * watchdog 在文件被删的瞬间(unlink 事件)其实文件已经没了,
 * 所以备份必须在"还来得及"的时刻做:
 *   1. 文件被锁时 → 立即备份一份(随时可恢复)
 *   2. 文件内容变化时 → 刷新备份
 *
 * 恢复策略(优先级):
 *   a. 项目是 git 仓库 → git checkout(最可靠, 能恢复历史)
 *   b. 否则 → 从 .fileguard/projects/<hash>/backups/ 恢复
 *   c. 都没有 → 告知用户无法恢复
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getBackupDir, sanitizeForBackup } from './paths';

/** 备份一个文件(如果存在) */
export function backupFile(projectRoot: string, filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const backupDir = getBackupDir(projectRoot);
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, sanitizeForBackup(filePath));
    fs.copyFileSync(filePath, backupPath);
    return true;
  } catch {
    return false;
  }
}

/** 恢复一个文件: 优先 git, 其次备份 */
export function restoreFile(projectRoot: string, filePath: string): { ok: boolean; method: string } {
  const normalized = filePath.replace(/\\/g, '/');

  // a. git 恢复(只对 git 仓库 + 已跟踪文件有效)
  if (fs.existsSync(path.join(projectRoot, '.git'))) {
    try {
      // 检查是否被 git 跟踪
      const tracked = execSync(
        `git ls-files --error-unmatch "${normalized}"`,
        { cwd: projectRoot, stdio: ['ignore', 'ignore', 'ignore'] }
      ).toString().trim();
      if (tracked) {
        execSync(`git checkout -- "${normalized}"`, { cwd: projectRoot, stdio: 'ignore' });
        if (fs.existsSync(filePath)) {
          return { ok: true, method: 'git checkout' };
        }
      }
    } catch {
      // 没 tracked 或 git 不可用, 走备份
    }
  }

  // b. 备份恢复
  const backupDir = getBackupDir(projectRoot);
  const backupPath = path.join(backupDir, sanitizeForBackup(filePath));
  if (fs.existsSync(backupPath)) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.copyFileSync(backupPath, filePath);
      return { ok: true, method: 'backup snapshot' };
    } catch {
      return { ok: false, method: 'backup restore failed' };
    }
  }

  // c. 都没有
  return { ok: false, method: 'no source available' };
}

/** 列出某项目的所有备份 */
export function listBackups(projectRoot: string): string[] {
  const backupDir = getBackupDir(projectRoot);
  try {
    return fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
  } catch {
    return [];
  }
}
