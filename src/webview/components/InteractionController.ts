import {
  connectSockets,
  createNode,
  promoteNodeCategory,
  removeEdge,
  removeNode,
} from '../../core/graphEngine';
import { parsePlotDocument, serializePlotDocument } from '../../core/serializer';
import {
  EditorViewMode,
  NodeCategory,
  PlotConfig,
  PlotDocument,
  PlotNode,
  PlotSocket,
} from '../../core/types';
import { CanvasViewport } from './CanvasViewport';
import { TempWireState } from './EdgeRenderer';
import { InspectorPanel } from './InspectorPanel';
import { ActiveSocketDragInfo } from './NodeCard';
import { OutlinePanel } from './OutlinePanel';
import { Toolbar } from './Toolbar';

export interface InteractionHostBridge {
  commitDocument: (doc: PlotDocument) => void;
  updateConfig: (partial: Partial<PlotConfig>) => void;
  openManuscript: (node: PlotNode, createIfMissing: boolean) => void;
  requestExport: (format: 'markdown' | 'sync_genkou') => void;
  requestRestoreBackup: () => void;
  openInTextEditor: () => void;
}

export class InteractionController {
  private doc: PlotDocument;
  private config: PlotConfig;

  private selectedNodeId: string | null = null;
  private selectedEdgeId: string | null = null;
  private selectedFrameId: string | null = null;
  private filterQuery = '';
  private viewMode: EditorViewMode = 'node';
  private showOutlineDrawer = false;
  private showInspector = true;
  private traceModeEnabled = false;

  private activeSocketDrag: ActiveSocketDragInfo | null = null;
  private tempWire: TempWireState | null = null;

  public readonly toolbar: Toolbar;
  public readonly canvasViewport: CanvasViewport;
  public readonly jsonViewElement: HTMLElement;
  private readonly jsonTextarea: HTMLTextAreaElement;
  private readonly jsonStatusEl: HTMLElement;
  public readonly inspectorPanel: InspectorPanel;
  public readonly outlinePanel: OutlinePanel;

