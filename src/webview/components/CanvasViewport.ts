import { extractConnectedSubgraph } from '../../core/graphEngine';
import {
  NodeCategory,
  PlotConfig,
  PlotDocument,
  PlotNode,
  PlotSocket,
} from '../../core/types';
import { EdgeRenderer, SocketPosition, TempWireState } from './EdgeRenderer';
import { ActiveSocketDragInfo, createNodeCardElement } from './NodeCard';

export interface CanvasViewportCallbacks {
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onSelectFrame: (frameId: string | null) => void;
  onDoubleClickCanvas: (worldX: number, worldY: number) => void;
  onStartPan: (e: PointerEvent) => void;
  onWheelZoom: (e: WheelEvent) => void;
  onSetZoomLevel: (newZoom: number, commit: boolean) => void;
  onFitView: () => void;
  onResetZoom: () => void;
  onStartDragNode: (nodeId: string, e: PointerEvent) => void;
  onStartDragFrame: (frameId: string, e: PointerEvent) => void;
  onPromoteCategory: (nodeId: string, newCategory: NodeCategory) => void;
  onStartSocketDrag: (nodeId: string, socket: PlotSocket, e: PointerEvent) => void;
  onCompleteSocketDrop: (nodeId: string, socket: PlotSocket) => void;
  onOpenManuscript: (node: PlotNode) => void;
}

export class CanvasViewport {
  public readonly viewportElement: HTMLElement;
  public readonly worldElement: HTMLElement;
  private readonly zoomHudElement: HTMLElement;
  private readonly zoomSlider: HTMLInputElement;
  private readonly zoomPctBtn: HTMLButtonElement;
  private readonly edgeRenderer: EdgeRenderer;

