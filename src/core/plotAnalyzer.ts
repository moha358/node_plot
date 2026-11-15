import {
  PlotDocument,
  PlotNode,
  PlotSummaryStats,
  TensionPoint,
  UnresolvedForeshadowItem,
} from './types';

function compareNodeCoordinates(a: PlotNode, b: PlotNode): number {
  if (a.x !== b.x) {
    return a.x - b.x;
  }
  if (a.y !== b.y) {
    return a.y - b.y;
  }
  return a.id.localeCompare(b.id);
}

/**
 * シーンノード間の `flow` エッジ（時系列フロー）に基づきトポロジカルソートを行う。
 * 同一階層内はキャンバス上の X 座標昇順 → Y 座標昇順で整列する。
 * 循環（ループ）が存在する場合は `hasCycle: true` と該当ノードIDを返し、残りを座標順で補完する。
 */
export function computeSceneOrder(doc: PlotDocument): {
  orderedScenes: PlotNode[];
  hasCycle: boolean;
  cycleNodeIds: string[];
} {
  const scenes = doc.nodes.filter((n) => n.category === 'scene');
  if (scenes.length === 0) {
    return { orderedScenes: [], hasCycle: false, cycleNodeIds: [] };
  }

  const sceneMap = new Map<string, PlotNode>(scenes.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();

  for (const s of scenes) {
    inDegree.set(s.id, 0);
    adj.set(s.id, new Set());
  }

  for (const edge of doc.edges) {
    if (
      edge.dataType === 'flow' &&
      sceneMap.has(edge.fromNodeId) &&
      sceneMap.has(edge.toNodeId) &&
      edge.fromNodeId !== edge.toNodeId
    ) {
      const neighbors = adj.get(edge.fromNodeId)!;
      if (!neighbors.has(edge.toNodeId)) {
        neighbors.add(edge.toNodeId);
        inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
      }
    }
  }

  const ready: PlotNode[] = scenes
    .filter((s) => (inDegree.get(s.id) ?? 0) === 0)
    .sort(compareNodeCoordinates);

  const orderedScenes: PlotNode[] = [];
  const visited = new Set<string>();

  while (ready.length > 0) {
    ready.sort(compareNodeCoordinates);
    const current = ready.shift()!;
    if (visited.has(current.id)) {
      continue;
    }
    visited.add(current.id);
    orderedScenes.push(current);

    for (const nextId of adj.get(current.id) ?? []) {
      const nextDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0 && !visited.has(nextId)) {
        ready.push(sceneMap.get(nextId)!);
      }
    }
  }

  const hasCycle = orderedScenes.length < scenes.length;
  const cycleNodeIds: string[] = [];

  if (hasCycle) {
    const remaining = scenes
      .filter((s) => !visited.has(s.id))
      .sort(compareNodeCoordinates);
    for (const r of remaining) {
      cycleNodeIds.push(r.id);
      orderedScenes.push(r);
    }
  }

  return {
    orderedScenes,
    hasCycle,
    cycleNodeIds,
  };
}

/**
 * 未提示または未回収の伏線を検出する。
 * 1. `foreshadow` ノードで入力（提示元）がない、または出力（回収先）がないもの
 * 2. `scene` ノードにカスタム伏線提示ソケットが追加されているが未接続のもの
 */
