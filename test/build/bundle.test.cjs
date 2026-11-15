const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { describe, it } = require('node:test');

describe('Production Bundle Verification (dist/)', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const extBundle = path.join(rootDir, 'dist', 'extension.js');
  const webviewBundle = path.join(rootDir, 'dist', 'webview.js');
  const compareBundle = path.join(rootDir, 'dist', 'compare.js');
  const themeCss = path.join(rootDir, 'dist', 'globalTheme.css');

  it('dist/extension.js, dist/webview.js, dist/compare.js, dist/globalTheme.css が生成されサイズ制限内である', () => {
    assert.ok(fs.existsSync(extBundle), 'dist/extension.js should exist');
    assert.ok(fs.existsSync(webviewBundle), 'dist/webview.js should exist');
    assert.ok(fs.existsSync(compareBundle), 'dist/compare.js should exist');
    assert.ok(fs.existsSync(themeCss), 'dist/globalTheme.css should exist');

    assert.ok(fs.statSync(extBundle).size < 200 * 1024);
    assert.ok(fs.statSync(webviewBundle).size < 200 * 1024);
    assert.ok(fs.statSync(compareBundle).size < 200 * 1024);
  });

  it('dist/extension.js がモック vscode 環境で正常にロードされ全コマンド・プロバイダを登録する', () => {
    const registeredCommands = [];
    const registeredCustomEditors = [];
    const registeredTrees = [];
    const registeredContentProviders = [];

    const vscodeMock = {
      window: {
        createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
        registerCustomEditorProvider: (viewType) => {
          registeredCustomEditors.push(viewType);
          return { dispose() {} };
        },
        registerTreeDataProvider: (id) => {
          registeredTrees.push(id);
          return { dispose() {} };
        },
        onDidChangeActiveTextEditor: () => ({ dispose() {} }),
        tabGroups: {
          onDidChangeTabs: () => ({ dispose() {} }),
          onDidChangeTabGroups: () => ({ dispose() {} }),
        },
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
      },
      workspace: {
        workspaceFolders: [],
        textDocuments: [],
        getConfiguration: () => ({
          get: (_k, def) => def,
          update: async () => undefined,
        }),
        registerTextDocumentContentProvider: (scheme) => {
          registeredContentProviders.push(scheme);
          return { dispose() {} };
        },
        onDidChangeTextDocument: () => ({ dispose() {} }),
        onDidCloseTextDocument: () => ({ dispose() {} }),
        onDidSaveTextDocument: () => ({ dispose() {} }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      },
      commands: {
        registerCommand: (cmd) => {
          registeredCommands.push(cmd);
          return { dispose() {} };
        },
        executeCommand: async () => undefined,
      },
      EventEmitter: class {
        constructor() {
          this.event = () => ({ dispose() {} });
        }
        fire() {}
      },
      StatusBarAlignment: { Right: 2 },
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      TreeItem: class {},
      ThemeIcon: class {},
      TabInputTextDiff: class {},
      Uri: {
        file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
        joinPath: (base, ...segs) => ({
          fsPath: path.join(base.fsPath || '', ...segs),
        }),
      },
    };

    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') {
        return vscodeMock;
      }
      return originalLoad.apply(this, [request, parent, isMain]);
    };

    try {
      const ext = require(extBundle);
      const subscriptions = [];
      ext.activate({
        subscriptions,
        extensionUri: { fsPath: rootDir },
        globalStorageUri: { fsPath: path.join(rootDir, '.tmp_storage') },
      });

      assert.ok(registeredCustomEditors.includes('nodePlot.editor'));
      assert.ok(registeredTrees.includes('nodePlot.outlineTree'));
      assert.ok(registeredContentProviders.includes('nodeplot-backup'));
      assert.ok(registeredCommands.includes('nodePlot.enableFolder'));
      assert.ok(registeredCommands.includes('nodePlot.createPlotFile'));
      assert.ok(registeredCommands.includes('nodePlot.exportMarkdown'));
      assert.ok(registeredCommands.includes('nodePlot.syncGenkouOrder'));
      assert.ok(registeredCommands.includes('nodePlot.restoreBackup'));
      assert.ok(registeredCommands.includes('nodePlot.applyBackupInDiff'));
    } finally {
      Module._load = originalLoad;
    }
  });
});
