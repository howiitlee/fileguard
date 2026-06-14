// 验证 extension.js 能否被加载(模拟 VS Code 环境)
// 不真正 activate(那需要真实 vscode API), 只验证模块解析无错
const Module = require('module');
const path = require('path');

const extPath = path.join(
  require('os').homedir(),
  '.vscode',
  'extensions',
  'howiitlee.vscode-file-guard-1.0.0',
  'out',
  'extension.js'
);

// 注入假的 vscode 模块(esbuild external 了 vscode, require 时需要它存在)
const fakeVscode = {
  workspace: {
    workspaceState: { get: () => undefined, update: () => Promise.resolve() },
    getConfiguration: () => ({ get: (k, d) => d }),
    textDocuments: [],
    onWillDeleteFiles: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    onDidChangeConfiguration: () => ({ dispose: () => {} }),
    fs: { delete: () => Promise.resolve() },
  },
  window: {
    activeTextEditor: undefined,
    createStatusBarItem: () => ({ show: () => {}, dispose: () => {}, text: '', tooltip: '', command: '' }),
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showQuickPick: () => Promise.resolve(),
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve(),
  },
  ExtensionMode: { Production: 1 },
  StatusBarAlignment: { Left: 1 },
  ThemeColor: function() {},
  EventEmitter: function() { return { event: () => {}, fire: () => {}, dispose: () => {} }; },
  Disposable: function() { return { dispose: () => {} }; },
  Uri: { file: (p) => ({ fsPath: p }) },
};

// 劫持 require('vscode')
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === 'vscode') return 'vscode-fake';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['vscode-fake'] = { exports: fakeVscode, loaded: true };

console.log('=== 尝试加载 extension.js ===');
try {
  const ext = require(extPath);
  console.log('✓ 模块加载成功');
  console.log('  activate 类型:', typeof ext.activate);
  console.log('  deactivate 类型:', typeof ext.deactivate);

  // 尝试调用 activate(用假 context)
  console.log('\n=== 尝试 activate ===');
  const fakeContext = {
    extension: { id: 'howiitlee.vscode-file-guard', uri: { fsPath: extPath } },
    subscriptions: [],
    workspaceState: fakeVscode.workspace.workspaceState,
  };
  ext.activate(fakeContext);
  console.log('✓ activate 执行成功(无抛错)');
  console.log('  注册的 subscriptions:', fakeContext.subscriptions.length);
  // 扩展会启动定时器(setInterval), 显式退出避免 hang
  process.exit(0);
} catch (e) {
  console.log('✗ 加载/激活失败:', e.message);
  console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
