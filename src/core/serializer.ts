import { getDefaultSocketsForCategory } from './graphEngine';
import {
  CustomParamEntry,
  EdgeLineStyle,
  NodeCategory,
  PlotDocument,
  PlotEdge,
  PlotFrame,
  PlotNode,
  PlotSocket,
  SceneStatus,
  SocketDataType,
  SocketDirection,
} from './types';

const VALID_CATEGORIES: ReadonlySet<NodeCategory> = new Set([
  'note',
  'scene',
  'character',
  'foreshadow',
  'world_item',
]);
const VALID_SOCKET_TYPES: ReadonlySet<SocketDataType> = new Set([
  'flow',
  'character',
  'foreshadow',
  'item',
]);
const VALID_DIRECTIONS: ReadonlySet<SocketDirection> = new Set(['in', 'out']);
const VALID_SCENE_STATUS: ReadonlySet<SceneStatus> = new Set([
  'idea',
  'draft',
  'fixed',
  'written',
]);
const VALID_EDGE_STYLES: ReadonlySet<EdgeLineStyle> = new Set(['solid', 'dashed']);

/**
 * 新規プロットファイル用のサンプル初期ドキュメントを生成する。
 * 物語向けのマルチソケット（シーン・登場人物・伏線の提示と回収・メモ付箋）が一目で分かる構成とする。
 */
export function createInitialPlotDocument(title = '新規物語プロット'): PlotDocument {
  const charHero: PlotNode = {
    id: 'node_char_hero',
    category: 'character',
    title: '主人公：アキラ',
    body: '古い時計職人の見習い。失踪した師匠の懐中時計を探している。',
    x: 20,
    y: 40,
    tags: ['主人公'],
    sockets: getDefaultSocketsForCategory('character'),
    characterParams: {
      role: '主人公',
      goal: '師匠の失踪の真相を突き止める',
      flaw: '過去の失敗から他者を頼れない',
    },
    customParams: [{ key: '年齢', value: '19歳' }],
  };

  const hintWatch: PlotNode = {
    id: 'node_hint_watch',
    category: 'foreshadow',
    title: '伏線：逆回りする銀時計',
    body: '特定の満月の夜にだけ針が逆回転し、隠し扉の座標を示す。',
    x: 310,
    y: 340,
    tags: ['重要伏線'],
    sockets: getDefaultSocketsForCategory('foreshadow'),
    foreshadowParams: {
      hintDetail: '第1章で壊れた時計として登場させる',
      payoffIdea: 'クライマックスで時計塔の鍵として機能する',
    },
    customParams: [],
  };

  const scene1: PlotNode = {
    id: 'node_scene_1',
    category: 'scene',
    title: '発端：工房に残された銀時計',
    body: '誰もいない工房で、アキラは針が逆回りする奇妙な銀時計を発見する。',
    x: 300,
    y: 60,
    tags: ['起'],
    sockets: getDefaultSocketsForCategory('scene'),
    sceneParams: {
      chapter: '第1章',
      timepoint: '1日目 夜',
      pov: 'アキラ',
      tension: 1,
      status: 'draft',
      manuscriptPath: '01_opening.txt',
    },
    customParams: [{ key: '舞台', value: '旧市街の時計工房' }],
  };

  const scene2: PlotNode = {
    id: 'node_scene_2',
    category: 'scene',
    title: '転機：時計塔の最上階',
    body: '逆回りする銀時計の謎に気づき、満月の時計塔で隠し部屋を開く。',
    x: 590,
    y: 70,
    tags: ['転', 'クライマックス'],
    sockets: getDefaultSocketsForCategory('scene'),
    sceneParams: {
      chapter: '第3章',
      timepoint: '7日目 深夜',
      pov: 'アキラ',
      tension: 5,
      status: 'idea',
      manuscriptPath: '03_climax.txt',
    },
    customParams: [{ key: '舞台', value: '中央時計塔' }],
  };

  const noteIdea: PlotNode = {
    id: 'node_note_1',
    category: 'note',
    title: 'アイデアメモ：幕間のエピソード',
    body: '途中で骨董商のキャラクターを出すか検討中（固まったらシーンや人物に昇格）',
    x: 20,
    y: 310,
    tags: ['メモ'],
    sockets: [],
    customParams: [],
  };

  const edges: PlotEdge[] = [
    {
      id: 'edge_flow_1_2',
      fromNodeId: 'node_scene_1',
      fromSocketId: 'flow_out',
      toNodeId: 'node_scene_2',
      toSocketId: 'flow_in',
      dataType: 'flow',
      lineStyle: 'solid',
      label: '調査を経て',
    },
    {
      id: 'edge_char_s1',
      fromNodeId: 'node_char_hero',
      fromSocketId: 'appear_out',
      toNodeId: 'node_scene_1',
      toSocketId: 'chars_in',
      dataType: 'character',
      lineStyle: 'solid',
    },
    {
      id: 'edge_char_s2',
      fromNodeId: 'node_char_hero',
      fromSocketId: 'appear_out',
      toNodeId: 'node_scene_2',
      toSocketId: 'chars_in',
      dataType: 'character',
      lineStyle: 'solid',
    },
    {
      id: 'edge_hint_plant',
      fromNodeId: 'node_scene_1',
      fromSocketId: 'foreshadow_plant',
      toNodeId: 'node_hint_watch',
      toSocketId: 'planted_by',
      dataType: 'foreshadow',
      lineStyle: 'solid',
      label: '提示',
    },
    {
      id: 'edge_hint_resolve',
      fromNodeId: 'node_hint_watch',
      fromSocketId: 'resolved_by',
      toNodeId: 'node_scene_2',
      toSocketId: 'foreshadow_resolve',
      dataType: 'foreshadow',
      lineStyle: 'solid',
      label: '回収',
    },
  ];

  const frames: PlotFrame[] = [
    {
      id: 'frame_main_arc',
      title: 'メインストーリーライン',
      x: 280,
      y: 20,
      width: 570,
      height: 280,
    },
  ];

  return {
    schemaVersion: 1,
    title,
    synopsis: '師匠の遺した銀時計を巡るミステリーファンタジーの構成プロット',
    viewport: { panX: 16, panY: 16, zoom: 0.85 },
    nodes: [charHero, scene1, scene2, hintWatch, noteIdea],
    edges,
    frames,
  };
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback;
}

