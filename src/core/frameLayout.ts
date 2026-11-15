import { FrameColor, PlotDocument, PlotFrame, PlotNode } from './types';

/**
 * グループ枠（フレーム）の入れ子・所属・リサイズに関する純粋ロジック。
 *
 * 所属関係はファイルに保存せず、常にジオメトリ（座標と大きさ）から導出する（ADR-007）。
 * - ノードは「アンカー点（左上から NODE_ANCHOR_OFFSET 内側）」を含む最小の枠に所属する。
 * - 枠は「自分を完全に含み、自分より面積の大きい最小の枠」を親とする。
 * これにより、枠を動かせば中身（子枠・ノード）が一緒に動き、ノードを枠の外へドラッグすれば
 * 所属から外れる、という直感的な挙動を、保存データの不整合なしに実現する。
 */

export const NODE_ANCHOR_OFFSET = 16;
export const DEFAULT_NODE_WIDTH = 232;
export const NODE_MIN_WIDTH = 180;
export const NODE_MAX_WIDTH = 640;
export const FRAME_MIN_WIDTH = 160;
export const FRAME_MIN_HEIGHT = 100;
export const FRAME_HEADER_HEIGHT = 28;
export const FRAME_PADDING = 20;

export const FRAME_COLORS: readonly FrameColor[] = [
  'none',
  'gray',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'violet',
];

export const FRAME_COLOR_LABELS: Record<FrameColor, string> = {
  none: '色なし',
  gray: 'グレー',
  blue: '青',
  teal: '青緑',
  green: '緑',
  amber: '黄',
  orange: '橙',
  rose: '赤',
  violet: '紫',
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function area(r: Rect): number {
  return r.width * r.height;
}

export function rectContainsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function nodeAnchor(node: Pick<PlotNode, 'x' | 'y'>): { x: number; y: number } {
  return { x: node.x + NODE_ANCHOR_OFFSET, y: node.y + NODE_ANCHOR_OFFSET };
}

/** 枠 child を完全に含む、child より面積の大きい枠のうち最小のもの。 */
function findParentFrame(frames: readonly PlotFrame[], child: PlotFrame): PlotFrame | null {
  let best: PlotFrame | null = null;
  for (const f of frames) {
    if (f.id === child.id || area(f) <= area(child) || !rectContainsRect(f, child)) {
      continue;
    }
    if (!best || area(f) < area(best)) {
      best = f;
    }
  }
  return best;
}

/** 点を含む最小の枠。 */
function findInnermostFrameAt(frames: readonly PlotFrame[], x: number, y: number): PlotFrame | null {
  let best: PlotFrame | null = null;
  for (const f of frames) {
    if (!rectContainsPoint(f, x, y)) {
      continue;
    }
    if (!best || area(f) < area(best)) {
      best = f;
    }
  }
  return best;
}

export interface FrameHierarchy {
  /** frameId → 親枠ID（最上位は null） */
  frameParent: Map<string, string | null>;
  /** nodeId → 所属する最内側の枠ID（どの枠にも入っていなければ null） */
  nodeFrame: Map<string, string | null>;
}

export function computeFrameHierarchy(doc: Pick<PlotDocument, 'frames' | 'nodes'>): FrameHierarchy {
  const frameParent = new Map<string, string | null>();
  for (const f of doc.frames) {
    frameParent.set(f.id, findParentFrame(doc.frames, f)?.id ?? null);
  }
  const nodeFrame = new Map<string, string | null>();
  for (const n of doc.nodes) {
    const a = nodeAnchor(n);
    nodeFrame.set(n.id, findInnermostFrameAt(doc.frames, a.x, a.y)?.id ?? null);
  }
  return { frameParent, nodeFrame };
}

/**
 * 枠の中身（入れ子の子孫枠すべてと、アンカー点が枠内にあるノードすべて）を返す。
 * 枠ドラッグ時にまとめて移動する対象。
 */
export function collectFrameContents(
  doc: Pick<PlotDocument, 'frames' | 'nodes'>,
  frameId: string
): { frameIds: Set<string>; nodeIds: Set<string> } {
  const frameIds = new Set<string>();
  const nodeIds = new Set<string>();
  const root = doc.frames.find((f) => f.id === frameId);
  if (!root) {
    return { frameIds, nodeIds };
  }
  for (const f of doc.frames) {
    if (f.id !== root.id && area(f) < area(root) && rectContainsRect(root, f)) {
      frameIds.add(f.id);
    }
  }
  for (const n of doc.nodes) {
    const a = nodeAnchor(n);
    if (rectContainsPoint(root, a.x, a.y)) {
      nodeIds.add(n.id);
    }
  }
  return { frameIds, nodeIds };
}

/** 外側 → 内側の順で、ノードが属する枠の列（例：[勢力, 組織A]）。 */
export function getNodeFramePath(
  doc: Pick<PlotDocument, 'frames' | 'nodes'>,
  nodeId: string,
  hierarchy: FrameHierarchy = computeFrameHierarchy(doc)
): PlotFrame[] {
  const frameMap = new Map(doc.frames.map((f) => [f.id, f]));
  const path: PlotFrame[] = [];
  let current = hierarchy.nodeFrame.get(nodeId) ?? null;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    const f = frameMap.get(current);
    if (!f) {
      break;
    }
    path.unshift(f);
    current = hierarchy.frameParent.get(current) ?? null;
  }
  return path;
}

