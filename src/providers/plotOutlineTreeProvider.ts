import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { computeSceneOrder, detectUnresolvedForeshadows } from '../core/plotAnalyzer';
import { parsePlotDocument } from '../core/serializer';
import { PlotDocument } from '../core/types';

export type OutlineTreeElement =
  | { kind: 'plot_file'; fileUri: vscode.Uri; doc: PlotDocument }
  | { kind: 'group'; label: string; groupType: 'scenes' | 'unresolved' | 'characters'; fileUri: vscode.Uri; doc: PlotDocument }
  | { kind: 'node_item'; fileUri: vscode.Uri; nodeId: string; title: string; description: string; iconId: string };

export class PlotOutlineTreeProvider implements vscode.TreeDataProvider<OutlineTreeElement> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    OutlineTreeElement | undefined | void
  >();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: OutlineTreeElement): vscode.TreeItem {
    if (element.kind === 'plot_file') {
      const item = new vscode.TreeItem(
        element.doc.title || path.basename(element.fileUri.fsPath),
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = path.basename(element.fileUri.fsPath);
      item.iconPath = new vscode.ThemeIcon('type-hierarchy-sub');
      item.command = {
        command: 'vscode.openWith',
        title: 'プロットを開く',
        arguments: [element.fileUri, 'nodePlot.editor'],
      };
      return item;
    }

    if (element.kind === 'group') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      const iconMap = {
        scenes: 'list-ordered',
        unresolved: 'warning',
        characters: 'organization',
      };
      item.iconPath = new vscode.ThemeIcon(iconMap[element.groupType]);
      return item;
    }

    const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.iconId);
    item.command = {
      command: 'nodePlot.focusNode',
      title: 'ノードへジャンプ',
      arguments: [element.fileUri, element.nodeId],
    };
    return item;
  }

  public getChildren(element?: OutlineTreeElement): OutlineTreeElement[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }

    if (!element) {
      const plotFiles: OutlineTreeElement[] = [];
      for (const folder of folders) {
        const files = this.findPlotFiles(folder.uri.fsPath);
        for (const f of files) {
          try {
            const content = fs.readFileSync(f, 'utf8');
            const doc = parsePlotDocument(content);
            plotFiles.push({
              kind: 'plot_file',
              fileUri: vscode.Uri.file(f),
              doc,
            });
          } catch {
            // ignore unreadable file
          }
        }
      }
      return plotFiles;
    }

    if (element.kind === 'plot_file') {
      const unresolved = detectUnresolvedForeshadows(element.doc);
      return [
        {
          kind: 'group',
          label: `時系列シーン順 (${element.doc.nodes.filter((n) => n.category === 'scene').length})`,
          groupType: 'scenes',
          fileUri: element.fileUri,
          doc: element.doc,
        },
        {
          kind: 'group',
          label: `未回収・未提示の伏線 (${unresolved.length})`,
          groupType: 'unresolved',
          fileUri: element.fileUri,
          doc: element.doc,
        },
        {
          kind: 'group',
          label: `キャラクター (${element.doc.nodes.filter((n) => n.category === 'character').length})`,
          groupType: 'characters',
          fileUri: element.fileUri,
          doc: element.doc,
        },
      ];
    }

    if (element.kind === 'group') {
      if (element.groupType === 'scenes') {
        const { orderedScenes } = computeSceneOrder(element.doc);
        return orderedScenes.map((scene, idx) => {
          const ch = scene.sceneParams?.chapter ? `[${scene.sceneParams.chapter}] ` : '';
          const tension = scene.sceneParams?.tension ?? 0;
          const tensionStr = tension > 0 ? `+${tension}` : `${tension}`;
          return {
            kind: 'node_item',
            fileUri: element.fileUri,
            nodeId: scene.id,
            title: `${idx + 1}. ${ch}${scene.title}`,
            description: `T:${tensionStr} ${scene.sceneParams?.manuscriptPath || ''}`.trim(),
            iconId: 'symbol-event',
          };
        });
      }

      if (element.groupType === 'unresolved') {
        const unresolved = detectUnresolvedForeshadows(element.doc);
        return unresolved.map((u) => ({
          kind: 'node_item',
          fileUri: element.fileUri,
          nodeId: u.sourceNodeId,
          title: u.title,
          description: u.statusLabel,
          iconId: 'warning',
        }));
      }

      if (element.groupType === 'characters') {
        return element.doc.nodes
          .filter((n) => n.category === 'character')
          .map((c) => ({
            kind: 'node_item',
            fileUri: element.fileUri,
            nodeId: c.id,
            title: c.title,
            description: c.characterParams?.role || '',
            iconId: 'account',
          }));
      }
    }

    return [];
  }

  private findPlotFiles(dirPath: string, depth = 0): string[] {
    if (depth > 2 || !fs.existsSync(dirPath)) {
      return [];
    }
    const results: string[] = [];
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const full = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.nplot')) {
        results.push(full);
      } else if (entry.isDirectory()) {
        results.push(...this.findPlotFiles(full, depth + 1));
      }
    }
    return results.sort();
  }
}
