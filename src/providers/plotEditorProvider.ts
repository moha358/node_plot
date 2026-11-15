import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  computeMinimalTextEdit,
  parsePlotDocument,
  serializePlotDocument,
} from '../core/serializer';
import { sanitizePlotConfig } from '../core/theme';
import {
  HostToWebviewMessage,
  PlotConfig,
  PlotDocument,
  WebviewToHostMessage,
} from '../core/types';
import {
  generateMarkdownOutline,
  resolveSafeManuscriptPath,
  syncSceneOrderToGenkouFile,
} from '../services/exportService';

export function buildPlotWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  scriptFileName: 'webview.js' | 'compare.js',
  title = 'Node Plot'
): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'globalTheme.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', scriptFileName)
  );

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body data-theme="dark">
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export class PlotEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'nodePlot.editor';

  private readonly activeWebviews = new Map<string, Set<vscode.WebviewPanel>>();
  private activeDocumentUri: vscode.Uri | undefined;
  private readonly onDocumentUpdatedEmitter = new vscode.EventEmitter<vscode.TextDocument>();
  public readonly onDidUpdatePlotDocument = this.onDocumentUpdatedEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public isOpenInPlotEditor(doc: vscode.TextDocument): boolean {
    const panels = this.activeWebviews.get(doc.uri.toString());
    return Boolean(panels && panels.size > 0);
  }

  public getActiveDocument(): vscode.TextDocument | undefined {
    const targetUri = this.activeDocumentUri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      return undefined;
    }
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === targetUri.toString() && d.fileName.endsWith('.nplot')
    );
  }

  public getActivePlotDocument(): { uri: vscode.Uri; doc: PlotDocument } | undefined {
    const textDoc = this.getActiveDocument();
    if (!textDoc) {
      return undefined;
    }
    return {
      uri: textDoc.uri,
      doc: parsePlotDocument(textDoc.getText()),
    };
  }

  public focusNodeInEditor(uri: vscode.Uri, nodeId: string): void {
    const panels = this.activeWebviews.get(uri.toString());
    if (!panels) {
      return;
    }
    const msg: HostToWebviewMessage = { type: 'FOCUS_NODE', nodeId };
    for (const panel of panels) {
      panel.webview.postMessage(msg);
    }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docKey = document.uri.toString();
    if (!this.activeWebviews.has(docKey)) {
      this.activeWebviews.set(docKey, new Set());
    }
    this.activeWebviews.get(docKey)!.add(webviewPanel);
    this.activeDocumentUri = document.uri;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    webviewPanel.webview.html = buildPlotWebviewHtml(
      webviewPanel.webview,
      this.context.extensionUri,
      'webview.js'
    );

    let isApplyingWebviewEdit = false;

    const postMessage = (msg: HostToWebviewMessage) => {
      webviewPanel.webview.postMessage(msg);
    };

    const msgSub = webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewToHostMessage) => {
        switch (message.type) {
          case 'READY': {
            postMessage({
              type: 'INIT_DOCUMENT',
              document: parsePlotDocument(document.getText()),
              config: this.readWorkspaceConfig(),
              version: document.version,
              fileName: path.basename(document.fileName),
            });
            this.onDocumentUpdatedEmitter.fire(document);
            break;
          }
          case 'UPDATE_DOCUMENT': {
            const newText = serializePlotDocument(message.document);
            const currentText = document.getText();
            const minimalEdit = computeMinimalTextEdit(currentText, newText);
            if (!minimalEdit) {
              postMessage({
                type: 'EDIT_RESULT',
                version: document.version,
                accepted: true,
              });
              return;
            }

            isApplyingWebviewEdit = true;
            try {
              const edit = new vscode.WorkspaceEdit();
              const range = new vscode.Range(
                document.positionAt(minimalEdit.startOffset),
                document.positionAt(minimalEdit.endOffset)
              );
              edit.replace(document.uri, range, minimalEdit.replacement);
              const applied = await vscode.workspace.applyEdit(edit);
              postMessage({
                type: 'EDIT_RESULT',
                version: document.version,
                accepted: applied,
                document: applied ? undefined : parsePlotDocument(document.getText()),
              });
              if (applied) {
                this.onDocumentUpdatedEmitter.fire(document);
              }
            } finally {
              isApplyingWebviewEdit = false;
            }
            break;
          }
          case 'UPDATE_CONFIG': {
            await this.applyPartialConfig(message.partialConfig);
            break;
          }
          case 'OPEN_MANUSCRIPT': {
            await this.handleOpenManuscript(
              document.uri,
              message.manuscriptPath,
              message.sceneTitle,
              message.createIfMissing
            );
            break;
          }
          case 'REQUEST_EXPORT': {
            const plotDoc = parsePlotDocument(document.getText());
            if (message.format === 'markdown') {
              await this.exportPlotAsMarkdown(document.uri, plotDoc);
            } else if (message.format === 'sync_genkou') {
              await this.syncGenkouFromPlot(document.uri, plotDoc);
            }
            break;
          }
          case 'REQUEST_RESTORE_BACKUP': {
            await vscode.commands.executeCommand('nodePlot.restoreBackup');
            break;
          }
        }
      }
    );

    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      this.onDocumentUpdatedEmitter.fire(e.document);
      if (isApplyingWebviewEdit || e.contentChanges.length === 0) {
        return;
      }
      postMessage({
        type: 'DOCUMENT_CHANGED',
        document: parsePlotDocument(e.document.getText()),
        version: e.document.version,
      });
    });

    const configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('nodePlot')) {
        postMessage({
          type: 'CONFIG_CHANGED',
          config: this.readWorkspaceConfig(),
        });
      }
    });

    const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.activeDocumentUri = document.uri;
        this.onDocumentUpdatedEmitter.fire(document);
      }
    });

    webviewPanel.onDidDispose(() => {
      msgSub.dispose();
      docChangeSub.dispose();
      configChangeSub.dispose();
      viewStateSub.dispose();
      this.activeWebviews.get(docKey)?.delete(webviewPanel);
    });
  }

  public readWorkspaceConfig(): PlotConfig {
    const cfg = vscode.workspace.getConfiguration('nodePlot');
    return sanitizePlotConfig({
      enabled: cfg.get('enabled'),
      theme: cfg.get('theme'),
      snapToGrid: cfg.get('snapToGrid'),
      gridSize: cfg.get('gridSize'),
    });
  }

  private async applyPartialConfig(partial: Partial<PlotConfig>): Promise<void> {
    const sanitized = sanitizePlotConfig({
      ...this.readWorkspaceConfig(),
      ...partial,
    });
    const cfg = vscode.workspace.getConfiguration('nodePlot');
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

    if (partial.theme !== undefined) {
      await cfg.update('theme', sanitized.theme, target);
    }
    if (partial.snapToGrid !== undefined) {
      await cfg.update('snapToGrid', sanitized.snapToGrid, target);
    }
    if (partial.gridSize !== undefined) {
      await cfg.update('gridSize', sanitized.gridSize, target);
    }
  }

  private async handleOpenManuscript(
    plotUri: vscode.Uri,
    manuscriptPath: string,
    sceneTitle: string,
    createIfMissing: boolean
  ): Promise<void> {
    const folderPath = path.dirname(plotUri.fsPath);
    const resolved = resolveSafeManuscriptPath(folderPath, manuscriptPath);
    if (!resolved) {
      vscode.window.showWarningMessage(
        '原稿ファイルパスが未指定か、プロットフォルダー外のパスです。インスペクタで相対パス（例: 01_opening.txt）を指定してください。'
      );
      return;
    }

    if (!fs.existsSync(resolved)) {
      if (!createIfMissing) {
        const choice = await vscode.window.showInformationMessage(
          `原稿ファイル「${manuscriptPath}」はまだ存在しません。新規作成して開きますか？`,
          '作成して開く',
          'キャンセル'
        );
        if (choice !== '作成して開く') {
          return;
        }
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `　${sceneTitle}\n\n　`, 'utf8');
    }

    const fileUri = vscode.Uri.file(resolved);
    const genkouConfigExists = fs.existsSync(path.join(folderPath, '.genkou.json'));
    if (genkouConfigExists) {
      try {
        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'genkouSheet.editor');
        return;
      } catch {
        // Genkou Sheet 未導入時は通常エディタへフォールバック
      }
    }
    await vscode.window.showTextDocument(fileUri);
  }

  public async exportPlotAsMarkdown(plotUri: vscode.Uri, doc: PlotDocument): Promise<void> {
    const md = generateMarkdownOutline(doc);
    const defaultName = path.basename(plotUri.fsPath, '.nplot') + '_outline.md';
    const defaultUri = vscode.Uri.file(path.join(path.dirname(plotUri.fsPath), defaultName));

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Markdown: ['md'] },
      title: 'プロット構成案 (Markdown) の保存先を選択',
    });
    if (!saveUri) {
      return;
    }
    fs.writeFileSync(saveUri.fsPath, md, 'utf8');
    const docOpened = await vscode.workspace.openTextDocument(saveUri);
    await vscode.window.showTextDocument(docOpened, { preview: false });
  }

  public async syncGenkouFromPlot(plotUri: vscode.Uri, doc: PlotDocument): Promise<void> {
    const folderPath = path.dirname(plotUri.fsPath);
    const { orderedFiles } = syncSceneOrderToGenkouFile(folderPath, doc);
    vscode.window.showInformationMessage(
      `Genkou Sheet (.genkou.json) の原稿順序に ${orderedFiles.length} 件のファイルを同期しました。`
    );
  }
}