/** 外側 → 内側の順で、枠の祖先列（自分は含まない）。 */
export function getFrameAncestors(
  doc: Pick<PlotDocument, 'frames' | 'nodes'>,
  frameId: string,
  hierarchy: FrameHierarchy = computeFrameHierarchy(doc)
): PlotFrame[] {
  const frameMap = new Map(doc.frames.map((f) => [f.id, f]));
  const path: PlotFrame[] = [];
  let current = hierarchy.frameParent.get(frameId) ?? null;
  const guard = new Set<string>([frameId]);
  while (current && !guard.has(current)) {
    guard.add(current);
    const f = frameMap.get(current);
    if (!f) {
      break;
    }
    path.unshift(f);
    current = hierarchy.frameParent.get(current) ?? null;
  }
  return path;
}

/** 大きい枠ほど奥に描画する（入れ子の内側の枠が手前に来る）。同面積は元の順序を維持。 */
export function sortFramesForRender(frames: readonly PlotFrame[]): PlotFrame[] {
  return frames
    .map((f, idx) => ({ f, idx }))
    .sort((a, b) => area(b.f) - area(a.f) || a.idx - b.idx)
    .map((e) => e.f);
}

/**
 * リサイズハンドルのドラッグ量から新しい矩形を算出する。
 * 動かした辺のみスナップし、最小サイズを下回る場合は動かした辺側で止める。
 */
export function resizeRect(
  initial: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number,
  snap: (v: number) => number = (v) => Math.round(v)
): Rect {
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  if (handle.includes('w')) {
    left = Math.min(snap(left + dx), right - minWidth);
  }
  if (handle.includes('e')) {
    right = Math.max(snap(right + dx), left + minWidth);
  }
  if (handle.includes('n')) {
    top = Math.min(snap(top + dy), bottom - minHeight);
  }
  if (handle.includes('s')) {
    bottom = Math.max(snap(bottom + dy), top + minHeight);
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export function clampNodeWidth(width: number): number {
  return Math.round(Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, width)));
}

function boundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function paddedFrameRect(bounds: Rect): Rect {
  return {
    x: Math.round(bounds.x - FRAME_PADDING),
    y: Math.round(bounds.y - FRAME_PADDING - FRAME_HEADER_HEIGHT),
    width: Math.round(Math.max(FRAME_MIN_WIDTH, bounds.width + FRAME_PADDING * 2)),
    height: Math.round(
      Math.max(FRAME_MIN_HEIGHT, bounds.height + FRAME_PADDING * 2 + FRAME_HEADER_HEIGHT)
    ),
  };
}

/**
 * 選択ノード（＋選択枠）を囲む新しい枠を作る。ノードの高さは DOM 依存のため呼び出し側が実測値を渡す。
 * 例：キャラクターノードを選択して「組織」枠で束ねる。
 */
export function wrapInNewFrame(
  doc: PlotDocument,
  nodeRects: Map<string, Rect>,
  options: { id: string; title: string; colorTag?: FrameColor; frameIds?: string[] }
): { document: PlotDocument; frame: PlotFrame | null } {
  const rects: Rect[] = [...nodeRects.values()];
  for (const fid of options.frameIds ?? []) {
    const f = doc.frames.find((fr) => fr.id === fid);
    if (f) {
      rects.push(f);
    }
  }
  const bounds = boundingRect(rects);
  if (!bounds) {
    return { document: doc, frame: null };
  }
  const frame: PlotFrame = {
    id: options.id,
    title: options.title,
    ...paddedFrameRect(bounds),
    colorTag: options.colorTag,
  };
  return { document: { ...doc, frames: [...doc.frames, frame] }, frame };
}

/**
 * 枠を中身（ノード実測矩形と子枠）にぴったり合わせる。中身が空なら変更しない。
 * 親枠からはみ出す場合でも親枠は自動では広げない（ユーザーの意図しない連鎖変形を避ける）。
 */
export function fitFrameToContents(
  doc: PlotDocument,
  frameId: string,
  nodeRects: Map<string, Rect>
): PlotDocument {
  const contents = collectFrameContents(doc, frameId);
  const rects: Rect[] = [];
  for (const nid of contents.nodeIds) {
    const r = nodeRects.get(nid);
    if (r) {
      rects.push(r);
    }
  }
  for (const f of doc.frames) {
    if (contents.frameIds.has(f.id)) {
      rects.push(f);
    }
  }
  const bounds = boundingRect(rects);
  if (!bounds) {
    return doc;
  }
  const next = paddedFrameRect(bounds);
  return {
    ...doc,
    frames: doc.frames.map((f) => (f.id === frameId ? { ...f, ...next } : f)),
  };
}

/** 枠とその中身（子枠・ノード）をまとめて削除する。 */
export function removeFrameWithContents(doc: PlotDocument, frameId: string): PlotDocument {
  const { frameIds, nodeIds } = collectFrameContents(doc, frameId);
  frameIds.add(frameId);
  return {
    ...doc,
    frames: doc.frames.filter((f) => !frameIds.has(f.id)),
    nodes: doc.nodes.filter((n) => !nodeIds.has(n.id)),
    edges: doc.edges.filter((e) => !nodeIds.has(e.fromNodeId) && !nodeIds.has(e.toNodeId)),
  };
}
