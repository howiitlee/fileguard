# @fileguard/codex-hook

OpenAI Codex CLI 的 FileGuard 拦截器。

## 重要限制

基于可行性核查:
- Codex Hooks **当前在 feature-flag 后**, 需先确认你的版本支持
- **仅拦截 Bash 工具**, 非删除路径拦不住
- **必须配合 fs-watchdog 兜底**, 否则保护不完整

## 安装

```bash
# 前置: 编译 cli-shared
cd /path/to/fileguard && npm run build

# 注册(尝试自动写入 ~/.codex/config.json)
node packages/codex-hook/install.js
```

如果自动注册不生效(Codex 版本差异), 手动:
```bash
codex /hooks add pre-tool-use --command "node /abs/path/to/codex-hook/hook.js"
```

## 卸载

编辑 `~/.codex/config.json`, 删除 `hooks["pre-tool-use"]` 里对应条目。