  constructor(
    initialDoc: PlotDocument,
    initialConfig: PlotConfig,
    private readonly bridge: InteractionHostBridge
  ) {
    this.doc = initialDoc;
    this.config = initialConfig;

    this.toolbar = new Toolbar({
      onAddNode: (cat) => {
        if (this.viewMode !== 'node') {
          this.viewMode = 'node';
        }
        this.addNodeAtViewportCenter(cat);
      },
      onAddFrame: () => {
        if (this.viewMode !== 'node') {
          this.viewMode = 'node';
        }
        this.addFrameAtViewportCenter();
      },
      onFilterChange: (q) => {
        this.filterQuery = q;
        this.renderCanvasOnly();
      },
      onChangeViewMode: (mode) => {
        if (this.viewMode === mode) {
          return;
        }
        this.viewMode = mode;
        this.renderAll();
      },
      onToggleOutlineDrawer: () => {
        this.showOutlineDrawer = !this.showOutlineDrawer;
        this.renderAll();
      },
      onToggleInspector: () => {
        this.showInspector = !this.showInspector;
        this.renderAll();
      },
      onToggleTraceMode: () => {
        this.traceModeEnabled = !this.traceModeEnabled;
        this.renderAll();
      },
      onThemeChange: (theme) => {
        this.config = { ...this.config, theme };
        document.body.dataset.theme = theme;
        this.bridge.updateConfig({ theme });
        this.renderAll();
      },
      onExportMarkdown: () => this.bridge.requestExport('markdown'),
      onSyncGenkou: () => this.bridge.requestExport('sync_genkou'),
      onRestoreBackup: () => this.bridge.requestRestoreBackup(),
    });

    this.jsonViewElement = document.createElement('section');
    this.jsonViewElement.className = 'nplot-json-view is-hidden';

    const jsonHeader = document.createElement('div');
    jsonHeader.className = 'nplot-json-header';

    this.jsonStatusEl = document.createElement('span');
    this.jsonStatusEl.className = 'nplot-json-status is-valid';
    this.jsonStatusEl.textContent = '✓ JSON構文: 正常';

    const jsonActions = document.createElement('div');
    jsonActions.className = 'nplot-toolbar-group';

    const formatBtn = document.createElement('button');
    formatBtn.className = 'nplot-btn';
    formatBtn.textContent = 'JSON整形';
    formatBtn.title = '現在のプロット構造でJSONを綺麗にインデント整形';
    formatBtn.addEventListener('click', () => {
      this.jsonTextarea.value = serializePlotDocument(this.doc);
      this.jsonStatusEl.className = 'nplot-json-status is-valid';
      this.jsonStatusEl.textContent = '✓ JSON構文: 整形済み';
    });

    const nativeEditorBtn = document.createElement('button');
    nativeEditorBtn.className = 'nplot-btn';
    nativeEditorBtn.textContent = 'VS Code標準エディタで開く';
    nativeEditorBtn.title = 'VS Code標準のJSONテキストエディタに切り替えて開く';
    nativeEditorBtn.addEventListener('click', () => this.bridge.openInTextEditor());

    jsonActions.appendChild(formatBtn);
    jsonActions.appendChild(nativeEditorBtn);

    jsonHeader.appendChild(this.jsonStatusEl);
    jsonHeader.appendChild(jsonActions);

    this.jsonTextarea = document.createElement('textarea');
    this.jsonTextarea.className = 'nplot-json-editor';
    this.jsonTextarea.spellcheck = false;
    this.jsonTextarea.addEventListener('input', () => {
      try {
        JSON.parse(this.jsonTextarea.value);
        const parsed = parsePlotDocument(this.jsonTextarea.value);
        this.doc = parsed;
        this.jsonStatusEl.className = 'nplot-json-status is-valid';
        this.jsonStatusEl.textContent = `✓ JSON構文: 正常（ノード ${parsed.nodes.length}件・エッジ ${parsed.edges.length}件）`;
        this.bridge.commitDocument(this.doc);
        this.inspectorPanel.render(
          this.doc,
          this.showInspector,
          this.selectedNodeId,
          this.selectedEdgeId,
          this.selectedFrameId
        );
        this.outlinePanel.render(this.doc, this.showOutlineDrawer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.jsonStatusEl.className = 'nplot-json-status is-error';
        this.jsonStatusEl.textContent = `⚠ JSON構文エラー: ${msg}`;
      }
    });

    this.jsonViewElement.appendChild(jsonHeader);
    this.jsonViewElement.appendChild(this.jsonTextarea);

    this.canvasViewport = new CanvasViewport({
      onSelectNode: (id) => {
        this.selectedNodeId = id;
        if (id) {
          this.selectedEdgeId = null;
          this.selectedFrameId = null;
        }
        this.renderAll();
      },
      onSelectEdge: (id) => {
        this.selectedEdgeId = id;
        if (id) {
          this.selectedNodeId = null;
          this.selectedFrameId = null;
        }
        this.renderAll();
      },
      onSelectFrame: (id) => {
        this.selectedFrameId = id;
        if (id) {
          this.selectedNodeId = null;
          this.selectedEdgeId = null;
        }
        this.renderAll();
      },
      onDoubleClickCanvas: (clientX, clientY) => {
        const worldX = (clientX - this.doc.viewport.panX) / this.doc.viewport.zoom;
        const worldY = (clientY - this.doc.viewport.panY) / this.doc.viewport.zoom;
        const newNode = createNode({
          category: 'note',
          x: this.snap(worldX - 110),
          y: this.snap(worldY - 30),
        });
        this.doc = { ...this.doc, nodes: [...this.doc.nodes, newNode] };
        this.selectedNodeId = newNode.id;
        this.bridge.commitDocument(this.doc);
        this.renderAll();
      },
      onStartPan: (e) => this.handlePanGesture(e),
      onWheelZoom: (e) => this.handleWheelZoom(e),
      onSetZoomLevel: (newZoom, commit) => this.setZoomCentered(newZoom, commit),
      onFitView: () => this.fitToScreen(),
      onResetZoom: () => {
        this.setZoomCentered(1.0, true);
      },
      onStartDragNode: (nodeId, e) => this.handleNodeDragGesture(nodeId, e),
      onStartDragFrame: (frameId, e) => this.handleFrameDragGesture(frameId, e),
      onPromoteCategory: (nodeId, cat) => {
        this.doc = promoteNodeCategory(this.doc, nodeId, cat);
        this.bridge.commitDocument(this.doc);
        this.renderAll();
      },
      onStartSocketDrag: (nodeId, sock, e) => this.handleSocketDragGesture(nodeId, sock, e),
      onCompleteSocketDrop: (nodeId, sock) => this.handleSocketDrop(nodeId, sock),
      onOpenManuscript: (node) => this.bridge.openManuscript(node, false),
    });

    this.inspectorPanel = new InspectorPanel({
      onDocumentMutated: (nextDoc) => {
        this.doc = nextDoc;
        this.bridge.commitDocument(this.doc);
        this.renderAll();
      },
      onClearSelection: () => {
        this.selectedNodeId = null;
        this.selectedEdgeId = null;
        this.selectedFrameId = null;
      },
      onCloseInspector: () => {
        this.showInspector = false;
        this.renderAll();
      },
      onOpenManuscript: (node, createIfMissing) =>
        this.bridge.openManuscript(node, createIfMissing),
    });

    this.outlinePanel = new OutlinePanel((nodeId) => {
      this.focusNode(nodeId);
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedNodeId) {
          this.doc = removeNode(this.doc, this.selectedNodeId);
          this.selectedNodeId = null;
          this.bridge.commitDocument(this.doc);
          this.renderAll();
        } else if (this.selectedEdgeId) {
          this.doc = removeEdge(this.doc, this.selectedEdgeId);
          this.selectedEdgeId = null;
          this.bridge.commitDocument(this.doc);
          this.renderAll();
        }
      }
    });
  }

  public setDocumentAndConfig(doc: PlotDocument, config?: PlotConfig): void {
    this.doc = doc;
    if (config) {
      this.config = config;
      document.body.dataset.theme = config.theme;
    }
    this.renderAll();
  }

  public setZoomCentered(targetZoom: number, commit: boolean): void {
    const clampedZoom = Math.max(0.25, Math.min(2.0, Math.round(targetZoom * 1000) / 1000));
    const oldZoom = this.doc.viewport.zoom;
    if (clampedZoom === oldZoom) {
      return;
    }
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const cx = (rect.width || 720) / 2;
    const cy = (rect.height || 480) / 2;
    const worldX = (cx - this.doc.viewport.panX) / oldZoom;
    const worldY = (cy - this.doc.viewport.panY) / oldZoom;
    const panX = Math.round(cx - worldX * clampedZoom);
    const panY = Math.round(cy - worldY * clampedZoom);

    this.doc = {
      ...this.doc,
      viewport: { panX, panY, zoom: clampedZoom },
    };
    this.renderCanvasOnly();
    if (commit) {
      this.bridge.commitDocument(this.doc);
    }
  }

  public fitToScreen(): void {
    if (this.doc.nodes.length === 0) {
      return;
    }
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const viewW = rect.width || 720;
    const viewH = rect.height || 480;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of this.doc.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + 240);
      maxY = Math.max(maxY, n.y + 210);
    }
    for (const f of this.doc.frames) {
      minX = Math.min(minX, f.x);
      minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.width);
      maxY = Math.max(maxY, f.y + f.height);
    }

    const contentW = Math.max(300, maxX - minX + 60);
    const contentH = Math.max(240, maxY - minY + 60);
    const scaleX = viewW / contentW;
    const scaleY = viewH / contentH;
    const zoom = Math.max(0.4, Math.min(1.0, Number(Math.min(scaleX, scaleY).toFixed(2))));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const panX = Math.round(viewW / 2 - centerX * zoom);
    const panY = Math.round(viewH / 2 - centerY * zoom);

    this.doc = {
      ...this.doc,
      viewport: { panX, panY, zoom },
    };
    this.bridge.commitDocument(this.doc);
    this.renderAll();
  }

  public focusNode(nodeId: string): void {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }
    this.selectedNodeId = nodeId;
    this.selectedEdgeId = null;
    this.selectedFrameId = null;
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const zoom = this.doc.viewport.zoom;
    const panX = Math.round(rect.width / 2 - (node.x + 116) * zoom);
    const panY = Math.round(rect.height / 2 - (node.y + 80) * zoom);
    this.doc = {
      ...this.doc,
      viewport: { ...this.doc.viewport, panX, panY },
    };
    this.renderAll();
  }

  public renderAll(): void {
    this.toolbar.render(
      this.doc,
      this.config,
      this.filterQuery,
      this.viewMode,
      this.showOutlineDrawer,
      this.showInspector,
      this.traceModeEnabled
    );
    const isJsonMode = this.viewMode === 'json';
    this.canvasViewport.viewportElement.classList.toggle('is-hidden', isJsonMode);
    this.jsonViewElement.classList.toggle('is-hidden', !isJsonMode);
    if (isJsonMode) {
      if (document.activeElement !== this.jsonTextarea) {
        this.jsonTextarea.value = serializePlotDocument(this.doc);
        this.jsonStatusEl.className = 'nplot-json-status is-valid';
        this.jsonStatusEl.textContent = `✓ JSON構文: 正常（ノード ${this.doc.nodes.length}件・エッジ ${this.doc.edges.length}件）`;
      }
    } else {
      this.renderCanvasOnly();
    }
    this.inspectorPanel.render(
      this.doc,
      this.showInspector,
      this.selectedNodeId,
      this.selectedEdgeId,
      this.selectedFrameId
    );
    this.outlinePanel.render(this.doc, this.showOutlineDrawer);
  }

  private renderCanvasOnly(): void {
    this.canvasViewport.render(
      this.doc,
      this.config,
      this.selectedNodeId,
      this.selectedEdgeId,
      this.selectedFrameId,
      this.filterQuery,
      this.traceModeEnabled,
      this.activeSocketDrag,
      this.tempWire
    );
  }

  private addNodeAtViewportCenter(category: NodeCategory): void {
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const { panX, panY, zoom } = this.doc.viewport;
    const worldX = ((rect.width || 700) / 2 - panX) / zoom - 116;
    const worldY = ((rect.height || 450) / 2 - panY) / zoom - 60;
    const node = createNode({
      category,
      x: this.snap(worldX + (this.doc.nodes.length % 5) * 20),
      y: this.snap(worldY + (this.doc.nodes.length % 5) * 20),
    });
    this.doc = { ...this.doc, nodes: [...this.doc.nodes, node] };
    this.selectedNodeId = node.id;
    this.bridge.commitDocument(this.doc);
    this.renderAll();
  }

  private addFrameAtViewportCenter(): void {
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const { panX, panY, zoom } = this.doc.viewport;
    const worldX = this.snap(((rect.width || 700) / 2 - panX) / zoom - 240);
    const worldY = this.snap(((rect.height || 450) / 2 - panY) / zoom - 150);
    const newFrame = {
      id: `frame_${Date.now()}`,
      title: `第${this.doc.frames.length + 1}幕・エリア`,
      x: worldX,
      y: worldY,
      width: 500,
      height: 300,
    };
    this.doc = { ...this.doc, frames: [...this.doc.frames, newFrame] };
    this.selectedFrameId = newFrame.id;
    this.bridge.commitDocument(this.doc);
    this.renderAll();
  }

  private handlePanGesture(startEvent: PointerEvent): void {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const initialPanX = this.doc.viewport.panX;
    const initialPanY = this.doc.viewport.panY;
    this.canvasViewport.viewportElement.classList.add('is-panning');

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      this.doc = {
        ...this.doc,
        viewport: {
          ...this.doc.viewport,
          panX: Math.round(initialPanX + dx),
          panY: Math.round(initialPanY + dy),
        },
      };
      this.renderCanvasOnly();
    };

    const onUp = () => {
      this.canvasViewport.viewportElement.classList.remove('is-panning');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.bridge.commitDocument(this.doc);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * トラックパッドの連続スクロール・ピンチ操作でも急激に拡大縮小しないよう、
   * 1イベントあたりの変化量をクランプした緩やかな指数減衰カーブで倍率を計算する。
   */
  private handleWheelZoom(e: WheelEvent): void {
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const oldZoom = this.doc.viewport.zoom;

    // 1回のホイールイベントあたり最大でも約±2.5%以内の緩やかな変化に抑える
    const clampedDelta = Math.max(-20, Math.min(20, e.deltaY));
    const sensitivity = e.ctrlKey ? 0.0032 : 0.0012;
    const factor = Math.exp(-clampedDelta * sensitivity);
    const newZoom = Math.max(
      0.25,
      Math.min(2.0, Math.round(oldZoom * factor * 1000) / 1000)
    );
    if (newZoom === oldZoom) {
      return;
    }

    const worldX = (cursorX - this.doc.viewport.panX) / oldZoom;
    const worldY = (cursorY - this.doc.viewport.panY) / oldZoom;
    const panX = Math.round(cursorX - worldX * newZoom);
    const panY = Math.round(cursorY - worldY * newZoom);

    this.doc = {
      ...this.doc,
      viewport: { panX, panY, zoom: newZoom },
    };
    this.renderCanvasOnly();
  }

  private handleNodeDragGesture(nodeId: string, startEvent: PointerEvent): void {
    const target = this.doc.nodes.find((n) => n.id === nodeId);
    if (!target) {
      return;
    }
    const startClientX = startEvent.clientX;
    const startClientY = startEvent.clientY;
    const initialX = target.x;
    const initialY = target.y;
    const zoom = this.doc.viewport.zoom;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
      const nextX = this.snap(initialX + dx);
      const nextY = this.snap(initialY + dy);
      this.doc = {
        ...this.doc,
        nodes: this.doc.nodes.map((n) =>
          n.id === nodeId ? { ...n, x: nextX, y: nextY } : n
        ),
      };
      this.renderCanvasOnly();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        this.bridge.commitDocument(this.doc);
        this.outlinePanel.render(this.doc, this.showOutlineDrawer);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleFrameDragGesture(frameId: string, startEvent: PointerEvent): void {
    const frame = this.doc.frames.find((f) => f.id === frameId);
    if (!frame) {
      return;
    }
    const startClientX = startEvent.clientX;
    const startClientY = startEvent.clientY;
    const initFrameX = frame.x;
    const initFrameY = frame.y;
    const zoom = this.doc.viewport.zoom;

    const enclosedNodeInitials = new Map<string, { x: number; y: number }>();
    for (const n of this.doc.nodes) {
      if (
        n.x >= frame.x &&
        n.x <= frame.x + frame.width &&
        n.y >= frame.y &&
        n.y <= frame.y + frame.height
      ) {
        enclosedNodeInitials.set(n.id, { x: n.x, y: n.y });
      }
    }

    let moved = false;
    const onMove = (ev: PointerEvent) => {
      moved = true;
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
      const nextFrameX = this.snap(initFrameX + dx);
      const nextFrameY = this.snap(initFrameY + dy);
      const actualDx = nextFrameX - initFrameX;
      const actualDy = nextFrameY - initFrameY;

      this.doc = {
        ...this.doc,
        frames: this.doc.frames.map((f) =>
          f.id === frameId ? { ...f, x: nextFrameX, y: nextFrameY } : f
        ),
        nodes: this.doc.nodes.map((n) => {
          const initPos = enclosedNodeInitials.get(n.id);
          if (!initPos) {
            return n;
          }
          return { ...n, x: initPos.x + actualDx, y: initPos.y + actualDy };
        }),
      };
      this.renderCanvasOnly();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved) {
        this.bridge.commitDocument(this.doc);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleSocketDragGesture(
    fromNodeId: string,
    socket: PlotSocket,
    startEvent: PointerEvent
  ): void {
    const positions = this.canvasViewport.computeSocketWorldPositions(this.doc);
    const startPos = positions.get(`${fromNodeId}:${socket.id}`);
    if (!startPos) {
      return;
    }

    this.activeSocketDrag = {
      fromNodeId,
      fromSocketId: socket.id,
      dataType: socket.dataType,
    };

    const toWorldCoords = (ev: PointerEvent) => {
      const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
      const { panX, panY, zoom } = this.doc.viewport;
      return {
        x: (ev.clientX - rect.left - panX) / zoom,
        y: (ev.clientY - rect.top - panY) / zoom,
      };
    };

    const p0 = toWorldCoords(startEvent);
    this.tempWire = {
      fromX: startPos.x,
      fromY: startPos.y,
      toX: p0.x,
      toY: p0.y,
      dataType: socket.dataType,
    };
    this.renderCanvasOnly();

    const onMove = (ev: PointerEvent) => {
      if (!this.tempWire) {
        return;
      }
      const pt = toWorldCoords(ev);
      this.tempWire = {
        ...this.tempWire,
        toX: pt.x,
        toY: pt.y,
      };
      this.renderCanvasOnly();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.activeSocketDrag = null;
      this.tempWire = null;
      this.renderCanvasOnly();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleSocketDrop(toNodeId: string, toSocket: PlotSocket): void {
    if (!this.activeSocketDrag) {
      return;
    }
    const { fromNodeId, fromSocketId } = this.activeSocketDrag;
    this.activeSocketDrag = null;
    this.tempWire = null;

    const result = connectSockets(
      this.doc,
      fromNodeId,
      fromSocketId,
      toNodeId,
      toSocket.id
    );
    if (result.addedEdge) {
      this.doc = result.document;
      this.selectedEdgeId = result.addedEdge.id;
      this.selectedNodeId = null;
      this.bridge.commitDocument(this.doc);
      this.renderAll();
    } else {
      this.renderCanvasOnly();
    }
  }

  private snap(value: number): number {
    if (!this.config.snapToGrid) {
      return Math.round(value);
    }
    const g = this.config.gridSize || 20;
    return Math.round(value / g) * g;
  }
}
