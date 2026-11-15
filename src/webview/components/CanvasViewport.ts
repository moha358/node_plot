import {
  RESIZE_HANDLES,
  Rect,
  ResizeHandle,
  computeFrameHierarchy,
  sortFramesForRender,
} from '../../core/frameLayout';
import { extractConnectedSubgraph } from '../../core/graphEngine';
import { SOCKET_TYPE_META } from '../../core/theme';
import {
  NodeCategory,
  NodeCertainty,
  PlotDocument,
  PlotNode,
  PlotSocket,
  SocketDataType,
  ViewportState,
} from '../../core/types';
import { EdgeRenderer, SocketPosition, TempWireState } from './EdgeRenderer';
import { startInlineEdit } from './inlineEdit';
import { ActiveSocketDragInfo, createNodeCardElement } from './NodeCard';

export type CertaintyFilter = 'all' | NodeCertainty | 'none';

export interface CanvasRenderState {
  selectedNodeIds: ReadonlySet<string>;
  selectedEdgeId: string | null;
  selectedFrameId: string | null;
  filterQuery: string;
  certaintyFilter: CertaintyFilter;
  traceModeEnabled: boolean;
  hiddenWireTypes: ReadonlySet<SocketDataType>;
  activeSocketDrag: ActiveSocketDragInfo | null;
  tempWire: TempWireState | null;
  gridSize: number;
}

export interface CanvasViewportCallbacks {
  /** 背景（または枠の本体部分）でのポインター押下。パン・範囲選択・選択解除は呼び出し側が判断する。 */
  onBackgroundPointerDown: (e: PointerEvent) => void;
  onDoubleClickCanvas: (clientX: number, clientY: number) => void;
  onWheelZoom: (e: WheelEvent) => void;
  onSetZoomLevel: (newZoom: number, commit: boolean) => void;
  onFitView: () => void;
  onResetZoom: () => void;
  onNodePointerDown: (nodeId: string, e: PointerEvent) => void;
  onStartDragNode: (nodeId: string, e: PointerEvent) => void;
  onStartResizeNode: (nodeId: string, e: PointerEvent) => void;
  onResetNodeWidth: (nodeId: string) => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onFramePointerDown: (frameId: string, e: PointerEvent) => void;
  onStartResizeFrame: (frameId: string, handle: ResizeHandle, e: PointerEvent) => void;
  onRenameFrame: (frameId: string, title: string) => void;
  onEdgePointerDown: (edgeId: string) => void;
  onPromoteCategory: (nodeId: string, newCategory: NodeCategory) => void;
  onStartSocketDrag: (nodeId: string, socket: PlotSocket, e: PointerEvent) => void;
  onOpenManuscript: (node: PlotNode) => void;
  onToggleWireType: (dataType: SocketDataType) => void;
}

const WIRE_TYPES: SocketDataType[] = ['flow', 'character', 'foreshadow', 'item'];

/** 検索語・確定度フィルタに一致するか（一致しないノードは減光する）。 */
export function nodeMatchesFilters(node: PlotNode, query: string, certainty: CertaintyFilter): boolean {
  if (certainty !== 'all') {
    if (certainty === 'none' ? node.certainty !== undefined : node.certainty !== certainty) {
      return false;
    }
  }
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return (
    node.title.toLowerCase().includes(q) ||
    node.body.toLowerCase().includes(q) ||
    node.tags.some((t) => t.toLowerCase().includes(q)) ||
    node.customParams.some(
      (cp) => cp.key.toLowerCase().includes(q) || cp.value.toLowerCase().includes(q)
    ) ||
    (node.sceneParams?.chapter.toLowerCase().includes(q) ?? false) ||
    (node.sceneParams?.pov.toLowerCase().includes(q) ?? false)
  );
}

