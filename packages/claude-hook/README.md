# @fileguard/claude-hook

Claude Code 的 FileGuard PreToolUse 拦截器。

## 安装

前置: 先在 monorepo 根目录 `npm run build`(编译 cli-shared)。

```bash
# 注册到全局(所有项目生效)
node packages/claude-hook/install.js

# 或只注册到当前项目
node packages/claude-hook/install.js --project
```

注册后会在 `~/.claude/settings.json` 写入:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Write|Edit",
      "hooks": [{ "type": "command", "command": "node /abs/path/to/hook.js" }]
    }]
  }
}
```

## 工作原理

Claude Code 调用 Bash/Write/Edit 工具前, 把 JSON 经 stdin 传给本 hook:
- `Bash` 工具 → 解析命令里的 `rm`/`del`/`Remove-Item`/`git rm` 目标
- `Write`/`Edit` 工具 → 直接取 `file_path`

然后查 FileGuard 锁表:
- 命中锁 → `exit 2` 阻断, stderr 反馈给 Claude Code(它会重新规划)
- 未命中 → `exit 0` 放行

## 卸载

手动编辑 `~/.claude/settings.json`, 删掉对应 hook 条目即可。
