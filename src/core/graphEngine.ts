import {
  EdgeLineStyle,
  NodeCategory,
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
