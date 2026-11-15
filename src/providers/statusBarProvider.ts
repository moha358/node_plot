import * as vscode from 'vscode';
import { summarizePlotStats } from '../core/plotAnalyzer';
import { parsePlotDocument } from '../core/serializer';

export class StatusBarProvider implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'nodePlot.exportMarkdown';
  }

  public updateForDocument(document: vscode.TextDocument | undefined): void {
    if (!document || !document.fileName.endsWith('.nplot')) {
      this.item.hide();
      return;
    }

    const plotDoc = parsePlotDocument(document.getText());
    const stats = summarizePlotStats(plotDoc);

    const hintBadge =
      stats.unresolvedForeshadowCount > 0
        ? `$(warning) 未回収伏線:${stats.unresolvedForeshadowCount}`
        : `$(check) 伏線OK`;

    this.item.text = `$(type-hierarchy-sub) シーン:${stats.sceneCount} / 人物:${stats.characterCount} / ${hintBadge}`;
    this.item.tooltip = `Node Plot: 総ノード ${stats.totalNodes}件（クリックで時系列構成案をMarkdown出力）`;
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }
}
