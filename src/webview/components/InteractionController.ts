import {
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  Rect,
  ResizeHandle,
  clampNodeWidth,
  collectFrameContents,
  fitFrameToContents,
  rectsIntersect,
  removeFrameWithContents,
  resizeRect,
  wrapInNewFrame,
} from '../../core/frameLayout';
import {
  connectSockets,
  countEdgesLostByPromotion,
  createNode,
  extractNodeClipboard,
  insertNodeClipboard,
  isNodeClipboardPayload,
  promoteNodeCategory,
  removeEdge,
  removeNodes,
  toggleCharacterAppearance,
} from '../../core/graphEngine';
import { parsePlotDocument, serializePlotDocument } from '../../core/serializer';
import {
  EditorViewMode,
  NodeCategory,
  PlotConfig,
  PlotDocument,
  PlotNode,
  PlotSocket,
  SocketDataType,
  ViewportState,
} from '../../core/types';
import { AppearanceMatrixView } from './AppearanceMatrixView';
import {
  CanvasRenderState,
  CanvasViewport,
  CertaintyFilter,
  nodeMatchesFilters,
} from './CanvasViewport';
import { TempWireState } from './EdgeRenderer';
import { InspectorPanel } from './InspectorPanel';
import { LineShelfView } from './LineShelfView';
import { ActiveSocketDragInfo } from './NodeCard';
import { OutlinePanel } from './OutlinePanel';
import { Toast } from './Toast';
import { Toolbar } from './Toolbar';

export interface PersistedViewState {
  viewport?: ViewportState;
  hiddenWireTypes?: SocketDataType[];
  showOutlineDrawer?: boolean;
  showInspector?: boolean;
  viewMode?: EditorViewMode;
}

export interface InteractionHostBridge {
  commitDocument: (doc: PlotDocument) => void;
  updateConfig: (partial: Partial<PlotConfig>) => void;
  openManuscript: (node: PlotNode, createIfMissing: boolean) => void;
  requestExport: (format: 'markdown' | 'sync_genkou') => void;
  requestRestoreBackup: () => void;
  openInTextEditor: () => void;
  /** パン・ズーム・表示設定を Webview の状態として保存する（ファイルは変更しない）。 */
  saveViewState: (state: PersistedViewState) => void;
}

