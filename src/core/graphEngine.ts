import {
  EdgeLineStyle,
  NodeCategory,
  NodeCertainty,
  PlotDocument,
  PlotEdge,
  PlotNode,
  PlotSocket,
  SocketDataType,
  SocketDirection,
} from './types';

export function getDefaultSocketsForCategory(category: NodeCategory): PlotSocket[] {
  switch (category) {
    case 'note':
      return [];
    case 'scene':
      return [
        { id: 'flow_in', label: '前段シーン', dataType: 'flow', direction: 'in' },
        { id: 'chars_in', label: '登場人物', dataType: 'character', direction: 'in' },
        { id: 'foreshadow_resolve', label: '伏線回収', dataType: 'foreshadow', direction: 'in' },
        { id: 'condition_in', label: '前提・アイテム', dataType: 'item', direction: 'in' },
        { id: 'flow_out', label: '次段シーン', dataType: 'flow', direction: 'out' },
        { id: 'foreshadow_plant', label: '伏線提示', dataType: 'foreshadow', direction: 'out' },
        { id: 'state_out', label: '状態変化・獲得', dataType: 'item', direction: 'out' },
      ];
    case 'character':
      return [
        { id: 'relation_in', label: '初期状態・所属', dataType: 'item', direction: 'in' },
        { id: 'appear_out', label: 'シーン登場', dataType: 'character', direction: 'out' },
      ];
    case 'foreshadow':
      return [
        { id: 'planted_by', label: '提示シーン', dataType: 'foreshadow', direction: 'in' },
        { id: 'resolved_by', label: '回収シーン', dataType: 'foreshadow', direction: 'out' },
      ];
    case 'world_item':
      return [
        { id: 'acquired_from', label: '発生・入手元', dataType: 'item', direction: 'in' },
        { id: 'used_in', label: '使用・参照先', dataType: 'item', direction: 'out' },
      ];
  }
}

export interface CreateNodeOptions {
  id?: string;
  category?: NodeCategory;
  title?: string;
  body?: string;
  x?: number;
  y?: number;
}

let nodeCounter = 1;

export function createNode(options: CreateNodeOptions = {}): PlotNode {
  const category = options.category ?? 'note';
  const id = options.id ?? `node_${Date.now()}_${nodeCounter++}`;
  const defaultTitles: Record<NodeCategory, string> = {
    note: '新規アイデアメモ',
    scene: '新規シーン',
    character: '新規キャラクター',
    foreshadow: '新規の伏線・謎',
    world_item: '新規設定・アイテム',
  };

  const base: PlotNode = {
    id,
    category,
    title: options.title ?? defaultTitles[category],
    body: options.body ?? '',
    x: Math.round(options.x ?? 120),
    y: Math.round(options.y ?? 120),
    tags: [],
    sockets: getDefaultSocketsForCategory(category),
    customParams: [],
  };

  return ensureCategoryParams(base, category);
}

function ensureCategoryParams(node: PlotNode, category: NodeCategory): PlotNode {
  const updated: PlotNode = { ...node, category };
  if (category === 'scene' && !updated.sceneParams) {
    updated.sceneParams = {
      chapter: '第1章',
      timepoint: '',
      pov: '',
      tension: 0,
      status: 'idea',
      manuscriptPath: '',
    };
  } else if (category === 'character' && !updated.characterParams) {
    updated.characterParams = {
      role: '主要人物',
      goal: '',
      flaw: '',
    };
  } else if (category === 'foreshadow' && !updated.foreshadowParams) {
    updated.foreshadowParams = {
      hintDetail: '',
      payoffIdea: '',
    };
  } else if (category === 'world_item' && !updated.itemParams) {
    updated.itemParams = {
      itemType: 'キーアイテム',
      ruleOrCondition: '',
    };
  }
  return updated;
}

/**
 * ノードの種別を昇格・変更する。カスタムソケットや既存エッジと互換性のあるソケットは維持し、
 * 存在しなくなったソケットに接続されていたエッジのみを安全に除去する。
 */