/**
 * 無限キャンバス。描画は3段階に分かれる。
 * - render: ドキュメント構造が変わったときの DOM 再構築
 * - applyViewport: パン・ズーム（transform とグリッドのみ更新、DOM はそのまま）
 * - applyGeometry / applyDecorations: ドラッグ中の位置更新・選択や減光のクラス付け替え
 * パンやドラッグのたびに DOM 全体を作り直さないことで、大きなプロットでも滑らかに動かす。
 */
export class CanvasViewport {
  public readonly viewportElement: HTMLElement;
  public readonly worldElement: HTMLElement;
  private readonly zoomHudElement: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly zoomPctBtn: HTMLButtonElement;
  private readonly wireLegendElement: HTMLElement;
  private readonly wireButtons = new Map<SocketDataType, HTMLButtonElement>();
  private readonly marqueeElement: HTMLElement;
  private readonly edgeRenderer: EdgeRenderer;
  private nodeElements = new Map<string, HTMLElement>();
  private frameElements = new Map<string, HTMLElement>();

  constructor(
    private readonly callbacks: CanvasViewportCallbacks,
    private readonly interactive = true
  ) {
    this.viewportElement = document.createElement('div');
    this.viewportElement.className = 'nplot-canvas-viewport';

    this.worldElement = document.createElement('div');
    this.worldElement.className = 'nplot-canvas-world';

    this.edgeRenderer = new EdgeRenderer((edgeId) => {
      this.callbacks.onEdgePointerDown(edgeId);
    });

    this.marqueeElement = document.createElement('div');
    this.marqueeElement.className = 'nplot-marquee';

    // Bottom-Right Floating Zoom HUD
    this.zoomHudElement = document.createElement('div');
    this.zoomHudElement.className = 'nplot-zoom-hud';
    this.zoomHudElement.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.zoomHudElement.addEventListener('dblclick', (e) => e.stopPropagation());

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'nplot-btn';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.title = '縮小 (-5%)';
    zoomOutBtn.addEventListener('click', () => {
      const current = Number(this.zoomSlider.value) / 100;
      this.callbacks.onSetZoomLevel(Math.max(0.25, current - 0.05), true);
    });

    this.zoomSlider = document.createElement('input');
    this.zoomSlider.type = 'range';
    this.zoomSlider.className = 'nplot-zoom-slider';
    this.zoomSlider.min = '25';
    this.zoomSlider.max = '200';
    this.zoomSlider.step = '1';
    this.zoomSlider.value = '100';
    this.zoomSlider.title = 'ドラッグで拡大・縮小 (25% 〜 200%)';
    this.zoomSlider.addEventListener('input', () => {
      this.callbacks.onSetZoomLevel(Number(this.zoomSlider.value) / 100, false);
    });
    this.zoomSlider.addEventListener('change', () => {
      this.callbacks.onSetZoomLevel(Number(this.zoomSlider.value) / 100, true);
    });

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'nplot-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.title = '拡大 (+5%)';
    zoomInBtn.addEventListener('click', () => {
      const current = Number(this.zoomSlider.value) / 100;
      this.callbacks.onSetZoomLevel(Math.min(2.0, current + 0.05), true);
    });

    this.zoomPctBtn = document.createElement('button');
    this.zoomPctBtn.className = 'nplot-btn nplot-zoom-pct';
    this.zoomPctBtn.textContent = '100%';
    this.zoomPctBtn.title = 'クリックで100%等倍表示にリセット';
    this.zoomPctBtn.addEventListener('click', () => this.callbacks.onResetZoom());

    const fitBtn = document.createElement('button');
    fitBtn.className = 'nplot-btn';
    fitBtn.textContent = '全体表示';
    fitBtn.title = 'すべてのノードと枠がキャンバス内に収まるよう自動調整';
    fitBtn.addEventListener('click', () => this.callbacks.onFitView());

    this.zoomHudElement.append(zoomOutBtn, this.zoomSlider, zoomInBtn, this.zoomPctBtn, fitBtn);

    // Bottom-Left Wire Legend (ワイヤー種別ごとの表示切替)
    this.wireLegendElement = document.createElement('div');
    this.wireLegendElement.className = 'nplot-wire-legend';
    this.wireLegendElement.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.wireLegendElement.addEventListener('dblclick', (e) => e.stopPropagation());
    const legendTitle = document.createElement('span');
    legendTitle.className = 'nplot-wire-legend-title';
    legendTitle.textContent = 'ワイヤー';
    this.wireLegendElement.appendChild(legendTitle);
    for (const t of WIRE_TYPES) {
      const meta = SOCKET_TYPE_META[t];
      const btn = document.createElement('button');
      btn.className = 'nplot-btn nplot-wire-toggle is-active';
      btn.title = `${meta.label} のワイヤーを表示／非表示`;
      const sym = document.createElement('span');
      sym.textContent = meta.symbol;
      sym.style.color = meta.cssColorVar;
      btn.append(sym, document.createTextNode(meta.label.split('（')[0].split('・')[0]));
      btn.addEventListener('click', () => this.callbacks.onToggleWireType(t));
      this.wireButtons.set(t, btn);
      this.wireLegendElement.appendChild(btn);
    }

    this.viewportElement.appendChild(this.worldElement);
    this.viewportElement.appendChild(this.zoomHudElement);
    if (interactive) {
      this.viewportElement.appendChild(this.wireLegendElement);
    }

    this.viewportElement.addEventListener('pointerdown', (e) => {
      if (this.isBackgroundTarget(e.target) || e.button === 1) {
        this.callbacks.onBackgroundPointerDown(e);
      }
    });

    this.viewportElement.addEventListener('dblclick', (e) => {
      if (this.isBackgroundTarget(e.target)) {
        const rect = this.viewportElement.getBoundingClientRect();
        this.callbacks.onDoubleClickCanvas(e.clientX - rect.left, e.clientY - rect.top);
      }
    });

    this.viewportElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.callbacks.onWheelZoom(e);
      },
      { passive: false }
    );
  }

  /** 背景・ワールド・枠の本体（ヘッダーとハンドル以外）は「背景」として扱い、枠の上でもパンできるようにする。 */
  private isBackgroundTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    return (
      target === this.viewportElement ||
      target === this.worldElement ||
      target.classList.contains('nplot-frame')
    );
  }

  public updateZoomHud(zoom: number): void {
    const pct = Math.round(zoom * 100);
    this.zoomSlider.value = String(pct);
    this.zoomPctBtn.textContent = `${pct}%`;
  }

  /** パン・ズームのみの更新（DOM 再構築なし）。 */
  public applyViewport(viewport: ViewportState, gridSize: number): void {
    const { panX, panY, zoom } = viewport;
    this.worldElement.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.worldElement.classList.toggle('is-lod-compact', zoom < 0.55);
    this.worldElement.style.setProperty('--nplot-zoom', String(zoom));
    const step = gridSize * zoom;
    this.viewportElement.classList.toggle('is-grid-hidden', step < 6);
    this.viewportElement.style.backgroundSize = `${step}px ${step}px`;
    this.viewportElement.style.backgroundPosition = `${panX}px ${panY}px`;
    this.updateZoomHud(zoom);
  }

  public render(doc: PlotDocument, state: CanvasRenderState): void {
    this.worldElement.replaceChildren();
    this.nodeElements = new Map();
    this.frameElements = new Map();
    this.worldElement.appendChild(this.edgeRenderer.svgElement);

    // 1. Group Frames（大きい枠ほど奥＝入れ子の内側が手前）
    const hierarchy = computeFrameHierarchy(doc);
    for (const frame of sortFramesForRender(doc.frames)) {
      const frameEl = document.createElement('div');
      frameEl.className = 'nplot-frame';
      frameEl.dataset.frameId = frame.id;
      if (frame.colorTag && frame.colorTag !== 'none') {
        frameEl.dataset.color = frame.colorTag;
      }
      if (hierarchy.frameParent.get(frame.id)) {
        frameEl.classList.add('is-nested');
      }
      this.setRectStyle(frameEl, frame);

      const header = document.createElement('div');
      header.className = 'nplot-frame-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'nplot-frame-title';
      titleSpan.textContent = frame.title;
      header.appendChild(titleSpan);
      if (this.interactive) {
        header.title = 'ドラッグで中身ごと移動／ダブルクリックで名前を編集';
        header.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) {
            return;
          }
          e.stopPropagation();
          this.callbacks.onFramePointerDown(frame.id, e);
        });
        header.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineEdit(titleSpan, frame.title, (next) =>
            this.callbacks.onRenameFrame(frame.id, next)
          );
        });
      }
      frameEl.appendChild(header);

      if (this.interactive) {
        for (const handle of RESIZE_HANDLES) {
          const h = document.createElement('div');
          h.className = `nplot-resize-handle is-${handle}`;
          h.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) {
              return;
            }
            e.stopPropagation();
            this.callbacks.onStartResizeFrame(frame.id, handle, e);
          });
          frameEl.appendChild(h);
        }
      }

      this.frameElements.set(frame.id, frameEl);
      this.worldElement.appendChild(frameEl);
    }

    // 2. Sticky Nodes
    for (const node of doc.nodes) {
      const cardEl = createNodeCardElement(doc, node, this.interactive, {
        onNodePointerDown: (id, e) => this.callbacks.onNodePointerDown(id, e),
        onStartDragNode: (id, e) => this.callbacks.onStartDragNode(id, e),
        onStartResizeNode: (id, e) => this.callbacks.onStartResizeNode(id, e),
        onResetNodeWidth: (id) => this.callbacks.onResetNodeWidth(id),
        onRenameNode: (id, title) => this.callbacks.onRenameNode(id, title),
        onPromoteCategory: (id, cat) => this.callbacks.onPromoteCategory(id, cat),
        onStartSocketDrag: (id, sock, e) => this.callbacks.onStartSocketDrag(id, sock, e),
        onOpenManuscript: (n) => this.callbacks.onOpenManuscript(n),
      });
      this.nodeElements.set(node.id, cardEl);
      this.worldElement.appendChild(cardEl);
    }

    this.worldElement.appendChild(this.marqueeElement);

    this.applyViewport(doc.viewport, state.gridSize);
    this.applyDecorations(doc, state);
  }

  private setRectStyle(el: HTMLElement, r: Rect): void {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  /** ドラッグ・リサイズ中の位置更新。要素が足りなければ false を返す（呼び出し側で render する）。 */
  public applyGeometry(doc: PlotDocument, state: CanvasRenderState): boolean {
    for (const node of doc.nodes) {
      const el = this.nodeElements.get(node.id);
      if (!el) {
        return false;
      }
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = node.width ? `${node.width}px` : '';
    }
    for (const frame of doc.frames) {
      const el = this.frameElements.get(frame.id);
      if (!el) {
        return false;
      }
      this.setRectStyle(el, frame);
    }
    this.renderEdges(doc, state);
    return true;
  }

  /** 選択・減光・接続候補などの状態をクラスの付け替えで反映し、ワイヤーを描き直す。 */
  public applyDecorations(doc: PlotDocument, state: CanvasRenderState): void {
    const primaryId = state.selectedNodeIds.size === 1 ? [...state.selectedNodeIds][0] : null;
    const traceSubgraph =
      state.traceModeEnabled && primaryId ? extractConnectedSubgraph(doc, primaryId) : null;
    this.worldElement.classList.toggle('is-trace-mode', Boolean(traceSubgraph));

    const dimmed = new Set<string>();
    for (const node of doc.nodes) {
      const el = this.nodeElements.get(node.id);
      if (!el) {
        continue;
      }
      const isDimmed =
        (traceSubgraph !== null && !traceSubgraph.nodeIds.has(node.id)) ||
        !nodeMatchesFilters(node, state.filterQuery, state.certaintyFilter);
      if (isDimmed) {
        dimmed.add(node.id);
      }
      el.classList.toggle('is-selected', state.selectedNodeIds.has(node.id));
      el.classList.toggle('is-trace-dimmed', isDimmed);
    }
    for (const [frameId, el] of this.frameElements) {
      el.classList.toggle('is-selected', frameId === state.selectedFrameId);
    }

    const drag = state.activeSocketDrag;
    this.worldElement.classList.toggle('is-socket-dragging', Boolean(drag));
    const pins = this.worldElement.querySelectorAll<HTMLElement>('.nplot-socket-pin');
    pins.forEach((pin) => {
      if (!drag) {
        pin.classList.remove('is-compatible-target', 'is-incompatible-target');
        return;
      }
      const compatible =
        pin.dataset.direction === 'in' &&
        pin.dataset.nodeId !== drag.fromNodeId &&
        pin.dataset.dataType === drag.dataType;
      pin.classList.toggle('is-compatible-target', compatible);
      pin.classList.toggle('is-incompatible-target', !compatible);
    });

    for (const [t, btn] of this.wireButtons) {
      btn.classList.toggle('is-active', !state.hiddenWireTypes.has(t));
    }

    this.renderEdges(doc, state, traceSubgraph?.edgeIds ?? null, dimmed);
  }

  private lastDimmed: ReadonlySet<string> = new Set();
  private lastTraceEdges: Set<string> | null = null;

  private renderEdges(
    doc: PlotDocument,
    state: CanvasRenderState,
    traceEdgeIds?: Set<string> | null,
    dimmed?: ReadonlySet<string>
  ): void {
    if (traceEdgeIds !== undefined) {
      this.lastTraceEdges = traceEdgeIds;
    }
    if (dimmed !== undefined) {
      this.lastDimmed = dimmed;
    }
    const socketPositions = this.computeSocketWorldPositions(doc);
    this.edgeRenderer.render(
      doc,
      socketPositions,
      state.selectedEdgeId,
      this.lastTraceEdges,
      state.tempWire,
      state.hiddenWireTypes,
      this.lastDimmed
    );
  }

  /** 一時ワイヤーのみの更新（ソケットドラッグ中）。 */
  public updateTempWire(doc: PlotDocument, state: CanvasRenderState): void {
    this.renderEdges(doc, state);
  }

  public setMarquee(rect: Rect | null): void {
    if (!rect) {
      this.marqueeElement.style.display = 'none';
      return;
    }
    this.marqueeElement.style.display = 'block';
    this.setRectStyle(this.marqueeElement, rect);
  }

  /** ノードの実寸（ワールド座標）。高さは内容で変わるため DOM から測る。 */
  public getNodeRects(doc: PlotDocument): Map<string, Rect> {
    const rects = new Map<string, Rect>();
    for (const node of doc.nodes) {
      const el = this.nodeElements.get(node.id);
      rects.set(node.id, {
        x: node.x,
        y: node.y,
        width: el?.offsetWidth || node.width || 232,
        height: el?.offsetHeight || 160,
      });
    }
    return rects;
  }

  public computeSocketWorldPositions(doc: PlotDocument): Map<string, SocketPosition> {
    const positions = new Map<string, SocketPosition>();
    const worldRect = this.worldElement.getBoundingClientRect();
    const zoom = doc.viewport.zoom || 1;

    const pins = this.worldElement.querySelectorAll<HTMLElement>('.nplot-socket-pin');
    pins.forEach((pin) => {
      const nodeId = pin.dataset.nodeId;
      const socketId = pin.dataset.socketId;
      if (!nodeId || !socketId) {
        return;
      }
      const rect = pin.getBoundingClientRect();
      const centerX = (rect.left + rect.width / 2 - worldRect.left) / zoom;
      const centerY = (rect.top + rect.height / 2 - worldRect.top) / zoom;
      positions.set(`${nodeId}:${socketId}`, { x: centerX, y: centerY });
    });

    return positions;
  }
}
