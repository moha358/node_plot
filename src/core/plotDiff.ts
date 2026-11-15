import { PlotDocument, PlotNode } from './types';

function serializeNodeForDiff(node: PlotNode): string {
  return JSON.stringify({
    category: node.category,
    title: node.title,
    body: node.body,
    tags: node.tags,
    sockets: node.sockets,
    sceneParams: node.sceneParams,
    characterParams: node.characterParams,
    foreshadowParams: node.foreshadowParams,
    itemParams: node.itemParams,
    customParams: node.customParams,
  });
}

export interface PlotDiffResult {
  leftChangedNodeIds: Set<string>;
  rightChangedNodeIds: Set<string>;
  changedCount: number;
}

/**
 * 2つのプロット（バックアップと現在）を比較し、追加・削除・内容変更されたノードID集合を返す。
 */
export function diffPlotDocuments(leftDoc: PlotDocument, rightDoc: PlotDocument): PlotDiffResult {
  const leftMap = new Map<string, string>();
  const rightMap = new Map<string, string>();

  for (const n of leftDoc.nodes) {
    leftMap.set(n.id, serializeNodeForDiff(n));
  }
  for (const n of rightDoc.nodes) {
    rightMap.set(n.id, serializeNodeForDiff(n));
  }

  const leftChangedNodeIds = new Set<string>();
  const rightChangedNodeIds = new Set<string>();

  for (const [id, sig] of leftMap) {
    if (!rightMap.has(id) || rightMap.get(id) !== sig) {
      leftChangedNodeIds.add(id);
    }
  }

  for (const [id, sig] of rightMap) {
    if (!leftMap.has(id) || leftMap.get(id) !== sig) {
      rightChangedNodeIds.add(id);
    }
  }

  const allChanged = new Set([...leftChangedNodeIds, ...rightChangedNodeIds]);
  return {
    leftChangedNodeIds,
    rightChangedNodeIds,
    changedCount: allChanged.size,
  };
}
