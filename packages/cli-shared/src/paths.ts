/**
 * 路径工具 — 全局锁注册表布局
 *
 * 布局(用户选了"全局"方案):
 *   ~/.fileguard/
 *     ├─ registry.json                 ← 所有项目的索引(项目root→hash)
 *     └─ projects/<projectHash>/
 *          ├─ locks.json               ← 该项目所有锁
 *          └─ backups/<sanitized>.bak  ← watchdog 删前备份
 *
 * 锁按"项目"分目录的原因: 不同项目的同名文件(src/index.ts)互不干扰,
 * watchdog 也只需监听自己项目目录下的文件。
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { existsSync as fsExistsSync } from 'fs';
import {
  REGISTRY_DIR_NAME,
  PROJECTS_DIR,
  LOCKS_FILE,
  BACKUP_DIR,
  REGISTRY_FILE,
} from './types';

/** ~/.fileguard 根目录 */
export function getRegistryRoot(): string {
  const home = os.homedir();
  return path.join(home, REGISTRY_DIR_NAME);
}

/** 项目 hash: 用项目根绝对路径做 sha1, 取前 12 位 */
export function hashProject(projectRoot: string): string {
  const normalized = path.resolve(projectRoot).replace(/\\/g, '/');
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/** 单项目的根目录: ~/.fileguard/projects/<hash>/ */
export function getProjectDir(projectRoot: string): string {
  return path.join(getRegistryRoot(), PROJECTS_DIR, hashProject(projectRoot));
}

/** 锁文件路径: ~/.fileguard/projects/<hash>/locks.json */
export function getLocksFile(projectRoot: string): string {
  return path.join(getProjectDir(projectRoot), LOCKS_FILE);
}

/** 备份目录: ~/.fileguard/projects/<hash>/backups/ */
export function getBackupDir(projectRoot: string): string {
  return path.join(getProjectDir(projectRoot), BACKUP_DIR);
}

/** 把任意文件路径转成合法备份文件名(去掉盘符和分隔符) */
export function sanitizeForBackup(filePath: string): string {
  return filePath
    .replace(/^[a-zA-Z]:/, '')         // 去 drive
    .replace(/[/\\]+/g, '__')          // 分隔符转 __
    .replace(/^__/, '')                // 去开头 __
    + '.bak';
}

/** 全局 registry.json 路径 */
export function getRegistryFile(): string {
  return path.join(getRegistryRoot(), REGISTRY_FILE);
}

/** 标准化路径: drive 小写, 分隔符统一 / */
export function normalizePath(p: string): string {
  const n = p.replace(/\\/g, '/');
  return n.replace(/^([A-Z]):/, (_m, d) => d.toLowerCase() + ':');
}

/** 找文件所属的项目根(向上找 .git 或 package.json) */
export function findProjectRoot(filePath: string): string | null {
  let dir = path.dirname(path.resolve(filePath));
  const { root } = path.parse(dir);
  while (dir !== root) {
    if (
      fsExistsSync(path.join(dir, '.git')) ||
      fsExistsSync(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}