export function promoteNodeCategory(
  doc: PlotDocument,
  nodeId: string,
  targetCategory: NodeCategory
): PlotDocument {
  const targetNode = doc.nodes.find((n) => n.id === nodeId);
  if (!targetNode || targetNode.category === targetCategory) {
    return doc;
  }

  const defaultSockets = getDefaultSocketsForCategory(targetCategory);
  const customSockets = targetNode.sockets.filter((s) => s.isCustom);
  const mergedSockets = [...defaultSockets];

  for (const cs of customSockets) {
    if (!mergedSockets.some((s) => s.id === cs.id)) {
      mergedSockets.push(cs);
    }
  }

  const validSocketIds = new Set(mergedSockets.map((s) => s.id));
  const promotedNode = ensureCategoryParams(
    {
      ...targetNode,
      category: targetCategory,
      sockets: mergedSockets,
    },
    targetCategory
  );

  const nodes = doc.nodes.map((n) => (n.id === nodeId ? promotedNode : n));
  const edges = doc.edges.filter((e) => {
    if (e.fromNodeId === nodeId && !validSocketIds.has(e.fromSocketId)) {
      return false;
    }
    if (e.toNodeId === nodeId && !validSocketIds.has(e.toSocketId)) {
      return false;
    }
    return true;
  });

  return {
    ...doc,
    nodes,
    edges,
  };
}

export function addCustomSocket(
  doc: PlotDocument,
  nodeId: string,
  label: string,
  dataType: SocketDataType,
  direction: SocketDirection
): PlotDocument {
  const cleanLabel = label.trim() || 'カスタム端子';
  const socketId = `custom_${direction}_${ dataType }_${Date.now()}_${nodeCounter++}`;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) {
        return n;
      }
      return {
        ...n,
        sockets: [
          ...n.sockets,
          {
            id: socketId,
            label: cleanLabel,
            dataType,
            direction,
            isCustom: true,
          },
        ],
      };
    }),
  };
}

export interface SocketValidationResult {
  valid: boolean;
  reason?: string;
  dataType?: SocketDataType;
}

export function canConnectSockets(
  doc: PlotDocument,
  fromNodeId: string,
  fromSocketId: string,
  toNodeId: string,
  toSocketId: string
): SocketValidationResult {
  if (fromNodeId === toNodeId) {
    return { valid: false, reason: '同一ノード内のソケット同士は接続できません。' };
  }

  const fromNode = doc.nodes.find((n) => n.id === fromNodeId);
  const toNode = doc.nodes.find((n) => n.id === toNodeId);
  if (!fromNode || !toNode) {
    return { valid: false, reason: '接続対象のノードが存在しません。' };
  }

  const fromSocket = fromNode.sockets.find((s) => s.id === fromSocketId);
  const toSocket = toNode.sockets.find((s) => s.id === toSocketId);
  if (!fromSocket || !toSocket) {
    return { valid: false, reason: '接続対象のソケット端子が存在しません。' };
  }

  if (fromSocket.direction !== 'out' || toSocket.direction !== 'in') {
    return { valid: false, reason: '出力ソケット(右)から入力ソケット(左)へのみ接続できます。' };
  }

  if (fromSocket.dataType !== toSocket.dataType) {
    return {
      valid: false,
      reason: `ソケットの型が一致しません（${fromSocket.dataType} → ${toSocket.dataType}）。同じ種類（色・形状）のソケットに接続してください。`,
    };
  }

  const duplicate = doc.edges.some(
    (e) =>
      e.fromNodeId === fromNodeId &&
      e.fromSocketId === fromSocketId &&
      e.toNodeId === toNodeId &&
      e.toSocketId === toSocketId
  );
  if (duplicate) {
    return { valid: false, reason: '既に同じソケット間で接続されています。' };
  }

  return { valid: true, dataType: fromSocket.dataType };
}

export function connectSockets(
  doc: PlotDocument,
  fromNodeId: string,
  fromSocketId: string,
  toNodeId: string,
  toSocketId: string,
  options: { label?: string; lineStyle?: EdgeLineStyle; id?: string } = {}
): { document: PlotDocument; addedEdge?: PlotEdge; reason?: string } {
  const check = canConnectSockets(doc, fromNodeId, fromSocketId, toNodeId, toSocketId);
  if (!check.valid || !check.dataType) {
    return { document: doc, reason: check.reason };
  }

  const newEdge: PlotEdge = {
    id: options.id ?? `edge_${Date.now()}_${nodeCounter++}`,
    fromNodeId,
    fromSocketId,
    toNodeId,
    toSocketId,
    dataType: check.dataType,
    lineStyle: options.lineStyle ?? 'solid',
    label: options.label,
  };

  return {
    document: {
      ...doc,
      edges: [...doc.edges, newEdge],
    },
    addedEdge: newEdge,
  };
}