const DRAG_THRESHOLD_PX = 3;

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export class InteractionController {
  private doc: PlotDocument;
  private config: PlotConfig;

  private selectedNodeIds = new Set<string>();
  private selectedEdgeId: string | null = null;
  private selectedFrameId: string | null = null;
  private filterQuery = '';
  private certaintyFilter: CertaintyFilter = 'all';
  private searchCursor = -1;
  private viewMode: EditorViewMode = 'node';
  private showOutlineDrawer = false;
  private showInspector = true;
  private traceModeEnabled = false;
  private hiddenWireTypes = new Set<SocketDataType>();
  private parseError: string | null = null;
  private pasteCount = 0;

  private activeSocketDrag: ActiveSocketDragInfo | null = null;
  private tempWire: TempWireState | null = null;
  private pendingFrame: number | null = null;
  private viewStateTimer: number | undefined;

  public readonly toolbar: Toolbar;
  public readonly canvasViewport: CanvasViewport;
  public readonly matrixView: AppearanceMatrixView;
  public readonly lineShelfView: LineShelfView;
  public readonly jsonViewElement: HTMLElement;
  private readonly jsonTextarea: HTMLTextAreaElement;
  private readonly jsonStatusEl: HTMLElement;
  public readonly inspectorPanel: InspectorPanel;
  public readonly outlinePanel: OutlinePanel;
  public readonly toast: Toast;
  public readonly parseErrorElement: HTMLElement;
  private readonly parseErrorMessageEl: HTMLElement;

  constructor(
    initialDoc: PlotDocument,
    initialConfig: PlotConfig,
    private readonly bridge: InteractionHostBridge
  ) {
    this.doc = initialDoc;
    this.config = initialConfig;
    this.toast = new Toast();

    this.toolbar = new Toolbar({
      onAddNode: (cat) => {
        this.switchViewMode('node');
        this.addNodeAtViewportCenter(cat);
      },
      onAddFrame: () => {
        this.switchViewMode('node');
        if (this.selectedNodeIds.size > 0) {
          this.wrapSelectionInFrame();
        } else {
          this.addFrameAtViewportCenter();
        }
      },
      onFilterChange: (q) => {
        this.filterQuery = q;
        this.searchCursor = -1;
        this.renderDecorations();
      },
      onSearchNext: (backwards) => this.jumpToNextMatch(backwards),
      onCertaintyFilterChange: (filter) => {
        this.certaintyFilter = filter;
        this.renderToolbar();
        this.renderDecorations();
      },
      onChangeViewMode: (mode) => this.switchViewMode(mode),
      onToggleOutlineDrawer: () => {
        this.showOutlineDrawer = !this.showOutlineDrawer;
        this.scheduleViewStateSave();
        this.renderAll();
      },
      onToggleInspector: () => {
        this.showInspector = !this.showInspector;
        this.scheduleViewStateSave();
        this.renderAll();
      },
      onToggleTraceMode: () => {
        this.traceModeEnabled = !this.traceModeEnabled;
        this.renderToolbar();
        this.renderDecorations();
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

    // --- JSON view ---
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

    jsonActions.append(formatBtn, nativeEditorBtn);
    jsonHeader.append(this.jsonStatusEl, jsonActions);

    this.jsonTextarea = document.createElement('textarea');
    this.jsonTextarea.className = 'nplot-json-editor';
    this.jsonTextarea.spellcheck = false;
    this.jsonTextarea.addEventListener('input', () => {
      try {
        JSON.parse(this.jsonTextarea.value);
        const parsed = parsePlotDocument(this.jsonTextarea.value);
        this.jsonStatusEl.className = 'nplot-json-status is-valid';
        this.jsonStatusEl.textContent = `✓ JSON構文: 正常（ノード ${parsed.nodes.length}件・エッジ ${parsed.edges.length}件）`;
        this.commit({ ...parsed, viewport: this.doc.viewport }, { render: false });
        this.renderSidePanels();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.jsonStatusEl.className = 'nplot-json-status is-error';
        this.jsonStatusEl.textContent = `⚠ JSON構文エラー: ${msg}`;
      }
    });

    this.jsonViewElement.append(jsonHeader, this.jsonTextarea);

    // --- Parse error overlay ---
    this.parseErrorElement = document.createElement('div');
    this.parseErrorElement.className = 'nplot-parse-error is-hidden';
    const peTitle = document.createElement('div');
    peTitle.className = 'nplot-parse-error-title';
    peTitle.textContent = '⚠ プロットファイルの JSON が壊れているため、編集を一時停止しています';
    this.parseErrorMessageEl = document.createElement('div');
    this.parseErrorMessageEl.className = 'nplot-parse-error-message';
    const peHelp = document.createElement('div');
    peHelp.className = 'nplot-help';
    peHelp.textContent =
      'データを守るため、修正されるまでキャンバスからの変更は保存しません。テキストエディタで修正するか、⌘Z で直前の状態に戻すと自動で再開します。';
    const peBtn = document.createElement('button');
    peBtn.className = 'nplot-btn is-primary';
    peBtn.textContent = 'テキストエディタで開いて修正';
    peBtn.addEventListener('click', () => this.bridge.openInTextEditor());
    const peRestore = document.createElement('button');
    peRestore.className = 'nplot-btn';
    peRestore.textContent = 'バックアップから復元';
    peRestore.addEventListener('click', () => this.bridge.requestRestoreBackup());
    const peActions = document.createElement('div');
    peActions.className = 'nplot-field-row';
    peActions.append(peBtn, peRestore);
    this.parseErrorElement.append(peTitle, this.parseErrorMessageEl, peHelp, peActions);

    // --- Canvas ---
    this.canvasViewport = new CanvasViewport({
      onBackgroundPointerDown: (e) => this.handleBackgroundPointerDown(e),
      onDoubleClickCanvas: (clientX, clientY) => {
        const worldX = (clientX - this.doc.viewport.panX) / this.doc.viewport.zoom;
        const worldY = (clientY - this.doc.viewport.panY) / this.doc.viewport.zoom;
        const newNode = createNode({
          category: 'note',
          x: this.snap(worldX - 110),
          y: this.snap(worldY - 30),
        });
        this.setSelection({ nodeIds: [newNode.id] }, false);
        this.commit({ ...this.doc, nodes: [...this.doc.nodes, newNode] });
      },
      onWheelZoom: (e) => this.handleWheelZoom(e),
      onSetZoomLevel: (newZoom) => this.setZoomCentered(newZoom),
      onFitView: () => this.fitToScreen(),
      onResetZoom: () => this.setZoomCentered(1.0),
      onNodePointerDown: (nodeId, e) => this.handleNodePointerDown(nodeId, e),
      onStartDragNode: (nodeId, e) => this.handleNodeDragGesture(nodeId, e),
      onStartResizeNode: (nodeId, e) => this.handleNodeResizeGesture(nodeId, e),
      onResetNodeWidth: (nodeId) => {
        this.commit({
          ...this.doc,
          nodes: this.doc.nodes.map((n) => {
            if (n.id !== nodeId) {
              return n;
            }
            const next = { ...n };
            delete next.width;
            return next;
          }),
        });
      },
      onRenameNode: (nodeId, title) => {
        this.commit({
          ...this.doc,
          nodes: this.doc.nodes.map((n) => (n.id === nodeId ? { ...n, title } : n)),
        });
      },
      onFramePointerDown: (frameId, e) => {
        this.setSelection({ frameId });
        this.handleFrameDragGesture(frameId, e);
      },
      onStartResizeFrame: (frameId, handle, e) => {
        this.setSelection({ frameId });
        this.handleFrameResizeGesture(frameId, handle, e);
      },
      onRenameFrame: (frameId, title) => {
        this.commit({
          ...this.doc,
          frames: this.doc.frames.map((f) => (f.id === frameId ? { ...f, title } : f)),
        });
      },
      onEdgePointerDown: (edgeId) => this.setSelection({ edgeId }),
      onPromoteCategory: (nodeId, cat) => this.promoteCategory(nodeId, cat),
      onStartSocketDrag: (nodeId, sock, e) => this.handleSocketDragGesture(nodeId, sock, e),
      onOpenManuscript: (node) => this.bridge.openManuscript(node, false),
      onOpenLineShelf: (opts) => this.openLineShelf(opts),
      onToggleWireType: (t) => {
        if (this.hiddenWireTypes.has(t)) {
          this.hiddenWireTypes.delete(t);
        } else {
          this.hiddenWireTypes.add(t);
        }
        this.scheduleViewStateSave();
        this.renderDecorations();
      },
    });
    this.canvasViewport.viewportElement.appendChild(this.toast.element);

    // --- Matrix view ---
    this.matrixView = new AppearanceMatrixView({
      onToggleAppearance: (charId, sceneId) => {
        const result = toggleCharacterAppearance(this.doc, charId, sceneId);
        if (result.reason) {
          this.toast.show(result.reason, 'warning');
          return;
        }
        this.commit(result.document);
      },
      onFocusNode: (nodeId) => {
        this.switchViewMode('node');
        this.focusNode(nodeId);
      },
    });

    // --- Line shelf view ---
    this.lineShelfView = new LineShelfView({
      onDocumentMutated: (next) => this.commit(next),
      onFocusNode: (nodeId) => {
        this.switchViewMode('node');
        this.focusNode(nodeId);
      },
      onNotify: (message, kind) => this.toast.show(message, kind ?? 'info'),
    });

    // --- Inspector ---
    this.inspectorPanel = new InspectorPanel({
      onDocumentMutated: (nextDoc) => this.commit(nextDoc),
      onClearSelection: () => this.setSelection({}, false),
      onCloseInspector: () => {
        this.showInspector = false;
        this.scheduleViewStateSave();
        this.renderAll();
      },
      onOpenManuscript: (node, createIfMissing) =>
        this.bridge.openManuscript(node, createIfMissing),
      onPromoteCategory: (nodeId, cat) => this.promoteCategory(nodeId, cat),
      onDeleteSelection: () => this.deleteSelection(),
      onDuplicateSelection: () => this.duplicateSelection(),
      onWrapSelectionInFrame: () => this.wrapSelectionInFrame(),
      onFitFrameToContents: (frameId) => {
        const rects = this.canvasViewport.getNodeRects(this.doc);
        this.commit(fitFrameToContents(this.doc, frameId, rects));
      },
      onDeleteFrame: (frameId, withContents) => {
        const next = withContents
          ? removeFrameWithContents(this.doc, frameId)
          : { ...this.doc, frames: this.doc.frames.filter((f) => f.id !== frameId) };
        this.setSelection({}, false);
        this.commit(next);
        if (withContents) {
          this.toast.show('枠と中身を削除しました（⌘Z / Ctrl+Z で元に戻せます）');
        }
      },
      onFocusNode: (nodeId) => this.focusNode(nodeId),
      onNotify: (message) => this.toast.show(message),
      onOpenLineShelf: (opts) => this.openLineShelf(opts),
    });

    this.outlinePanel = new OutlinePanel((nodeId) => {
      this.switchViewMode('node');
      this.focusNode(nodeId);
    });

    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('copy', (e) => this.handleCopy(e, false));
    document.addEventListener('cut', (e) => this.handleCopy(e, true));
    document.addEventListener('paste', (e) => this.handlePaste(e));
  }

  // ---------------------------------------------------------------------------
  // Document & state
  // ---------------------------------------------------------------------------

  public restoreViewState(state: PersistedViewState | undefined): void {
    if (!state) {
      return;
    }
    if (state.viewport) {
      this.doc = { ...this.doc, viewport: state.viewport };
    }
    if (Array.isArray(state.hiddenWireTypes)) {
      this.hiddenWireTypes = new Set(state.hiddenWireTypes);
    }
    if (typeof state.showOutlineDrawer === 'boolean') {
      this.showOutlineDrawer = state.showOutlineDrawer;
    }
    if (typeof state.showInspector === 'boolean') {
      this.showInspector = state.showInspector;
    }
    if (state.viewMode === 'node' || state.viewMode === 'matrix' || state.viewMode === 'lines') {
      this.viewMode = state.viewMode;
    }
  }

  /**
   * ホストからのドキュメント受信。`keepViewport` が true の場合は現在のパン・ズームを維持する
   * （Undo・外部編集のたびに視点が飛ばないように）。
   */
  public setDocumentAndConfig(
    doc: PlotDocument,
    config?: PlotConfig,
    options: { keepViewport?: boolean } = {}
  ): void {
    this.doc = options.keepViewport ? { ...doc, viewport: this.doc.viewport } : doc;
    this.parseError = null;
    if (config) {
      this.config = config;
      document.body.dataset.theme = config.theme;
    }
    this.pruneSelection();
    this.renderAll();
  }

  public setParseError(message: string, config?: PlotConfig): void {
    this.parseError = message;
    if (config) {
      this.config = config;
      document.body.dataset.theme = config.theme;
    }
    this.renderAll();
  }

  /** VS Code 設定の変更（テーマ・グリッド・スナップ）を反映する。 */
  public applyConfig(config: PlotConfig): void {
    this.config = config;
    document.body.dataset.theme = config.theme;
    this.renderAll();
  }

  private pruneSelection(): void {
    const nodeIds = new Set(this.doc.nodes.map((n) => n.id));
    for (const id of [...this.selectedNodeIds]) {
      if (!nodeIds.has(id)) {
        this.selectedNodeIds.delete(id);
      }
    }
    if (this.selectedEdgeId && !this.doc.edges.some((e) => e.id === this.selectedEdgeId)) {
      this.selectedEdgeId = null;
    }
    if (this.selectedFrameId && !this.doc.frames.some((f) => f.id === this.selectedFrameId)) {
      this.selectedFrameId = null;
    }
  }

  /** ドキュメント変更の確定（TextDocument へ反映）。JSON 破損中は保存しない。 */
  private commit(next: PlotDocument, options: { render?: boolean } = {}): void {
    if (this.parseError) {
      this.toast.show('JSON が壊れているため変更を保存できません。先にファイルを修正してください。', 'warning');
      return;
    }
    this.doc = next;
    this.pruneSelection();
    this.bridge.commitDocument(this.doc);
    if (options.render !== false) {
      this.renderAll();
    }
  }

  private setSelection(
    sel: { nodeIds?: Iterable<string>; edgeId?: string | null; frameId?: string | null },
    render = true
  ): void {
    this.selectedNodeIds = new Set(sel.nodeIds ?? []);
    this.selectedEdgeId = sel.edgeId ?? null;
    this.selectedFrameId = sel.frameId ?? null;
    if (render) {
      this.renderSelectionChange();
    }
  }

  private renderSelectionChange(): void {
    this.renderToolbar();
    this.renderDecorations();
    this.renderInspector();
  }

  private scheduleViewStateSave(): void {
    if (this.viewStateTimer !== undefined) {
      window.clearTimeout(this.viewStateTimer);
    }
    this.viewStateTimer = window.setTimeout(() => {
      this.viewStateTimer = undefined;
      this.bridge.saveViewState({
        viewport: this.doc.viewport,
        hiddenWireTypes: [...this.hiddenWireTypes],
        showOutlineDrawer: this.showOutlineDrawer,
        showInspector: this.showInspector,
        viewMode: this.viewMode === 'json' ? 'node' : this.viewMode,
      });
    }, 250);
  }

  /** セリフ棚を開く。シーン指定でそのシーンのセリフに絞り込み、話者指定で入力欄の話者を設定する。 */
  public openLineShelf(opts: { sceneId?: string; speakerId?: string; focusInput?: boolean } = {}): void {
    this.lineShelfView.focusScene(opts.sceneId ?? null);
    if (opts.speakerId !== undefined) {
      this.lineShelfView.presetSpeaker(opts.speakerId);
    }
    if (this.viewMode === 'lines') {
      this.renderAll();
    } else {
      this.switchViewMode('lines');
    }
    if (opts.focusInput) {
      this.lineShelfView.focusCaptureInput();
    }
  }

  private switchViewMode(mode: EditorViewMode): void {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;
    this.scheduleViewStateSave();
    this.renderAll();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private canvasState(): CanvasRenderState {
    return {
      selectedNodeIds: this.selectedNodeIds,
      selectedEdgeId: this.selectedEdgeId,
      selectedFrameId: this.selectedFrameId,
      filterQuery: this.filterQuery,
      certaintyFilter: this.certaintyFilter,
      traceModeEnabled: this.traceModeEnabled,
      hiddenWireTypes: this.hiddenWireTypes,
      activeSocketDrag: this.activeSocketDrag,
      tempWire: this.tempWire,
      gridSize: this.config.gridSize || 20,
    };
  }

  public renderAll(): void {
    this.renderToolbar();
    const mode = this.viewMode;
    this.canvasViewport.viewportElement.classList.toggle('is-hidden', mode !== 'node');
    this.matrixView.setVisible(mode === 'matrix');
    this.lineShelfView.setVisible(mode === 'lines');
    this.jsonViewElement.classList.toggle('is-hidden', mode !== 'json');
    this.parseErrorElement.classList.toggle('is-hidden', this.parseError === null);
    this.parseErrorMessageEl.textContent = this.parseError ?? '';

    if (mode === 'json') {
      if (document.activeElement !== this.jsonTextarea) {
        this.jsonTextarea.value = serializePlotDocument(this.doc);
        this.jsonStatusEl.className = 'nplot-json-status is-valid';
        this.jsonStatusEl.textContent = `✓ JSON構文: 正常（ノード ${this.doc.nodes.length}件・エッジ ${this.doc.edges.length}件）`;
      }
    } else if (mode === 'matrix') {
      this.matrixView.render(this.doc);
    } else if (mode === 'lines') {
      this.lineShelfView.render(this.doc);
    } else {
      this.canvasViewport.render(this.doc, this.canvasState());
    }
    this.renderSidePanels();
  }

  private renderSidePanels(): void {
    this.renderInspector();
    this.outlinePanel.render(this.doc, this.showOutlineDrawer);
  }

  private renderToolbar(): void {
    this.toolbar.render(this.doc, this.config, {
      filterQuery: this.filterQuery,
      certaintyFilter: this.certaintyFilter,
      viewMode: this.viewMode,
      showOutlineDrawer: this.showOutlineDrawer,
      showInspector: this.showInspector,
      traceModeEnabled: this.traceModeEnabled,
      hasSelection: this.selectedNodeIds.size > 0,
    });
  }

  private renderInspector(): void {
    this.inspectorPanel.render(this.doc, this.showInspector, {
      nodeIds: [...this.selectedNodeIds],
      edgeId: this.selectedEdgeId,
      frameId: this.selectedFrameId,
    });
  }

  private renderDecorations(): void {
    if (this.viewMode === 'node') {
      this.canvasViewport.applyDecorations(this.doc, this.canvasState());
    }
  }

  /** ドラッグ中の位置更新を 1 フレーム 1 回に間引く。 */
  private scheduleGeometry(): void {
    if (this.pendingFrame !== null) {
      return;
    }
    this.pendingFrame = window.requestAnimationFrame(() => {
      this.pendingFrame = null;
      if (!this.canvasViewport.applyGeometry(this.doc, this.canvasState())) {
        this.canvasViewport.render(this.doc, this.canvasState());
      }
    });
  }

  private flushGeometry(): void {
    if (this.pendingFrame !== null) {
      window.cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  private applyViewportOnly(): void {
    this.canvasViewport.applyViewport(this.doc.viewport, this.config.gridSize || 20);
    this.scheduleViewStateSave();
  }

  // ---------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------

  public setZoomCentered(targetZoom: number): void {
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
    this.doc = {
      ...this.doc,
      viewport: {
        panX: Math.round(cx - worldX * clampedZoom),
        panY: Math.round(cy - worldY * clampedZoom),
        zoom: clampedZoom,
      },
    };
    this.applyViewportOnly();
  }

  public fitToScreen(): void {
    if (this.doc.nodes.length === 0 && this.doc.frames.length === 0) {
      return;
    }
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const viewW = rect.width || 720;
    const viewH = rect.height || 480;
    const nodeRects = this.canvasViewport.getNodeRects(this.doc);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of [...nodeRects.values(), ...this.doc.frames]) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    const contentW = Math.max(300, maxX - minX + 60);
    const contentH = Math.max(240, maxY - minY + 60);
    const zoom = Math.max(
      0.25,
      Math.min(1.0, Number(Math.min(viewW / contentW, viewH / contentH).toFixed(3)))
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    this.doc = {
      ...this.doc,
      viewport: {
        panX: Math.round(viewW / 2 - centerX * zoom),
        panY: Math.round(viewH / 2 - centerY * zoom),
        zoom,
      },
    };
    this.applyViewportOnly();
  }

  public focusNode(nodeId: string): void {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }
    this.setSelection({ nodeIds: [nodeId] }, false);
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const zoom = this.doc.viewport.zoom;
    const width = node.width ?? 232;
    this.doc = {
      ...this.doc,
      viewport: {
        ...this.doc.viewport,
        panX: Math.round(rect.width / 2 - (node.x + width / 2) * zoom),
        panY: Math.round(rect.height / 2 - (node.y + 80) * zoom),
      },
    };
    if (this.viewMode === 'node') {
      this.applyViewportOnly();
      this.renderSelectionChange();
    } else {
      this.scheduleViewStateSave();
      this.renderAll();
    }
  }

  private jumpToNextMatch(backwards: boolean): void {
    if (!this.filterQuery.trim() && this.certaintyFilter === 'all') {
      return;
    }
    const matches = this.doc.nodes
      .filter((n) => nodeMatchesFilters(n, this.filterQuery, this.certaintyFilter))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (matches.length === 0) {
      this.toast.show('一致するノードはありません。', 'warning');
      return;
    }
    const len = matches.length;
    this.searchCursor = backwards
      ? (this.searchCursor - 1 + len) % len
      : (this.searchCursor + 1) % len;
    this.switchViewMode('node');
    this.focusNode(matches[this.searchCursor].id);
    this.toast.show(`${this.searchCursor + 1} / ${len} 件目：${matches[this.searchCursor].title}`);
  }

  private handleWheelZoom(e: WheelEvent): void {
    const { panX, panY, zoom: oldZoom } = this.doc.viewport;
    // トラックパッドの2本指スクロール（ctrlKey なし・横成分あり）はパンとして扱う
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5 && e.deltaMode === 0 && Math.abs(e.deltaX) > 0) {
      this.doc = {
        ...this.doc,
        viewport: { ...this.doc.viewport, panX: Math.round(panX - e.deltaX), panY: Math.round(panY - e.deltaY) },
      };
      this.applyViewportOnly();
      return;
    }
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    // 1回のホイールイベントあたりの変化量をクランプした緩やかな指数減衰カーブ
    const clampedDelta = Math.max(-20, Math.min(20, e.deltaY));
    const sensitivity = e.ctrlKey ? 0.0032 : 0.0012;
    const factor = Math.exp(-clampedDelta * sensitivity);
    const newZoom = Math.max(0.25, Math.min(2.0, Math.round(oldZoom * factor * 1000) / 1000));
    if (newZoom === oldZoom) {
      return;
    }
    const worldX = (cursorX - panX) / oldZoom;
    const worldY = (cursorY - panY) / oldZoom;
    this.doc = {
      ...this.doc,
      viewport: {
        panX: Math.round(cursorX - worldX * newZoom),
        panY: Math.round(cursorY - worldY * newZoom),
        zoom: newZoom,
      },
    };
    this.applyViewportOnly();
  }

  private clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const { panX, panY, zoom } = this.doc.viewport;
    return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
  }

  // ---------------------------------------------------------------------------
  // Gestures
  // ---------------------------------------------------------------------------

  private handleBackgroundPointerDown(e: PointerEvent): void {
    if (e.shiftKey && e.button === 0) {
      this.handleMarqueeGesture(e);
      return;
    }
    if (e.button === 0 && (this.selectedNodeIds.size > 0 || this.selectedEdgeId || this.selectedFrameId)) {
      this.setSelection({});
    }
    this.handlePanGesture(e);
  }

  private handlePanGesture(startEvent: PointerEvent): void {
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const initialPanX = this.doc.viewport.panX;
    const initialPanY = this.doc.viewport.panY;
    const viewportEl = this.canvasViewport.viewportElement;
    viewportEl.classList.add('is-panning');

    const onMove = (ev: PointerEvent) => {
      this.doc = {
        ...this.doc,
        viewport: {
          ...this.doc.viewport,
          panX: Math.round(initialPanX + ev.clientX - startX),
          panY: Math.round(initialPanY + ev.clientY - startY),
        },
      };
      this.canvasViewport.applyViewport(this.doc.viewport, this.config.gridSize || 20);
    };
    const onUp = () => {
      viewportEl.classList.remove('is-panning');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.scheduleViewStateSave();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleMarqueeGesture(startEvent: PointerEvent): void {
    const start = this.clientToWorld(startEvent.clientX, startEvent.clientY);
    const baseSelection = new Set(this.selectedNodeIds);
    const nodeRects = this.canvasViewport.getNodeRects(this.doc);
    let current: Rect = { x: start.x, y: start.y, width: 0, height: 0 };

    const onMove = (ev: PointerEvent) => {
      const p = this.clientToWorld(ev.clientX, ev.clientY);
      current = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };
      this.canvasViewport.setMarquee(current);
      const next = new Set(baseSelection);
      for (const [id, r] of nodeRects) {
        if (rectsIntersect(current, r)) {
          next.add(id);
        }
      }
      this.selectedNodeIds = next;
      this.selectedEdgeId = null;
      this.selectedFrameId = null;
      this.renderDecorations();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.canvasViewport.setMarquee(null);
      this.renderSelectionChange();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private lastPointerDownWasToggle = false;

  private handleNodePointerDown(nodeId: string, e: PointerEvent): void {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    this.lastPointerDownWasToggle = false;
    if (additive) {
      const next = new Set(this.selectedNodeIds);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        this.lastPointerDownWasToggle = true;
      } else {
        next.add(nodeId);
      }
      this.setSelection({ nodeIds: next });
      return;
    }
    if (this.selectedNodeIds.has(nodeId) && !this.selectedEdgeId && !this.selectedFrameId) {
      // 既に選択中：複数選択を保ったままドラッグできるようにする（クリックのみなら pointerup で単独選択に戻す）
      return;
    }
    this.setSelection({ nodeIds: [nodeId] });
  }

  private handleNodeDragGesture(nodeId: string, startEvent: PointerEvent): void {
    if (this.lastPointerDownWasToggle || !this.selectedNodeIds.has(nodeId)) {
      return;
    }
    const primary = this.doc.nodes.find((n) => n.id === nodeId);
    if (!primary) {
      return;
    }
    const additive = startEvent.shiftKey || startEvent.metaKey || startEvent.ctrlKey;
    const initial = new Map<string, { x: number; y: number }>();
    for (const n of this.doc.nodes) {
      if (this.selectedNodeIds.has(n.id)) {
        initial.set(n.id, { x: n.x, y: n.y });
      }
    }
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const zoom = this.doc.viewport.zoom;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const dx = this.snap(primary.x + (ev.clientX - startX) / zoom) - primary.x;
      const dy = this.snap(primary.y + (ev.clientY - startY) / zoom) - primary.y;
      this.doc = {
        ...this.doc,
        nodes: this.doc.nodes.map((n) => {
          const p = initial.get(n.id);
          return p ? { ...n, x: p.x + dx, y: p.y + dy } : n;
        }),
      };
      this.scheduleGeometry();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.flushGeometry();
      if (moved) {
        this.commit(this.doc);
      } else if (!additive && this.selectedNodeIds.size > 1) {
        this.setSelection({ nodeIds: [nodeId] });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleNodeResizeGesture(nodeId: string, startEvent: PointerEvent): void {
    const node = this.doc.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }
    const rects = this.canvasViewport.getNodeRects(this.doc);
    const initialWidth = rects.get(nodeId)?.width ?? node.width ?? 232;
    const startX = startEvent.clientX;
    const zoom = this.doc.viewport.zoom;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const right = this.snap(node.x + initialWidth + (ev.clientX - startX) / zoom);
      const width = clampNodeWidth(right - node.x);
      this.doc = {
        ...this.doc,
        nodes: this.doc.nodes.map((n) => (n.id === nodeId ? { ...n, width } : n)),
      };
      this.scheduleGeometry();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.flushGeometry();
      if (moved) {
        this.commit(this.doc);
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
    // 入れ子の子枠と、枠内のノードをまとめて動かす
    const contents = collectFrameContents(this.doc, frameId);
    const initFrames = new Map<string, { x: number; y: number }>();
    for (const f of this.doc.frames) {
      if (f.id === frameId || contents.frameIds.has(f.id)) {
        initFrames.set(f.id, { x: f.x, y: f.y });
      }
    }
    const initNodes = new Map<string, { x: number; y: number }>();
    for (const n of this.doc.nodes) {
      if (contents.nodeIds.has(n.id)) {
        initNodes.set(n.id, { x: n.x, y: n.y });
      }
    }
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const zoom = this.doc.viewport.zoom;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const dx = this.snap(frame.x + (ev.clientX - startX) / zoom) - frame.x;
      const dy = this.snap(frame.y + (ev.clientY - startY) / zoom) - frame.y;
      this.doc = {
        ...this.doc,
        frames: this.doc.frames.map((f) => {
          const p = initFrames.get(f.id);
          return p ? { ...f, x: p.x + dx, y: p.y + dy } : f;
        }),
        nodes: this.doc.nodes.map((n) => {
          const p = initNodes.get(n.id);
          return p ? { ...n, x: p.x + dx, y: p.y + dy } : n;
        }),
      };
      this.scheduleGeometry();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.flushGeometry();
      if (moved) {
        // 入れ子の親子関係が変わる可能性があるので描画順も更新する
        this.commit(this.doc);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  private handleFrameResizeGesture(
    frameId: string,
    handle: ResizeHandle,
    startEvent: PointerEvent
  ): void {
    const frame = this.doc.frames.find((f) => f.id === frameId);
    if (!frame) {
      return;
    }
    const initial = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const zoom = this.doc.viewport.zoom;
    let moved = false;
    document.body.dataset.resizing = handle;

    const onMove = (ev: PointerEvent) => {
      moved = true;
      const next = resizeRect(
        initial,
        handle,
        (ev.clientX - startX) / zoom,
        (ev.clientY - startY) / zoom,
        FRAME_MIN_WIDTH,
        FRAME_MIN_HEIGHT,
        (v) => this.snap(v)
      );
      this.doc = {
        ...this.doc,
        frames: this.doc.frames.map((f) => (f.id === frameId ? { ...f, ...next } : f)),
      };
      this.scheduleGeometry();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      delete document.body.dataset.resizing;
      this.flushGeometry();
      if (moved) {
        this.commit(this.doc);
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

    this.activeSocketDrag = { fromNodeId, fromSocketId: socket.id, dataType: socket.dataType };
    const p0 = this.clientToWorld(startEvent.clientX, startEvent.clientY);
    this.tempWire = {
      fromX: startPos.x,
      fromY: startPos.y,
      toX: p0.x,
      toY: p0.y,
      dataType: socket.dataType,
    };
    this.renderDecorations();

    const onMove = (ev: PointerEvent) => {
      if (!this.tempWire) {
        return;
      }
      const pt = this.clientToWorld(ev.clientX, ev.clientY);
      this.tempWire = { ...this.tempWire, toX: pt.x, toY: pt.y };
      this.canvasViewport.updateTempWire(this.doc, this.canvasState());
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const drag = this.activeSocketDrag;
      this.activeSocketDrag = null;
      this.tempWire = null;
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      if (drag && target) {
        this.completeSocketDrop(drag, target);
      }
      this.renderDecorations();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * 端子の上にドロップされればその端子へ、カードの上なら同型の入力端子（最初の一つ）へ接続する。
   * 接続できない場合は理由をトーストで知らせる。
   */
  private completeSocketDrop(drag: ActiveSocketDragInfo, target: Element): void {
    const pin = target.closest<HTMLElement>('.nplot-socket-pin');
    let toNodeId: string | undefined;
    let toSocketId: string | undefined;
    if (pin) {
      toNodeId = pin.dataset.nodeId;
      toSocketId = pin.dataset.socketId;
    } else {
      const card = target.closest<HTMLElement>('.nplot-node');
      toNodeId = card?.dataset.nodeId;
      if (toNodeId) {
        const node = this.doc.nodes.find((n) => n.id === toNodeId);
        toSocketId = node?.sockets.find(
          (s) => s.direction === 'in' && s.dataType === drag.dataType
        )?.id;
        if (!toSocketId && toNodeId !== drag.fromNodeId) {
          this.toast.show('このノードには同じ種類の入力端子がありません。', 'warning');
          return;
        }
      }
    }
    if (!toNodeId || !toSocketId) {
      return;
    }
    const result = connectSockets(this.doc, drag.fromNodeId, drag.fromSocketId, toNodeId, toSocketId);
    if (result.addedEdge) {
      this.setSelection({ edgeId: result.addedEdge.id }, false);
      this.commit(result.document);
    } else if (result.reason && toNodeId !== drag.fromNodeId) {
      this.toast.show(result.reason, 'warning');
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  private promoteCategory(nodeId: string, cat: NodeCategory): void {
    const lost = countEdgesLostByPromotion(this.doc, nodeId, cat);
    this.commit(promoteNodeCategory(this.doc, nodeId, cat));
    if (lost > 0) {
      this.toast.show(
        `種別を変更したため、合わない端子の接続 ${lost} 本が外れました（⌘Z / Ctrl+Z で元に戻せます）`,
        'warning',
        5200
      );
    }
  }

  private deleteSelection(): void {
    if (this.selectedNodeIds.size > 0) {
      const count = this.selectedNodeIds.size;
      const next = removeNodes(this.doc, this.selectedNodeIds);
      this.setSelection({}, false);
      this.commit(next);
      if (count > 1) {
        this.toast.show(`${count} 件のノードを削除しました（⌘Z / Ctrl+Z で元に戻せます）`);
      }
    } else if (this.selectedEdgeId) {
      const next = removeEdge(this.doc, this.selectedEdgeId);
      this.setSelection({}, false);
      this.commit(next);
    } else if (this.selectedFrameId) {
      const frameId = this.selectedFrameId;
      this.setSelection({}, false);
      this.commit({ ...this.doc, frames: this.doc.frames.filter((f) => f.id !== frameId) });
      this.toast.show('枠を削除しました（中のノードは残っています）');
    }
  }

  private duplicateSelection(): void {
    if (this.selectedNodeIds.size === 0) {
      return;
    }
    const payload = extractNodeClipboard(this.doc, this.selectedNodeIds);
    const g = this.config.gridSize || 20;
    const { document: next, newNodeIds } = insertNodeClipboard(this.doc, payload, g * 2, g * 2);
    this.setSelection({ nodeIds: newNodeIds }, false);
    this.commit(next);
  }

  private wrapSelectionInFrame(): void {
    if (this.selectedNodeIds.size === 0) {
      return;
    }
    const allRects = this.canvasViewport.getNodeRects(this.doc);
    const rects = new Map<string, Rect>();
    for (const id of this.selectedNodeIds) {
      const r = allRects.get(id);
      if (r) {
        rects.set(id, r);
      }
    }
    const selectedNodes = this.doc.nodes.filter((n) => this.selectedNodeIds.has(n.id));
    const allCharacters = selectedNodes.every((n) => n.category === 'character');
    const { document: next, frame } = wrapInNewFrame(this.doc, rects, {
      id: `frame_${Date.now()}`,
      title: allCharacters ? '新しい組織・グループ' : '新しいグループ',
      colorTag: allCharacters ? 'green' : 'blue',
    });
    if (!frame) {
      return;
    }
    this.setSelection({ frameId: frame.id }, false);
    this.commit(next);
    this.toast.show('枠を作成しました。見出しをダブルクリックすると名前を変更できます。');
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
    this.setSelection({ nodeIds: [node.id] }, false);
    this.commit({ ...this.doc, nodes: [...this.doc.nodes, node] });
  }

  private addFrameAtViewportCenter(): void {
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const { panX, panY, zoom } = this.doc.viewport;
    const newFrame = {
      id: `frame_${Date.now()}`,
      title: `第${this.doc.frames.length + 1}幕・エリア`,
      x: this.snap(((rect.width || 700) / 2 - panX) / zoom - 240),
      y: this.snap(((rect.height || 450) / 2 - panY) / zoom - 150),
      width: 500,
      height: 300,
    };
    this.setSelection({ frameId: newFrame.id }, false);
    this.commit({ ...this.doc, frames: [...this.doc.frames, newFrame] });
  }

  // ---------------------------------------------------------------------------
  // Keyboard & clipboard
  // ---------------------------------------------------------------------------

  private handleKeyDown(e: KeyboardEvent): void {
    if (isTextEditingTarget(e.target) || this.viewMode === 'json') {
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.viewMode === 'node') {
      e.preventDefault();
      this.deleteSelection();
    } else if (e.key === 'Escape') {
      this.setSelection({});
    } else if (mod && e.key.toLowerCase() === 'a' && this.viewMode === 'node') {
      e.preventDefault();
      this.setSelection({ nodeIds: this.doc.nodes.map((n) => n.id) });
    } else if (mod && e.key.toLowerCase() === 'd' && this.viewMode === 'node') {
      e.preventDefault();
      this.duplicateSelection();
    }
  }

  private handleCopy(e: ClipboardEvent, isCut: boolean): void {
    if (isTextEditingTarget(e.target) || this.viewMode !== 'node' || this.selectedNodeIds.size === 0) {
      return;
    }
    const payload = extractNodeClipboard(this.doc, this.selectedNodeIds);
    e.clipboardData?.setData('text/plain', JSON.stringify(payload));
    e.preventDefault();
    this.pasteCount = 0;
    if (isCut) {
      this.deleteSelection();
    } else {
      this.toast.show(`${payload.nodes.length} 件のノードをコピーしました`);
    }
  }

  private handlePaste(e: ClipboardEvent): void {
    if (isTextEditingTarget(e.target) || this.viewMode !== 'node') {
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    e.preventDefault();
    if (isNodeClipboardPayload(payload)) {
      this.pasteCount++;
      const g = (this.config.gridSize || 20) * 2 * this.pasteCount;
      const { document: next, newNodeIds } = insertNodeClipboard(this.doc, payload, g, g);
      this.setSelection({ nodeIds: newNodeIds }, false);
      this.commit(next);
      return;
    }
    // プレーンテキストはメモ付箋として貼り付ける（1行目をタイトル、残りを本文）
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const [firstLine, ...rest] = trimmed.split(/\r?\n/);
    const rect = this.canvasViewport.viewportElement.getBoundingClientRect();
    const center = this.clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const node = createNode({
      category: 'note',
      title: firstLine.slice(0, 80),
      body: rest.join('\n').trim(),
      x: this.snap(center.x - 116),
      y: this.snap(center.y - 40),
    });
    this.setSelection({ nodeIds: [node.id] }, false);
    this.commit({ ...this.doc, nodes: [...this.doc.nodes, node] });
  }

  private snap(value: number): number {
    if (!this.config.snapToGrid) {
      return Math.round(value);
    }
    const g = this.config.gridSize || 20;
    return Math.round(value / g) * g;
  }
}
