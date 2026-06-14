/**
 * agentTrust.ts — Agent 信任分级
 *
 * 对照 AI-company 的 trust_score。走轻量:
 * - 全局名单 ~/.fileguard/agents.json
 * - 三档: trusted(可信, 删锁文件放行) / normal(默认) / untrusted(必拦)
 * - 未登记的 agent = unknown, 按你选的策略: **默认拦**
 *
 * 设计要点:
 * - agent 名 = operator 标识(Claude Code / Codex / ZCode / 用户名 / 扩展 ID)
 * - 名单是"白名单"语义: 想被放行必须显式登记为 trusted
 * - 名单变更也写审计日志(谁在什么时候把谁标成什么)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRegistryRoot } from './paths';
import { TrustLevel } from './audit';

const AGENTS_FILE = 'agents.json';

export interface AgentRecord {
  /** agent 标识(operator 用什么就填什么) */
  name: string;
  /** 信任等级 */
  trust: TrustLevel;
  /** 备注(可选) */
  note?: string;
  /** 首次见到的时间 */
  firstSeen: string;
  /** 信任等级最后更新时间 */
  updatedAt: string;
}

interface AgentsFile {
  version: 1;
  agents: Record<string, AgentRecord>;
}

const DEFAULT_TRUST: TrustLevel = 'unknown';

/** 内存缓存 + 落盘 */
export class AgentTrust {
  private agents = new Map<string, AgentRecord>();
  private loaded = false;
  private filePath: string;

  constructor() {
    this.filePath = path.join(getRegistryRoot(), AGENTS_FILE);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw) as AgentsFile;
        for (const [k, v] of Object.entries(data.agents || {})) {
          this.agents.set(k, v);
        }
      }
    } catch {
      this.agents.clear();
    }
  }

  private persist(): void {
    const data: AgentsFile = {
      version: 1,
      agents: Object.fromEntries(this.agents),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /** 查某 agent 的信任等级(未登记返回 'unknown') */
  get(name: string): TrustLevel {
    this.ensureLoaded();
    const r = this.agents.get(name);
    return r ? r.trust : DEFAULT_TRUST;
  }

  /** 设置/更新信任等级 */
  set(name: string, trust: TrustLevel, note?: string): AgentRecord {
    this.ensureLoaded();
    const existing = this.agents.get(name);
    const now = new Date().toISOString();
    const record: AgentRecord = {
      name,
      trust,
      note: note ?? existing?.note,
      firstSeen: existing?.firstSeen ?? now,
      updatedAt: now,
    };
    this.agents.set(name, record);
    this.persist();
    return record;
  }

  /** 登记一个 agent(若已存在不覆盖 trust, 仅刷新 firstSeen) */
  observe(name: string): void {
    this.ensureLoaded();
    if (!this.agents.has(name)) {
      this.set(name, 'unknown');
    }
  }

  /** 删除一个 agent 记录 */
  remove(name: string): boolean {
    this.ensureLoaded();
    const had = this.agents.delete(name);
    if (had) this.persist();
    return had;
  }

  /** 列出全部 */
  list(): AgentRecord[] {
    this.ensureLoaded();
    return Array.from(this.agents.values());
  }

  // ────────────────────────────────────────────────
  // 决策核心: 这把锁该不该被某 agent 删
  // ────────────────────────────────────────────────

  /**
   * 决策: agent 想删 lockedFile, 是否允许?
   *
   * 策略(你选的 unknown 默认拦):
   *   - trusted   → 允许(并在审计日志标记, 便于追溯)
   *   - normal    → 拦截(需用户确认, 但本函数不弹窗, 只返回决策)
   *   - untrusted → 拦截
   *   - unknown   → 拦截(保守)
   *
   * 返回: { allow: boolean, reason: string }
   */
  decideDelete(agentName: string, lockOwner: string): { allow: boolean; reason: string; trust: TrustLevel } {
    this.ensureLoaded();
    const trust = this.get(agentName);

    // 特例: 自己锁的自己删, 一律允许(不管 trust)
    if (agentName === lockOwner) {
      return { allow: true, reason: 'self-unlock', trust };
    }

    switch (trust) {
      case 'trusted':
        return { allow: true, reason: `agent ${agentName} 是 trusted, 放行删锁文件`, trust };
      case 'normal':
        return { allow: false, reason: `agent ${agentName} 是 normal, 删锁文件需确认`, trust };
      case 'untrusted':
        return { allow: false, reason: `agent ${agentName} 是 untrusted, 拒绝`, trust };
      case 'unknown':
      default:
        return { allow: false, reason: `agent ${agentName} 未登记(unknown), 默认拦截`, trust };
    }
  }
}

/** 全局单例(进程内) */
let globalTrust: AgentTrust | undefined;
export function getAgentTrust(): AgentTrust {
  if (!globalTrust) globalTrust = new AgentTrust();
  return globalTrust;
}