export function removeNode(doc: PlotDocument, nodeId: string): PlotDocument {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    edges: doc.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
  };
}

export function removeEdge(doc: PlotDocument, edgeId: string): PlotDocument {
  return {
    ...doc,
    edges: doc.edges.filter((e) => e.id !== edgeId),
  };
}

/**
 * 選択したノードに関連するノード・エッジ（直接接続＋伏線・アイテム・人物チェーン）を抽出する。
 * キャンバス上での関連トレースハイライトに使用する。
 */
export function extractConnectedSubgraph(
  doc: PlotDocument,
  rootNodeId: string
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  if (!doc.nodes.some((n) => n.id === rootNodeId)) {
    return { nodeIds, edgeIds };
  }

  nodeIds.add(rootNodeId);
  const rootNode = doc.nodes.find((n) => n.id === rootNodeId)!;

  for (const edge of doc.edges) {
    if (edge.fromNodeId === rootNodeId || edge.toNodeId === rootNodeId) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.fromNodeId);
      nodeIds.add(edge.toNodeId);
    }
  }

  // 伏線ノードやキャラクターノード、またはシーンからの伏線チェーンを2ホップまで追跡
  if (rootNode.category === 'foreshadow' || rootNode.category === 'scene') {
    const firstHopNodes = Array.from(nodeIds);
    for (const edge of doc.edges) {
      if (
        edge.dataType === 'foreshadow' &&
        (firstHopNodes.includes(edge.fromNodeId) || firstHopNodes.includes(edge.toNodeId))
      ) {
        edgeIds.add(edge.id);
        nodeIds.add(edge.fromNodeId);
        nodeIds.add(edge.toNodeId);
      }
    }
  }

  return { nodeIds, edgeIds };
}

export function removeNodes(doc: PlotDocument, nodeIds: Iterable<string>): PlotDocument {
  const ids = new Set(nodeIds);
  if (ids.size === 0) {
    return doc;
  }
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !ids.has(n.id)),
    edges: doc.edges.filter((e) => !ids.has(e.fromNodeId) && !ids.has(e.toNodeId)),
  };
}

/** 種別変更（昇格）で外れてしまう接続線の本数。UIでの事前通知に使う。 */
export function countEdgesLostByPromotion(
  doc: PlotDocument,
  nodeId: string,
  targetCategory: NodeCategory
): number {
  const before = doc.edges.length;
  return before - promoteNodeCategory(doc, nodeId, targetCategory).edges.length;
}

/**
 * キャラクターのシーン登場を切り替える（登場表ビュー用）。
 * 既に接続があれば全て外し、なければ `appear_out` → `chars_in`（なければ最初の character 型端子）で接続する。
 */
export function toggleCharacterAppearance(
  doc: PlotDocument,
  characterId: string,
  sceneId: string
): { document: PlotDocument; appears: boolean; reason?: string } {
  const existing = doc.edges.filter(
    (e) => e.dataType === 'character' && e.fromNodeId === characterId && e.toNodeId === sceneId
  );
  if (existing.length > 0) {
    const removeIds = new Set(existing.map((e) => e.id));
    return {
      document: { ...doc, edges: doc.edges.filter((e) => !removeIds.has(e.id)) },
      appears: false,
    };
  }

  const charNode = doc.nodes.find((n) => n.id === characterId);
  const sceneNode = doc.nodes.find((n) => n.id === sceneId);
  if (!charNode || !sceneNode) {
    return { document: doc, appears: false, reason: '対象のノードが見つかりません。' };
  }
  const pick = (node: PlotNode, preferredId: string, direction: SocketDirection) =>
    node.sockets.find(
      (s) => s.id === preferredId && s.dataType === 'character' && s.direction === direction
    ) ?? node.sockets.find((s) => s.dataType === 'character' && s.direction === direction);
  const outSock = pick(charNode, 'appear_out', 'out');
  const inSock = pick(sceneNode, 'chars_in', 'in');
  if (!outSock || !inSock) {
    return {
      document: doc,
      appears: false,
      reason: '登場人物（●）の端子が見つかりません。ノード種別を確認してください。',
    };
  }
  const result = connectSockets(doc, characterId, outSock.id, sceneId, inSock.id);
  if (!result.addedEdge) {
    return { document: doc, appears: false, reason: result.reason };
  }
  return { document: result.document, appears: true };
}