function asNumber(val: unknown, fallback = 0, min = -100000, max = 100000): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, val));
}

function sanitizeSocket(raw: unknown): PlotSocket | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id).trim();
  const label = asString(obj.label, '端子').trim();
  const dataType = obj.dataType as SocketDataType;
  const direction = obj.direction as SocketDirection;
  if (!id || !VALID_SOCKET_TYPES.has(dataType) || !VALID_DIRECTIONS.has(direction)) {
    return null;
  }
  return {
    id,
    label,
    dataType,
    direction,
    isCustom: Boolean(obj.isCustom),
  };
}

function sanitizeNode(raw: unknown, idx: number): PlotNode | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id, `node_${idx}`).trim();
  const category: NodeCategory = VALID_CATEGORIES.has(obj.category as NodeCategory)
    ? (obj.category as NodeCategory)
    : 'note';

  const rawSockets = Array.isArray(obj.sockets) ? obj.sockets : null;
  let sockets: PlotSocket[];
  if (rawSockets) {
    sockets = rawSockets.map(sanitizeSocket).filter((s): s is PlotSocket => s !== null);
  } else {
    sockets = getDefaultSocketsForCategory(category);
  }

  const customParams: CustomParamEntry[] = [];
  if (Array.isArray(obj.customParams)) {
    for (const entry of obj.customParams) {
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        const key = asString(e.key).trim();
        if (key) {
          customParams.push({ key, value: asString(e.value) });
        }
      }
    }
  }

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];

  const node: PlotNode = {
    id,
    category,
    title: asString(obj.title, '無題ノード'),
    body: asString(obj.body, ''),
    x: Math.round(asNumber(obj.x, 100 + idx * 40)),
    y: Math.round(asNumber(obj.y, 100 + idx * 40)),
    colorTag: typeof obj.colorTag === 'string' ? obj.colorTag : undefined,
    tags,
    sockets,
    customParams,
  };

  if (obj.sceneParams && typeof obj.sceneParams === 'object') {
    const sp = obj.sceneParams as Record<string, unknown>;
    const status = VALID_SCENE_STATUS.has(sp.status as SceneStatus)
      ? (sp.status as SceneStatus)
      : 'idea';
    node.sceneParams = {
      chapter: asString(sp.chapter, '第1章'),
      timepoint: asString(sp.timepoint, ''),
      pov: asString(sp.pov, ''),
      tension: Math.round(asNumber(sp.tension, 0, -5, 5)),
      status,
      manuscriptPath: asString(sp.manuscriptPath, ''),
    };
  } else if (category === 'scene') {
    node.sceneParams = {
      chapter: '第1章',
      timepoint: '',
      pov: '',
      tension: 0,
      status: 'idea',
      manuscriptPath: '',
    };
  }

  if (obj.characterParams && typeof obj.characterParams === 'object') {
    const cp = obj.characterParams as Record<string, unknown>;
    node.characterParams = {
      role: asString(cp.role, '主要人物'),
      goal: asString(cp.goal, ''),
      flaw: asString(cp.flaw, ''),
    };
  } else if (category === 'character') {
    node.characterParams = { role: '主要人物', goal: '', flaw: '' };
  }

  if (obj.foreshadowParams && typeof obj.foreshadowParams === 'object') {
    const fp = obj.foreshadowParams as Record<string, unknown>;
    node.foreshadowParams = {
      hintDetail: asString(fp.hintDetail, ''),
      payoffIdea: asString(fp.payoffIdea, ''),
    };
  } else if (category === 'foreshadow') {
    node.foreshadowParams = { hintDetail: '', payoffIdea: '' };
  }

  if (obj.itemParams && typeof obj.itemParams === 'object') {
    const ip = obj.itemParams as Record<string, unknown>;
    node.itemParams = {
      itemType: asString(ip.itemType, 'キーアイテム'),
      ruleOrCondition: asString(ip.ruleOrCondition, ''),
    };
  } else if (category === 'world_item') {
    node.itemParams = { itemType: 'キーアイテム', ruleOrCondition: '' };
  }

  return node;
}