export function detectUnresolvedForeshadows(doc: PlotDocument): UnresolvedForeshadowItem[] {
  const results: UnresolvedForeshadowItem[] = [];
  const foreshadowEdges = doc.edges.filter((e) => e.dataType === 'foreshadow');

  for (const node of doc.nodes) {
    if (node.category === 'foreshadow') {
      const incoming = foreshadowEdges.filter((e) => e.toNodeId === node.id);
      const outgoing = foreshadowEdges.filter((e) => e.fromNodeId === node.id);

      if (incoming.length === 0 && outgoing.length === 0) {
        results.push({
          id: `unplanted_${node.id}`,
          title: node.title,
          sourceNodeId: node.id,
          sourceNodeTitle: node.title,
          kind: 'foreshadow_node_unplanted',
          statusLabel: '未提示・未回収（シーン未接続）',
        });
      } else if (incoming.length === 0) {
        results.push({
          id: `unplanted_${node.id}`,
          title: node.title,
          sourceNodeId: node.id,
          sourceNodeTitle: node.title,
          kind: 'foreshadow_node_unplanted',
          statusLabel: '提示シーン未設定（回収先のみ接続）',
        });
      } else if (outgoing.length === 0) {
        results.push({
          id: `unresolved_${node.id}`,
          title: node.title,
          sourceNodeId: node.id,
          sourceNodeTitle: node.title,
          kind: 'foreshadow_node_unresolved',
          statusLabel: '未回収（回収シーンへ未接続）',
        });
      }
    } else if (node.category === 'scene') {
      const customPlantSockets = node.sockets.filter(
        (s) => s.direction === 'out' && s.dataType === 'foreshadow' && s.isCustom
      );
      for (const sock of customPlantSockets) {
        const connected = foreshadowEdges.some(
          (e) => e.fromNodeId === node.id && e.fromSocketId === sock.id
        );
        if (!connected) {
          results.push({
            id: `scene_plant_${node.id}_${sock.id}`,
            title: sock.label,
            sourceNodeId: node.id,
            sourceNodeTitle: node.title,
            kind: 'scene_plant_unconnected',
            statusLabel: `シーン「${node.title}」の伏線端子「${sock.label}」が未回収`,
          });
        }
      }
    }
  }

  return results;
}

/**
 * 特定の伏線ノードのステータス（unplanted / unresolved / resolved）を返す。
 */
export function getForeshadowNodeStatus(
  doc: PlotDocument,
  foreshadowNodeId: string
): 'unplanted' | 'unresolved' | 'resolved' {
  const incoming = doc.edges.some(
    (e) => e.dataType === 'foreshadow' && e.toNodeId === foreshadowNodeId
  );
  const outgoing = doc.edges.some(
    (e) => e.dataType === 'foreshadow' && e.fromNodeId === foreshadowNodeId
  );
  if (incoming && outgoing) {
    return 'resolved';
  }
  if (incoming && !outgoing) {
    return 'unresolved';
  }
  return 'unplanted';
}

/**
 * 時系列ソートされたシーン順にテンション（感情値 -5〜+5）の推移データを算出する。
 */
export function computeTensionCurve(doc: PlotDocument): TensionPoint[] {
  const { orderedScenes } = computeSceneOrder(doc);
  return orderedScenes.map((scene, idx) => ({
    orderIndex: idx + 1,
    nodeId: scene.id,
    title: scene.title,
    chapter: scene.sceneParams?.chapter || '',
    tension: Math.max(-5, Math.min(5, scene.sceneParams?.tension ?? 0)),
    status: scene.sceneParams?.status ?? 'idea',
  }));
}

/**
 * シーンごとに接続されている登場人物・回収伏線・提示伏線・前提アイテムを逆引き集計する。
 */
export function getSceneConnectedElements(
  doc: PlotDocument,
  sceneNodeId: string
): {
  characters: PlotNode[];
  plantedForeshadows: string[];
  resolvedForeshadows: string[];
  items: PlotNode[];
} {
  const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]));
  const characters: PlotNode[] = [];
  const plantedForeshadows: string[] = [];
  const resolvedForeshadows: string[] = [];
  const items: PlotNode[] = [];

  for (const edge of doc.edges) {
    if (edge.toNodeId === sceneNodeId) {
      const source = nodeMap.get(edge.fromNodeId);
      if (!source) {
        continue;
      }
      if (edge.dataType === 'character' && source.category === 'character') {
        if (!characters.some((c) => c.id === source.id)) {
          characters.push(source);
        }
      } else if (edge.dataType === 'foreshadow') {
        const label =
          source.category === 'foreshadow'
            ? source.title
            : edge.label || `${source.title}からの伏線`;
        resolvedForeshadows.push(label);
      } else if (edge.dataType === 'item') {
        if (!items.some((i) => i.id === source.id)) {
          items.push(source);
        }
      }
    } else if (edge.fromNodeId === sceneNodeId) {
      const target = nodeMap.get(edge.toNodeId);
      if (!target) {
        continue;
      }
      if (edge.dataType === 'foreshadow') {
        const label =
          target.category === 'foreshadow'
            ? target.title
            : edge.label || `${target.title}への伏線`;
        plantedForeshadows.push(label);
      }
    }
  }

  return {
    characters,
    plantedForeshadows,
    resolvedForeshadows,
    items,
  };
}

