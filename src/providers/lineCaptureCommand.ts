import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  addLines,
  createLine,
  findSceneByManuscriptFile,
  parseLineCaptureText,
  parseSpeakerSwitch,
  speakerDisplayName,
} from '../core/lineShelf';
import {
  computeMinimalTextEdit,
  serializePlotDocument,
  tryParsePlotDocument,
} from '../core/serializer';
import { PlotDocument } from '../core/types';
import { PlotEditorProvider } from './plotEditorProvider';

const UNASSIGNED = '';

/** 直近に使った話者（プロットファイルごと）。次回の QuickPick で先頭に出す。 */
const lastSpeakerByPlot = new Map<string, string>();

async function pickPlotFile(editorProvider: PlotEditorProvider): Promise<vscode.Uri | undefined> {
  const active = editorProvider.getActiveDocument();
  if (active) {
    return active.uri;
  }
  const open = vscode.workspace.textDocuments.filter((d) => d.fileName.endsWith('.nplot'));
  const candidates = open.length > 0 ? open.map((d) => d.uri) : await vscode.workspace.findFiles('**/*.nplot', '**/node_modules/**', 50);
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage('プロットファイル (.nplot) が見つかりません。先に作成してください。');
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({ label: path.basename(uri.fsPath), description: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: 'セリフを書き留めるプロットファイルを選択' }
  );
  return picked?.uri;
}

function readPlot(textDoc: vscode.TextDocument): PlotDocument | undefined {
  const result = tryParsePlotDocument(textDoc.getText());
  if (!result.ok) {
    void vscode.window.showErrorMessage(
      `プロットファイルの JSON が壊れているため、セリフを追加できません（${result.error}）。`
    );
    return undefined;
  }
  return result.document;
}

/**
 * 「Node Plot: セリフを書き留める」コマンド。
 * キャンバスを開かずに（原稿執筆中でも）話者を選んでセリフを連続入力し、プロットのセリフ棚へ追加する。
 * 原稿ファイルを開いている場合は、その原稿に対応するシーンを候補として付ける。
 */
export async function captureLinesCommand(editorProvider: PlotEditorProvider): Promise<void> {
  const uri = await pickPlotFile(editorProvider);
  if (!uri) {
    return;
  }
  const textDoc = await vscode.workspace.openTextDocument(uri);
  const initial = readPlot(textDoc);
  if (!initial) {
    return;
  }

  // 原稿執筆中なら、その原稿のシーンを候補に付ける
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  let candidateSceneId: string | undefined;
  let candidateSceneTitle = '';
  if (activeFile && activeFile.scheme === 'file' && !activeFile.fsPath.endsWith('.nplot')) {
    const rel = path.relative(path.dirname(uri.fsPath), activeFile.fsPath);
    const scene = findSceneByManuscriptFile(initial, rel);
    if (scene) {
      candidateSceneId = scene.id;
      candidateSceneTitle = scene.title;
    }
  }

  const characters = initial.nodes.filter((n) => n.category === 'character');
  const last = lastSpeakerByPlot.get(uri.toString()) ?? UNASSIGNED;
  type SpeakerItem = vscode.QuickPickItem & { speakerId: string };
  const items: SpeakerItem[] = [
    ...characters.map((c) => ({
      label: speakerDisplayName(c),
      description: c.characterParams?.role ?? '',
      speakerId: c.id,
    })),
    { label: '話者未定', description: '後で決める', speakerId: UNASSIGNED },
  ];
  items.sort((a, b) => Number(b.speakerId === last) - Number(a.speakerId === last));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: candidateSceneId
      ? `話者を選択（シーン「${candidateSceneTitle}」の候補として追加）`
      : '話者を選択',
  });
  if (!picked) {
    return;
  }

  let speakerId = picked.speakerId;
  let added = 0;
  for (;;) {
    const speaker = characters.find((c) => c.id === speakerId);
    const text = await vscode.window.showInputBox({
      title: `セリフを書き留める — ${speakerDisplayName(speaker)}${added > 0 ? `（${added} 件追加済み）` : ''}`,
      prompt: 'Enter で追加して続けて入力／Esc で終了。「@名前 本文」で話者を切り替え、末尾の「// メモ」はメモ欄へ。',
      placeHolder: `${speakerDisplayName(speaker)}が言いそうなセリフ`,
      ignoreFocusOut: true,
    });
    if (text === undefined || !text.trim()) {
      break;
    }

    // 入力のたびに最新の内容を読み直す（キャンバス側の編集と競合させない）
    const current = readPlot(textDoc);
    if (!current) {
      break;
    }
    const currentChars = current.nodes.filter((n) => n.category === 'character');
    const parsed = parseLineCaptureText(text, currentChars, speakerId);
    if (parsed.length === 0) {
      // `@名前` だけの入力：話者の切り替えのみ
      speakerId = parseSpeakerSwitch(text, currentChars) ?? speakerId;
      continue;
    }
    const lines = parsed.map((p) => {
      const line = createLine({ speakerId: p.speakerId, text: p.text, note: p.note });
      if (candidateSceneId) {
        line.candidateSceneIds = [candidateSceneId];
      }
      return line;
    });
    const next = addLines(current, lines);
    const oldText = textDoc.getText();
    const minimal = computeMinimalTextEdit(oldText, serializePlotDocument(next));
    if (minimal) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        textDoc.uri,
        new vscode.Range(textDoc.positionAt(minimal.startOffset), textDoc.positionAt(minimal.endOffset)),
        minimal.replacement
      );
      if (!(await vscode.workspace.applyEdit(edit))) {
        void vscode.window.showErrorMessage('セリフをプロットファイルへ追加できませんでした。');
        break;
      }
    }
    added += lines.length;
    speakerId = parsed[parsed.length - 1].speakerId;
    lastSpeakerByPlot.set(uri.toString(), speakerId);
  }

  if (added === 0) {
    return;
  }
  // どのエディタにも表示されていないプロットは、変更が埋もれないよう保存しておく
  const visible =
    editorProvider.isOpenInPlotEditor(textDoc) ||
    vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === textDoc.uri.toString());
  if (!visible) {
    await textDoc.save();
  }
  void vscode.window.showInformationMessage(
    `${path.basename(uri.fsPath)} のセリフ棚に ${added} 件書き留めました${candidateSceneId ? `（「${candidateSceneTitle}」の候補）` : ''}。`
  );
}