export function parsePlotDocument(text: string): PlotDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    return createInitialPlotDocument();
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return createInitialPlotDocument();
    }

    const nodes: PlotNode[] = [];
    const seenNodeIds = new Set<string>();
    if (Array.isArray(parsed.nodes)) {
      parsed.nodes.forEach((rawNode, idx) => {
        const n = sanitizeNode(rawNode, idx);
        if (n && !seenNodeIds.has(n.id)) {
          seenNodeIds.add(n.id);
          nodes.push(n);
        }
      });
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edges: PlotEdge[] = [];
    const seenEdgeIds = new Set<string>();

    if (Array.isArray(parsed.edges)) {
      parsed.edges.forEach((rawEdge, idx) => {
        if (!rawEdge || typeof rawEdge !== 'object') {
          return;
        }
        const e = rawEdge as Record<string, unknown>;
        const id = asString(e.id, `edge_${idx}`).trim();
        const fromNodeId = asString(e.fromNodeId).trim();
        const fromSocketId = asString(e.fromSocketId).trim();
        const toNodeId = asString(e.toNodeId).trim();
        const toSocketId = asString(e.toSocketId).trim();

        const fromNode = nodeMap.get(fromNodeId);
        const toNode = nodeMap.get(toNodeId);
        if (!fromNode || !toNode || fromNodeId === toNodeId || seenEdgeIds.has(id)) {
          return;
        }

        const fromSock = fromNode.sockets.find(
          (s) => s.id === fromSocketId && s.direction === 'out'
        );
        const toSock = toNode.sockets.find((s) => s.id === toSocketId && s.direction === 'in');
        if (!fromSock || !toSock || fromSock.dataType !== toSock.dataType) {
          return;
        }

        const lineStyle: EdgeLineStyle = VALID_EDGE_STYLES.has(e.lineStyle as EdgeLineStyle)
          ? (e.lineStyle as EdgeLineStyle)
          : 'solid';

        seenEdgeIds.add(id);
        edges.push({
          id,
          fromNodeId,
          fromSocketId,
          toNodeId,
          toSocketId,
          dataType: fromSock.dataType,
          lineStyle,
          label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : undefined,
        });
      });
    }

    const frames: PlotFrame[] = [];
    if (Array.isArray(parsed.frames)) {
      parsed.frames.forEach((rawFrame, idx) => {
        if (!rawFrame || typeof rawFrame !== 'object') {
          return;
        }
        const f = rawFrame as Record<string, unknown>;
        frames.push({
          id: asString(f.id, `frame_${idx}`),
          title: asString(f.title, 'グループ枠'),
          x: Math.round(asNumber(f.x, 60)),
          y: Math.round(asNumber(f.y, 60)),
          width: Math.round(asNumber(f.width, 480, 120, 10000)),
          height: Math.round(asNumber(f.height, 320, 100, 10000)),
          colorTag: typeof f.colorTag === 'string' ? f.colorTag : undefined,
        });
      });
    }

    const rawVp =
      parsed.viewport && typeof parsed.viewport === 'object'
        ? (parsed.viewport as Record<string, unknown>)
        : {};

    return {
      schemaVersion: 1,
      title: asString(parsed.title, '物語プロット'),
      synopsis: asString(parsed.synopsis, ''),
      viewport: {
        panX: Math.round(asNumber(rawVp.panX, 40)),
        panY: Math.round(asNumber(rawVp.panY, 20)),
        zoom: asNumber(rawVp.zoom, 1, 0.25, 2.0),
      },
      nodes,
      edges,
      frames,
    };
  } catch {
    return createInitialPlotDocument();
  }
}

export function serializePlotDocument(doc: PlotDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export interface MinimalTextEdit {
  startOffset: number;
  endOffset: number;
  replacement: string;
}

/**
 * 旧テキストと新テキストを比較し、変更された最小範囲を算出する。
 */
export function computeMinimalTextEdit(oldText: string, newText: string): MinimalTextEdit | null {
  if (oldText === newText) {
    return null;
  }
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return {
    startOffset: start,
    endOffset: oldEnd,
    replacement: newText.slice(start, newEnd),
  };
}