export function summarizePlotStats(doc: PlotDocument): PlotSummaryStats {
  const { hasCycle } = computeSceneOrder(doc);
  const unresolved = detectUnresolvedForeshadows(doc);

  return {
    totalNodes: doc.nodes.length,
    sceneCount: doc.nodes.filter((n) => n.category === 'scene').length,
    characterCount: doc.nodes.filter((n) => n.category === 'character').length,
    foreshadowCount: doc.nodes.filter((n) => n.category === 'foreshadow').length,
    unresolvedForeshadowCount: unresolved.length,
    hasFlowCycle: hasCycle,
  };
}

function normalizePersonName(text: string): string {
  return text
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/^(主人公|視点)[:：]/, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * シーンの POV（自由記述）がキャラクターを指しているかを判定する。
 * 「生物学者／ロジン」のような複数視点や「（案）」付き表記にも対応し、完全一致（括弧・空白除去後）で照合する。
 */
export function isPovOfCharacter(pov: string, character: PlotNode): boolean {
  const name = normalizePersonName(character.title);
  if (!name) {
    return false;
  }
  return pov
    .split(/[／/、,，・&＆]/)
    .map(normalizePersonName)
    .some((token) => token.length > 0 && token === name);
}

export interface AppearanceCell {
  appears: boolean;
  isPov: boolean;
}

export interface AppearanceMatrix {
  scenes: PlotNode[];
  characters: PlotNode[];
  /** key: `${characterId}|${sceneId}` */
  cells: Map<string, AppearanceCell>;
  appearanceCount: Map<string, number>;
  povCount: Map<string, number>;
  castCount: Map<string, number>;
  /** POV がどのキャラクターにも一致しないシーン */
  unmatchedPovSceneIds: Set<string>;
}

export function appearanceCellKey(characterId: string, sceneId: string): string {
  return `${characterId}|${sceneId}`;
}

/**
 * 登場表（キャラクター × 時系列シーン）を算出する。キャラクターの並び順は呼び出し側で指定可能
 * （枠＝組織ごとのグルーピング順など）。省略時はキャンバス座標順。
 */
export function buildAppearanceMatrix(
  doc: PlotDocument,
  characterOrder?: PlotNode[]
): AppearanceMatrix {
  const { orderedScenes } = computeSceneOrder(doc);
  const characters =
    characterOrder ??
    doc.nodes.filter((n) => n.category === 'character').sort(compareNodeCoordinates);

  const appearing = new Set<string>();
  for (const e of doc.edges) {
    if (e.dataType === 'character') {
      appearing.add(appearanceCellKey(e.fromNodeId, e.toNodeId));
    }
  }

  const cells = new Map<string, AppearanceCell>();
  const appearanceCount = new Map<string, number>();
  const povCount = new Map<string, number>();
  const castCount = new Map<string, number>();
  const unmatchedPovSceneIds = new Set<string>();

  for (const scene of orderedScenes) {
    const pov = scene.sceneParams?.pov ?? '';
    let povMatched = false;
    for (const c of characters) {
      const key = appearanceCellKey(c.id, scene.id);
      const appears = appearing.has(key);
      const isPov = pov.trim() !== '' && isPovOfCharacter(pov, c);
      povMatched = povMatched || isPov;
      cells.set(key, { appears, isPov });
      if (appears) {
        appearanceCount.set(c.id, (appearanceCount.get(c.id) ?? 0) + 1);
        castCount.set(scene.id, (castCount.get(scene.id) ?? 0) + 1);
      }
      if (isPov) {
        povCount.set(c.id, (povCount.get(c.id) ?? 0) + 1);
      }
    }
    if (pov.trim() && !povMatched) {
      unmatchedPovSceneIds.add(scene.id);
    }
  }

  return {
    scenes: orderedScenes,
    characters,
    cells,
    appearanceCount,
    povCount,
    castCount,
    unmatchedPovSceneIds,
  };
}