  constructor(private readonly callbacks: CanvasViewportCallbacks) {
    this.viewportElement = document.createElement('div');
    this.viewportElement.className = 'nplot-canvas-viewport';

    this.worldElement = document.createElement('div');
    this.worldElement.className = 'nplot-canvas-world';

    this.edgeRenderer = new EdgeRenderer((edgeId) => {
      this.callbacks.onSelectEdge(edgeId);
    });

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
      const nextZoom = Number(this.zoomSlider.value) / 100;
      this.callbacks.onSetZoomLevel(nextZoom, false);
    });
    this.zoomSlider.addEventListener('change', () => {
      const nextZoom = Number(this.zoomSlider.value) / 100;
      this.callbacks.onSetZoomLevel(nextZoom, true);
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
    this.zoomPctBtn.addEventListener('click', () => {
      this.callbacks.onResetZoom();
    });

    const fitBtn = document.createElement('button');
    fitBtn.className = 'nplot-btn';
    fitBtn.textContent = '全体表示';
    fitBtn.title = 'すべてのノードがキャンバス内に収まるよう自動調整';
    fitBtn.addEventListener('click', () => {
      this.callbacks.onFitView();
    });

    this.zoomHudElement.appendChild(zoomOutBtn);
    this.zoomHudElement.appendChild(this.zoomSlider);
    this.zoomHudElement.appendChild(zoomInBtn);
    this.zoomHudElement.appendChild(this.zoomPctBtn);
    this.zoomHudElement.appendChild(fitBtn);

    this.viewportElement.appendChild(this.worldElement);
    this.viewportElement.appendChild(this.zoomHudElement);

    this.viewportElement.addEventListener('pointerdown', (e) => {
      if (e.target === this.viewportElement || e.target === this.worldElement) {
        this.callbacks.onSelectNode(null);
        this.callbacks.onSelectEdge(null);
        this.callbacks.onSelectFrame(null);
        this.callbacks.onStartPan(e);
      }
    });

    this.viewportElement.addEventListener('dblclick', (e) => {
      if (e.target === this.viewportElement || e.target === this.worldElement) {
        const rect = this.viewportElement.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        this.callbacks.onDoubleClickCanvas(clientX, clientY);
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

  public updateZoomHud(zoom: number): void {
    const pct = Math.round(zoom * 100);
    this.zoomSlider.value = String(pct);
    this.zoomPctBtn.textContent = `${pct}%`;
  }

  public render(
    doc: PlotDocument,
    _config: PlotConfig,
    selectedNodeId: string | null,
    selectedEdgeId: string | null,
    selectedFrameId: string | null,
    filterQuery: string,
    traceModeEnabled: boolean,
    activeSocketDrag: ActiveSocketDragInfo | null,
    tempWire: TempWireState | null
  ): void {
    const { panX, panY, zoom } = doc.viewport;
    this.worldElement.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    this.worldElement.classList.toggle('is-lod-compact', zoom < 0.55);
    this.updateZoomHud(zoom);

    const traceSubgraph =
      traceModeEnabled && selectedNodeId
        ? extractConnectedSubgraph(doc, selectedNodeId)
        : null;
    this.worldElement.classList.toggle('is-trace-mode', Boolean(traceSubgraph));

    this.worldElement.innerHTML = '';
    this.worldElement.appendChild(this.edgeRenderer.svgElement);

    // 1. Render Group Frames
    for (const frame of doc.frames) {
      const frameEl = document.createElement('div');
      frameEl.className = `nplot-frame ${frame.id === selectedFrameId ? 'is-selected' : ''}`;
      frameEl.style.left = `${frame.x}px`;
      frameEl.style.top = `${frame.y}px`;
      frameEl.style.width = `${frame.width}px`;
      frameEl.style.height = `${frame.height}px`;

      const header = document.createElement('div');
      header.className = 'nplot-frame-header';
      header.textContent = frame.title;
      header.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.callbacks.onSelectFrame(frame.id);
        this.callbacks.onStartDragFrame(frame.id, e);
      });
      frameEl.appendChild(header);
      this.worldElement.appendChild(frameEl);
    }

    // 2. Render Sticky Nodes
    const queryLower = filterQuery.trim().toLowerCase();
    for (const node of doc.nodes) {
      const matchesFilter =
        !queryLower ||
        node.title.toLowerCase().includes(queryLower) ||
        node.body.toLowerCase().includes(queryLower) ||
        node.tags.some((t) => t.toLowerCase().includes(queryLower)) ||
        node.customParams.some(
          (cp) =>
            cp.key.toLowerCase().includes(queryLower) ||
            cp.value.toLowerCase().includes(queryLower)
        ) ||
        (node.sceneParams?.chapter.toLowerCase().includes(queryLower) ?? false);

      const isTraceDimmed =
        (traceSubgraph !== null && !traceSubgraph.nodeIds.has(node.id)) ||
        !matchesFilter;

      const cardEl = createNodeCardElement(
        doc,
        node,
        node.id === selectedNodeId,
        isTraceDimmed,
        activeSocketDrag,
        {
          onSelectNode: (id) => this.callbacks.onSelectNode(id),
          onStartDragNode: (id, e) => this.callbacks.onStartDragNode(id, e),
          onPromoteCategory: (id, cat) => this.callbacks.onPromoteCategory(id, cat),
          onStartSocketDrag: (id, sock, e) => this.callbacks.onStartSocketDrag(id, sock, e),
          onCompleteSocketDrop: (id, sock) => this.callbacks.onCompleteSocketDrop(id, sock),
          onOpenManuscript: (n) => this.callbacks.onOpenManuscript(n),
        }
      );
      this.worldElement.appendChild(cardEl);
    }

    // 3. Measure Socket Positions in World Coordinates & Render Edges
    const socketPositions = this.computeSocketWorldPositions(doc);
    this.edgeRenderer.render(
      doc,
      socketPositions,
      selectedEdgeId,
      traceSubgraph ? traceSubgraph.edgeIds : null,
      tempWire
    );
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
