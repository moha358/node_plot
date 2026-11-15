import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeSceneOrder,
  detectUnresolvedForeshadows,
  getForeshadowNodeStatus,
  getSceneConnectedElements,
} from '../core/plotAnalyzer';
import { PlotDocument } from '../core/types';

/**
 * プロットドキュメントから時系列順の構成案（Markdown）を生成する。
 * `genkou_sheet` での執筆時のリファレンスや構成チェックシートとしてそのまま利用できる。
 */
export function generateMarkdownOutline(doc: PlotDocument): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title || '物語プロット構成案'}`);
  lines.push('');

  if (doc.synopsis.trim()) {
    lines.push('## ログライン・あらすじ');
    lines.push(doc.synopsis.trim());
    lines.push('');
  }

  const characters = doc.nodes.filter((n) => n.category === 'character');
  if (characters.length > 0) {
    lines.push('## 登場人物一覧');
    for (const c of characters) {
      const role = c.characterParams?.role ? `（${c.characterParams.role}）` : '';
      lines.push(`### ${c.title}${role}`);
      if (c.body.trim()) {
        lines.push(c.body.trim());
      }
      if (c.characterParams?.goal) {
        lines.push(`- **目的・動機:** ${c.characterParams.goal}`);
      }
      if (c.characterParams?.flaw) {
        lines.push(`- **秘密・葛藤:** ${c.characterParams.flaw}`);
      }
      for (const cp of c.customParams) {
        lines.push(`- **${cp.key}:** ${cp.value}`);
      }
      lines.push('');
    }
  }

  const { orderedScenes, hasCycle } = computeSceneOrder(doc);
  lines.push('## 時系列シーン構成');
  if (hasCycle) {
    lines.push('> [!WARNING] シーンのフロー接続に循環（ループ）が含まれています。');
    lines.push('');
  }

  if (orderedScenes.length === 0) {
    lines.push('_シーンノードがありません。_');
    lines.push('');
  } else {
    orderedScenes.forEach((scene, idx) => {
      const sp = scene.sceneParams;
      const chapterPrefix = sp?.chapter ? `[${sp.chapter}] ` : '';
      lines.push(`### ${idx + 1}. ${chapterPrefix}${scene.title}`);

      const metaParts: string[] = [];
      if (sp?.timepoint) {
        metaParts.push(`作中時間: ${sp.timepoint}`);
      }
      if (sp?.pov) {
        metaParts.push(`視点: ${sp.pov}`);
      }
      if (typeof sp?.tension === 'number') {
        metaParts.push(`テンション: ${sp.tension > 0 ? `+${sp.tension}` : sp.tension}`);
      }
      if (sp?.status) {
        metaParts.push(`状態: ${sp.status}`);
      }
      if (sp?.manuscriptPath) {
        metaParts.push(`原稿: \`${sp.manuscriptPath}\``);
      }
      if (metaParts.length > 0) {
        lines.push(`- ${metaParts.join(' / ')}`);
      }

      const connected = getSceneConnectedElements(doc, scene.id);
      if (connected.characters.length > 0) {
        lines.push(`- **登場人物:** ${connected.characters.map((c) => c.title).join('、')}`);
      }
      if (connected.items.length > 0) {
        lines.push(`- **関連アイテム・条件:** ${connected.items.map((i) => i.title).join('、')}`);
      }
      if (connected.plantedForeshadows.length > 0) {
        lines.push(`- **張る伏線:** ${connected.plantedForeshadows.join('、')}`);
      }
      if (connected.resolvedForeshadows.length > 0) {
        lines.push(`- **回収する伏線:** ${connected.resolvedForeshadows.join('、')}`);
      }

      for (const cp of scene.customParams) {
        lines.push(`- **${cp.key}:** ${cp.value}`);
      }

      if (scene.body.trim()) {
        lines.push('');
        lines.push(scene.body.trim());
      }
      lines.push('');
    });
  }

  const foreshadowNodes = doc.nodes.filter((n) => n.category === 'foreshadow');
  const unresolvedList = detectUnresolvedForeshadows(doc);
  if (foreshadowNodes.length > 0 || unresolvedList.length > 0) {
    lines.push('## 伏線・謎チェックリスト');
    for (const f of foreshadowNodes) {
      const status = getForeshadowNodeStatus(doc, f.id);
      const mark = status === 'resolved' ? '[x]' : '[ ]';
      const statusText =
        status === 'resolved' ? '回収済' : status === 'unresolved' ? '未回収' : '未提示';
      lines.push(`- ${mark} **${f.title}** （${statusText}）: ${f.body.trim()}`);
    }
    for (const u of unresolvedList) {
      if (u.kind === 'scene_plant_unconnected') {
        lines.push(`- [ ] **${u.title}** （${u.statusLabel}）`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 時系列ソートされたシーンノードの `manuscriptPath` 順序を `.genkou.json` の原稿順序リストへ同期する。
 */
export function syncSceneOrderToGenkouFile(
  folderPath: string,
  doc: PlotDocument
): { genkouJsonPath: string; orderedFiles: string[] } {
  const { orderedScenes } = computeSceneOrder(doc);
  const sceneFiles: string[] = [];
  for (const scene of orderedScenes) {
    const rel = scene.sceneParams?.manuscriptPath?.trim();
    if (rel && !sceneFiles.includes(rel)) {
      sceneFiles.push(rel);
    }
  }

  const genkouJsonPath = path.join(folderPath, '.genkou.json');
  let rawObj: Record<string, unknown> = {};
  if (fs.existsSync(genkouJsonPath)) {
    try {
      rawObj = JSON.parse(fs.readFileSync(genkouJsonPath, 'utf8')) as Record<string, unknown>;
    } catch {
      rawObj = {};
    }
  }

  const existingOrder = Array.isArray(rawObj.order)
    ? rawObj.order.filter((x): x is string => typeof x === 'string')
    : [];

  const mergedOrder = [...sceneFiles];
  for (const existing of existingOrder) {
    if (!mergedOrder.includes(existing)) {
      mergedOrder.push(existing);
    }
  }

  rawObj.order = mergedOrder;
  fs.writeFileSync(genkouJsonPath, JSON.stringify(rawObj, null, 2) + '\n', 'utf8');

  return {
    genkouJsonPath,
    orderedFiles: mergedOrder,
  };
}

/**
 * ワークスペース外のパストラバーサルを防止しつつ原稿ファイルの絶対パスを解決する。
 */
export function resolveSafeManuscriptPath(folderPath: string, manuscriptPath: string): string | null {
  const cleaned = manuscriptPath.trim().replace(/^[/\\]+/, '');
  if (!cleaned) {
    return null;
  }
  const rootResolved = path.resolve(folderPath);
  const targetResolved = path.resolve(rootResolved, cleaned);
  if (
    targetResolved !== rootResolved &&
    !targetResolved.startsWith(rootResolved + path.sep)
  ) {
    return null;
  }
  return targetResolved;
}