export interface NodeClipboardPayload {
  kind: 'node-plot/clipboard';
  version: 1;
  nodes: PlotNode[];
  edges: PlotEdge[];
}

/** 選択ノードと、選択ノード同士を結ぶエッジをクリップボード用に抜き出す。 */
export function extractNodeClipboard(doc: PlotDocument, nodeIds: Iterable<string>): NodeClipboardPayload {
  const ids = new Set(nodeIds);
  return {
    kind: 'node-plot/clipboard',
    version: 1,
    nodes: doc.nodes.filter((n) => ids.has(n.id)),
    edges: doc.edges.filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId)),
  };
}

export function isNodeClipboardPayload(value: unknown): value is NodeClipboardPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown>;
  return v.kind === 'node-plot/clipboard' && Array.isArray(v.nodes) && Array.isArray(v.edges);
}

/**
 * クリップボード内容を新しいIDで貼り付ける（複製にも使用）。内部エッジはIDを付け替えて維持する。
 */
export function insertNodeClipboard(
  doc: PlotDocument,
  payload: NodeClipboardPayload,
  offsetX: number,
  offsetY: number
): { document: PlotDocument; newNodeIds: string[] } {
  const stamp = Date.now();
  const idMap = new Map<string, string>();
  const existingIds = new Set(doc.nodes.map((n) => n.id));
  const newNodes: PlotNode[] = payload.nodes.map((n) => {
    let newId = `node_${stamp}_${nodeCounter++}`;
    while (existingIds.has(newId)) {
      newId = `node_${stamp}_${nodeCounter++}`;
    }
    idMap.set(n.id, newId);
    return {
      ...n,
      id: newId,
      x: Math.round(n.x + offsetX),
      y: Math.round(n.y + offsetY),
      tags: [...n.tags],
      sockets: n.sockets.map((s) => ({ ...s })),
      customParams: n.customParams.map((c) => ({ ...c })),
    };
  });
  const newEdges: PlotEdge[] = [];
  for (const e of payload.edges) {
    const from = idMap.get(e.fromNodeId);
    const to = idMap.get(e.toNodeId);
    if (from && to) {
      newEdges.push({ ...e, id: `edge_${stamp}_${nodeCounter++}`, fromNodeId: from, toNodeId: to });
    }
  }
  return {
    document: { ...doc, nodes: [...doc.nodes, ...newNodes], edges: [...doc.edges, ...newEdges] },
    newNodeIds: newNodes.map((n) => n.id),
  };
}

/**
 * 確定度が未設定のノードについて、タグ（「決定」「案」「未統合」など）から確定度を設定する。
 * `removeTags` が true の場合は変換に使ったタグを取り除く。
 */
export function applyCertaintyFromTags(
  doc: PlotDocument,
  aliases: Readonly<Record<string, NodeCertainty>>,
  removeTags = false
): { document: PlotDocument; updatedCount: number } {
  let updatedCount = 0;
  const nodes = doc.nodes.map((n) => {
    if (n.certainty) {
      return n;
    }
    const matchTag = n.tags.find((t) => aliases[t.trim()] !== undefined);
    if (!matchTag) {
      return n;
    }
    updatedCount++;
    return {
      ...n,
      certainty: aliases[matchTag.trim()],
      tags: removeTags ? n.tags.filter((t) => aliases[t.trim()] === undefined) : n.tags,
    };
  });
  return { document: updatedCount > 0 ? { ...doc, nodes } : doc, updatedCount };
}

export function countNodesWithCertaintyTags(
  doc: PlotDocument,
  aliases: Readonly<Record<string, NodeCertainty>>
): number {
  return doc.nodes.filter((n) => !n.certainty && n.tags.some((t) => aliases[t.trim()] !== undefined))
    .length;
}
