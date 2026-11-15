import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  createInitialPlotDocument,
  parsePlotDocument,
  serializePlotDocument,
} from './core/serializer';
import {
  CompareHostToWebviewMessage,
  CompareWebviewToHostMessage,
} from './core/types';
import { buildPlotWebviewHtml, PlotEditorProvider } from './providers/plotEditorProvider';
import { PlotOutlineTreeProvider } from './providers/plotOutlineTreeProvider';
import { StatusBarProvider } from './providers/statusBarProvider';
import {
  BackupSnapshot,
  BackupStore,
  matchesSavedFile,
} from './services/backupService';
import {
  disablePlotFolderOnDisk,
  enablePlotFolderOnDisk,
  isPlotFolderEnabledOnDisk,
} from './services/workspaceService';

const BACKUP_DELAY_MS = 1500;
const BACKUP_SCHEME = 'nodeplot-backup';

function getPrimaryWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPlotFileName(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === '.nplot';
}

function isInsideFolder(filePath: string, folder: string): boolean {
  const rel = path.relative(folder, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readBackupSettings() {
  const cfg = vscode.workspace.getConfiguration('nodePlot.backup');
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    Math.max(
      min,
      Math.min(max, typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback)
    );
  return {
    enabled: cfg.get('enabled') !== false,
    maxSnapshots: num(cfg.get('maxSnapshots'), 50, 1, 500),
    snapshotIntervalMs: num(cfg.get('intervalMinutes'), 5, 1, 120) * 60_000,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const editorProvider = new PlotEditorProvider(context);
  const outlineTreeProvider = new PlotOutlineTreeProvider();
  const statusBarProvider = new StatusBarProvider();
  const backupStore = new BackupStore(path.join(context.globalStorageUri.fsPath, 'backups'));
  let folderEnabled = false;

  const updateFolderContext = () => {
    const folders = vscode.workspace.workspaceFolders;
    folderEnabled = Boolean(
      folders &&
        folders.some(
          (f) =>
            isPlotFolderEnabledOnDisk(f.uri.fsPath) ||
            fs.existsSync(path.join(f.uri.fsPath, '.genkou.json'))
        )
    );
    void vscode.commands.executeCommand('setContext', 'nodePlot.isFolderEnabled', folderEnabled);
    outlineTreeProvider.refresh();
  };

  // ── 自動バックアップ（genkou_sheet と同一仕様） ──
  const backupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const shouldBackup = (doc: vscode.TextDocument): boolean => {
    if (doc.uri.scheme !== 'file' || !isPlotFileName(doc.fileName)) {
      return false;
    }
    if (editorProvider.isOpenInPlotEditor(doc)) {
      return true;
    }
    const root = getPrimaryWorkspaceRoot();
    return Boolean(folderEnabled && root && isInsideFolder(doc.fileName, root));
  };

  const backupNow = (doc: vscode.TextDocument, forceNewSnapshot = false) => {
    const key = doc.uri.toString();
    const timer = backupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      backupTimers.delete(key);
    }
    const settings = readBackupSettings();
    if (!settings.enabled) {
      return;
    }
    const text = doc.getText();
    // 「保存しない」で閉じた際の revert で未保存の最新世代を上書きしないよう、ディスクと同じ内容は書き込まない。
    // ただし復元直前の退避（forceNewSnapshot）は必ず書き込む。
    if (!forceNewSnapshot && matchesSavedFile(doc.fileName, text)) {
      return;
    }
    try {
      backupStore.write(key, path.basename(doc.fileName), text, {
        ...settings,
        forceNewSnapshot,
      });
    } catch (err) {
      console.error('[Node Plot] backup failed:', err);
    }
  };

  const scheduleBackup = (doc: vscode.TextDocument) => {
    if (!shouldBackup(doc) || !readBackupSettings().enabled) {
      return;
    }
    const key = doc.uri.toString();
    const timer = backupTimers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    backupTimers.set(
      key,
      setTimeout(() => backupNow(doc), BACKUP_DELAY_MS)
    );
  };

  const flushAllBackups = () => {
    for (const key of [...backupTimers.keys()]) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
      if (doc) {
        backupNow(doc);
      }
    }
  };

  // 差分表示用の読み取り専用文書（nodeplot-backup: スキーム）。
  // パスを .nplot で終わらせないことで、カスタムエディタではなく標準のテキスト差分画面で開く。
  const currentTexts = new Map<string, string>();
  let currentSeq = 0;

  const backupContentProvider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) {
      const [dir, name] = uri.path.replace(/^\//, '').split('/');
      if (dir === 'current') {
        return currentTexts.get(name) ?? '';
      }
      const snapshot = backupStore
        .listSnapshotsByKey(dir)
        .find((s) => path.basename(s.filePath) === `${name}.nplot`);
      return snapshot ? backupStore.readSnapshot(snapshot) : '';
    },
  };

  const diffQuery = (target: string, displayName: string) =>
    new URLSearchParams({ target, name: displayName }).toString();

  const snapshotUri = (s: BackupSnapshot, target: string, displayName: string) =>
    vscode.Uri.from({
      scheme: BACKUP_SCHEME,
      path: `/${s.key}/${path.basename(s.filePath, '.nplot')}`,
      query: diffQuery(target, displayName),
    });

  const currentUri = (text: string, target: string, displayName: string) => {
    const id = String(++currentSeq);
    currentTexts.set(id, text);
    return vscode.Uri.from({
      scheme: BACKUP_SCHEME,
      path: `/current/${id}`,
      query: diffQuery(target, displayName),
    });
  };

  /** プロットをバックアップの内容に置き換える（Undo可能。置き換え前の内容も新世代として退避） */
  const restoreSnapshotText = async (
    target: vscode.Uri,
    text: string,
    displayName: string
  ): Promise<boolean> => {
    const doc = await vscode.workspace.openTextDocument(target);
    backupNow(doc, true);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      doc.uri,
      new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
      text
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      return false;
    }
    void vscode.window.showInformationMessage(
      `「${displayName}」をバックアップの内容に戻しました。確認後に保存してください。`
    );
    return true;
  };

  interface BackupDiffInfo {
    snapshot: vscode.Uri;
    target: vscode.Uri;
    displayName: string;
  }

  const diffInfoFrom = (snapshot: vscode.Uri): BackupDiffInfo | undefined => {
    const params = new URLSearchParams(snapshot.query);
    const target = params.get('target');
    return target
      ? {
          snapshot,
          target: vscode.Uri.parse(target),
          displayName:
            params.get('name') || path.basename(vscode.Uri.parse(target).path),
        }
      : undefined;
  };

  const activeBackupDiff = (): BackupDiffInfo | undefined => {
    const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input;
    return input instanceof vscode.TabInputTextDiff &&
      input.original.scheme === BACKUP_SCHEME
      ? diffInfoFrom(input.original)
      : undefined;
  };

  const syncBackupDiffContext = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'nodePlot.backupDiffActive',
      Boolean(activeBackupDiff())
    );
  };

  const applyBackup = async (diff: BackupDiffInfo) => {
    const choice = await vscode.window.showWarningMessage(
      `「${diff.displayName}」の全体を、左側のバックアップの内容に置き換えますか？（元に戻す (Undo) で取り消せます）`,
      { modal: true },
      '置き換える'
    );
    if (choice !== '置き換える') {
      return;
    }
    try {
      const text = await backupContentProvider.provideTextDocumentContent(
        diff.snapshot,
        new vscode.CancellationTokenSource().token
      );
      await restoreSnapshotText(diff.target, text ?? '', diff.displayName);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `バックアップを復元できませんでした: ${errorMessage(err)}`
      );
    }
  };

  const applyBackupInDiff = async () => {
    const diff = activeBackupDiff();
    if (!diff) {
      void vscode.window.showWarningMessage(
        'バックアップとの差分画面を開いてから実行してください。'
      );
      return;
    }
    await applyBackup(diff);
  };

  /**
   * バックアップと現在のプロットを、プロットキャンバス2画面の並列表示で比較する。
   * 左右は連動してパン・ズームし、差分のあるノードを強調表示する。
   */
  const openComparePanel = (info: {
    target: vscode.Uri;
    displayName: string;
    backupText: string;
    backupTime: number;
    currentText: string;
  }) => {
    const panel = vscode.window.createWebviewPanel(
      'nodePlot.compare',
      `${info.displayName}（バックアップと比較）`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );
    panel.webview.html = buildPlotWebviewHtml(
      panel.webview,
      context.extensionUri,
      'compare.js',
      'バックアップと比較'
    );
    const message: CompareHostToWebviewMessage = {
      type: 'INIT_COMPARE',
      config: editorProvider.readWorkspaceConfig(),
      fileName: info.displayName,
      left: {
        label: 'バックアップ',
        detail: new Date(info.backupTime).toLocaleString('ja-JP'),
        text: info.backupText,
        adoptLabel: 'こちら（バックアップ）を採用',
      },
      right: {
        label: '現在のプロット',
        detail: '比較を開いた時点',
        text: info.currentText,
        adoptLabel: 'こちら（現在のプロット）を採用',
      },
    };
    panel.webview.onDidReceiveMessage(async (msg: CompareWebviewToHostMessage) => {
      if (msg.type === 'COMPARE_READY') {
        void panel.webview.postMessage(message);
      } else if (msg.type === 'ADOPT') {
        if (msg.side === 'right') {
          panel.dispose();
          void vscode.window.showInformationMessage(
            `「${info.displayName}」は現在の内容のまま変更していません。`
          );
          return;
        }
        try {
          if (await restoreSnapshotText(info.target, info.backupText, info.displayName)) {
            panel.dispose();
          }
        } catch (err) {
          void vscode.window.showErrorMessage(
            `バックアップを復元できませんでした: ${errorMessage(err)}`
          );
        }
      }
    });
  };

  const restoreBackup = async () => {
    const activeDoc =
      editorProvider.getActiveDocument() ?? vscode.window.activeTextEditor?.document;
    let sourceUri =
      activeDoc && isPlotFileName(activeDoc.fileName)
        ? activeDoc.uri.toString()
        : undefined;
    let displayName = activeDoc ? path.basename(activeDoc.fileName) : '';
    let snapshots = sourceUri ? backupStore.listSnapshots(sourceUri) : [];

    if (snapshots.length === 0) {
      const entries = backupStore.listEntries();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage(
          '復元できるバックアップはまだありません。'
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((e) => ({
          label: `$(type-hierarchy-sub) ${e.displayName}`,
          description: new Date(e.updatedAt).toLocaleString('ja-JP'),
          detail: e.sourceUri.startsWith('file:')
            ? vscode.Uri.parse(e.sourceUri).fsPath
            : e.sourceUri,
          entry: e,
        })),
        { title: 'バックアップから復元: プロットを選択', matchOnDetail: true }
      );
      if (!picked) {
        return;
      }
      sourceUri = picked.entry.sourceUri;
      displayName = picked.entry.displayName;
      snapshots = backupStore.listSnapshotsByKey(picked.entry.key);
    }

    let currentText: string | undefined;
    if (sourceUri) {
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === sourceUri
      );
      if (openDoc) {
        currentText = openDoc.getText();
      } else {
        const uri = vscode.Uri.parse(sourceUri);
        try {
          if (uri.scheme === 'file') {
            currentText = fs.readFileSync(uri.fsPath, 'utf-8');
          }
        } catch {
          // 削除済みなど
        }
      }
    }

    const snapshotItems = snapshots.map((s) => {
      let text = '';
      try {
        text = backupStore.readSnapshot(s);
      } catch {
        // ignore unreadable snapshot
      }
      const parsed = parsePlotDocument(text);
      const sceneNames = parsed.nodes
        .filter((n) => n.category === 'scene')
        .map((n) => n.title)
        .slice(0, 3)
        .join(' → ');
      return {
        label: `$(history) ${new Date(s.updatedAt).toLocaleString('ja-JP')}`,
        description: `ノード ${parsed.nodes.length}件・エッジ ${parsed.edges.length}件${
          text === currentText ? '（現在のプロットと同じ）' : ''
        }`,
        detail: `${parsed.title}${sceneNames ? ` | ${sceneNames}` : ''}`.slice(0, 80),
        snapshot: s,
        text,
      };
    });

    const pickedSnapshot = await vscode.window.showQuickPick(snapshotItems, {
      title: `バックアップから復元: ${displayName}（新しい順）`,
    });
    if (!pickedSnapshot || !sourceUri) {
      return;
    }

    const target = vscode.Uri.parse(sourceUri);
    const targetExists = target.scheme === 'file' && fs.existsSync(target.fsPath);
    const actions = [
      ...(targetExists
        ? [
            {
              label: '$(type-hierarchy-sub) プロットキャンバス2画面で比較して、どちらかを採用',
              description: '左右連動・変更のあるノードを強調表示',
              id: 'compare' as const,
            },
            {
              label: '$(diff) JSONテキストの差分を表示',
              id: 'diff' as const,
            },
            {
              label: '$(discard) プロットをこの内容に戻す',
              description: '元に戻す (Undo) で取り消せます',
              id: 'restore' as const,
            },
          ]
        : []),
      { label: '$(new-file) 新しい未保存タブで開く', id: 'open' as const },
    ];
    const action = await vscode.window.showQuickPick(actions, {
      title: 'バックアップの操作を選択',
    });
    if (!action) {
      return;
    }

    try {
      if (action.id === 'compare') {
        openComparePanel({
          target,
          displayName,
          backupText: pickedSnapshot.text,
          backupTime: pickedSnapshot.snapshot.updatedAt,
          currentText: currentText ?? '',
        });
      } else if (action.id === 'diff') {
        if (pickedSnapshot.text === currentText) {
          void vscode.window.showInformationMessage(
            'このバックアップは現在のプロットと同じ内容です。より古い日時のバックアップを選ぶと差分を確認できます。'
          );
          return;
        }
        const left = snapshotUri(pickedSnapshot.snapshot, sourceUri, displayName);
        await vscode.commands.executeCommand(
          'vscode.diff',
          left,
          currentUri(currentText ?? '', sourceUri, displayName),
          `${displayName}（バックアップ ↔ 現在）`
        );
        syncBackupDiffContext();
        const replace = '全体をこのバックアップに置き換える';
        const picked = await vscode.window.showInformationMessage(
          '左がバックアップ、右が差分を開いた時点のプロットです。全体を戻すには、このボタンか差分画面右上のボタンを押してください。',
          replace
        );
        if (picked === replace) {
          const info = diffInfoFrom(left);
          if (info) {
            await applyBackup(info);
          }
        }
      } else if (action.id === 'restore') {
        await restoreSnapshotText(target, pickedSnapshot.text, displayName);
      } else {
        const doc = await vscode.workspace.openTextDocument({
          content: pickedSnapshot.text,
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (err) {
      void vscode.window.showErrorMessage(
        `バックアップを復元できませんでした: ${errorMessage(err)}`
      );
    }
  };

  updateFolderContext();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      BACKUP_SCHEME,
      backupContentProvider
    ),
    vscode.window.registerCustomEditorProvider(PlotEditorProvider.viewType, editorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider('nodePlot.outlineTree', outlineTreeProvider),
    statusBarProvider,
    editorProvider.onDidUpdatePlotDocument((doc) => {
      statusBarProvider.updateForDocument(doc);
      outlineTreeProvider.refresh();
    })
  );

  if (vscode.window.tabGroups) {
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs(syncBackupDiffContext),
      vscode.window.tabGroups.onDidChangeTabGroups(syncBackupDiffContext)
    );
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(syncBackupDiffContext),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length > 0) {
        scheduleBackup(e.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === BACKUP_SCHEME && doc.uri.path.startsWith('/current/')) {
        currentTexts.delete(doc.uri.path.slice('/current/'.length));
      }
      if (backupTimers.has(doc.uri.toString())) {
        backupNow(doc);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (backupTimers.has(doc.uri.toString())) {
        backupNow(doc);
      }
      outlineTreeProvider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(updateFolderContext),
    { dispose: flushAllBackups },

    vscode.commands.registerCommand('nodePlot.enableFolder', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage('先にフォルダーをワークスペースとして開いてください。');
        return;
      }
      const { samplePlotPath } = enablePlotFolderOnDisk(folder.uri.fsPath, true);
      updateFolderContext();
      if (samplePlotPath) {
        const uri = vscode.Uri.file(samplePlotPath);
        await vscode.commands.executeCommand('vscode.openWith', uri, PlotEditorProvider.viewType);
      }
      vscode.window.showInformationMessage('このフォルダーをプロットプロジェクトとして有効化しました。');
    }),

    vscode.commands.registerCommand('nodePlot.disableFolder', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return;
      }
      disablePlotFolderOnDisk(folder.uri.fsPath);
      updateFolderContext();
      vscode.window.showInformationMessage('プロットプロジェクト設定を解除しました。');
    }),

    vscode.commands.registerCommand('nodePlot.createPlotFile', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const defaultUri = folder
        ? vscode.Uri.joinPath(folder.uri, 'new_plot.nplot')
        : undefined;
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'Node Plot File': ['nplot'] },
        title: '新規プロットファイル (.nplot) の作成',
      });
      if (!saveUri) {
        return;
      }
      const title = path.basename(saveUri.fsPath, '.nplot');
      const initialDoc = createInitialPlotDocument(title);
      fs.writeFileSync(saveUri.fsPath, serializePlotDocument(initialDoc), 'utf8');
      updateFolderContext();
      await vscode.commands.executeCommand('vscode.openWith', saveUri, PlotEditorProvider.viewType);
    }),

    vscode.commands.registerCommand('nodePlot.exportMarkdown', async () => {
      const active = editorProvider.getActivePlotDocument();
      if (!active) {
        vscode.window.showInformationMessage('先にプロットファイル (.nplot) を開いてください。');
        return;
      }
      await editorProvider.exportPlotAsMarkdown(active.uri, active.doc);
    }),

    vscode.commands.registerCommand('nodePlot.syncGenkouOrder', async () => {
      const active = editorProvider.getActivePlotDocument();
      if (!active) {
        vscode.window.showInformationMessage('先にプロットファイル (.nplot) を開いてください。');
        return;
      }
      await editorProvider.syncGenkouFromPlot(active.uri, active.doc);
    }),

    vscode.commands.registerCommand('nodePlot.focusNode', async (uri: vscode.Uri, nodeId: string) => {
      await vscode.commands.executeCommand('vscode.openWith', uri, PlotEditorProvider.viewType);
      editorProvider.focusNodeInEditor(uri, nodeId);
    }),

    vscode.commands.registerCommand('nodePlot.refreshTree', () => {
      outlineTreeProvider.refresh();
    }),

    vscode.commands.registerCommand('nodePlot.restoreBackup', restoreBackup),
    vscode.commands.registerCommand('nodePlot.applyBackupInDiff', applyBackupInDiff)
  );
}

export function deactivate(): void {}
