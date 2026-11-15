/**
 * Compare Webview Entrypoint (バックアップ比較画面: プロットキャンバス2画面の並列表示)
 * 左右のキャンバスを連動してパン・ズームし、変更のあるノードを強調表示する。各ペインの「こちらを採用」で Host に結果を返す。
 */

import { diffPlotDocuments } from '../core/plotDiff';
import { parsePlotDocument } from '../core/serializer';
import {
  CompareHostToWebviewMessage,
  ComparePaneData,
  CompareWebviewToHostMessage,
  PlotConfig,
  PlotDocument,
  ViewportState,
} from '../core/types';
import { CanvasViewport } from './components/CanvasViewport';

declare function acquireVsCodeApi(): {
  postMessage(msg: CompareWebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();
const noop = () => undefined;

function applyChangedHighlights(viewport: CanvasViewport, changedIds: Set<string>): void {
  const cards = viewport.worldElement.querySelectorAll<HTMLElement>('.nplot-node');
  cards.forEach((card) => {
    const id = card.dataset.nodeId;
    if (id && changedIds.has(id)) {
      card.classList.add('is-diff-changed');
    }
  });
}

function createComparePane(
  container: HTMLElement,
  side: 'left' | 'right',
  data: ComparePaneData,
  doc: PlotDocument,
  changedNodeIds: Set<string>,
  config: PlotConfig,
  onViewportChanged: (vp: ViewportState) => void
): { renderWithViewport: (vp: ViewportState) => void } {
  const pane = document.createElement('section');
  pane.className = `nplot-compare-pane is-${side}`;

  const header = document.createElement('header');
  header.className = 'nplot-compare-pane-header';

  const titleBox = document.createElement('div');
  titleBox.className = 'nplot-compare-pane-title';
  const label = document.createElement('strong');
  label.textContent = data.label;
  const detail = document.createElement('span');
  detail.className = 'nplot-compare-pane-detail';
  detail.textContent = `${data.detail}　ノード ${doc.nodes.length}件 / エッジ ${doc.edges.length}件・差分ノード ${changedNodeIds.size}件`;
  titleBox.append(label, detail);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nplot-btn is-active';
  button.textContent = data.adoptLabel;
  button.addEventListener('click', () => vscode.postMessage({ type: 'ADOPT', side }));

  header.append(titleBox, button);
  pane.appendChild(header);

  let currentVp: ViewportState = { ...doc.viewport };

  const viewport = new CanvasViewport(
    {
      onBackgroundPointerDown: (startEvent) => {
        const startX = startEvent.clientX;
        const startY = startEvent.clientY;
        const initPanX = currentVp.panX;
        const initPanY = currentVp.panY;
        const onMove = (ev: PointerEvent) => {
          onViewportChanged({
            ...currentVp,
            panX: Math.round(initPanX + (ev.clientX - startX)),
            panY: Math.round(initPanY + (ev.clientY - startY)),
          });
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      },
      onDoubleClickCanvas: noop,
      onWheelZoom: (e) => {
        const rect = viewport.viewportElement.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const oldZoom = currentVp.zoom;
        const clampedDelta = Math.max(-20, Math.min(20, e.deltaY));
        const factor = Math.exp(-clampedDelta * (e.ctrlKey ? 0.0032 : 0.0012));
        const newZoom = Math.max(
          0.25,
          Math.min(2.0, Math.round(oldZoom * factor * 1000) / 1000)
        );
        if (newZoom === oldZoom) return;
        const worldX = (cursorX - currentVp.panX) / oldZoom;
        const worldY = (cursorY - currentVp.panY) / oldZoom;
        onViewportChanged({
          panX: Math.round(cursorX - worldX * newZoom),
          panY: Math.round(cursorY - worldY * newZoom),
          zoom: newZoom,
        });
      },
      onSetZoomLevel: (newZoom) => {
        onViewportChanged({ ...currentVp, zoom: newZoom });
      },
      onFitView: () => {
        onViewportChanged({ panX: 16, panY: 16, zoom: 0.75 });
      },
      onResetZoom: () => {
        onViewportChanged({ panX: 16, panY: 16, zoom: 1.0 });
      },
      onNodePointerDown: noop,
      onStartDragNode: noop,
      onStartResizeNode: noop,
      onResetNodeWidth: noop,
      onRenameNode: noop,
      onFramePointerDown: noop,
      onStartResizeFrame: noop,
      onRenameFrame: noop,
      onEdgePointerDown: noop,
      onPromoteCategory: noop,
      onStartSocketDrag: noop,
      onOpenManuscript: noop,
      onToggleWireType: noop,
    },
    false
  );

  pane.appendChild(viewport.viewportElement);
  container.appendChild(pane);

  const renderWithViewport = (vp: ViewportState) => {
    currentVp = vp;
    viewport.render(
      { ...doc, viewport: vp },
      {
        selectedNodeIds: new Set(),
        selectedEdgeId: null,
        selectedFrameId: null,
        filterQuery: '',
        certaintyFilter: 'all',
        traceModeEnabled: false,
        hiddenWireTypes: new Set(),
        activeSocketDrag: null,
        tempWire: null,
        gridSize: config.gridSize || 20,
      }
    );
    applyChangedHighlights(viewport, changedNodeIds);
  };

  renderWithViewport(currentVp);
  return { renderWithViewport };
}

function renderCompare(root: HTMLElement, msg: CompareHostToWebviewMessage): void {
  document.body.dataset.theme = msg.config.theme;
  root.replaceChildren();

  const leftDoc = parsePlotDocument(msg.left.text);
  const rightDoc = parsePlotDocument(msg.right.text);
  const diff = diffPlotDocuments(leftDoc, rightDoc);

  const body = document.createElement('div');
  body.className = 'nplot-compare-body';
  root.appendChild(body);

  let syncLock = false;
  let leftPane: { renderWithViewport: (vp: ViewportState) => void } | undefined;
  let rightPane: { renderWithViewport: (vp: ViewportState) => void } | undefined;

  const syncViewport = (vp: ViewportState) => {
    if (syncLock) return;
    syncLock = true;
    leftPane?.renderWithViewport(vp);
    rightPane?.renderWithViewport(vp);
    syncLock = false;
  };

  leftPane = createComparePane(
    body,
    'left',
    msg.left,
    leftDoc,
    diff.leftChangedNodeIds,
    msg.config,
    syncViewport
  );
  rightPane = createComparePane(
    body,
    'right',
    msg.right,
    rightDoc,
    diff.rightChangedNodeIds,
    msg.config,
    syncViewport
  );
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app');
  if (!root) return;
  window.addEventListener('message', (event: MessageEvent<CompareHostToWebviewMessage>) => {
    if (event.data?.type === 'INIT_COMPARE') {
      renderCompare(root, event.data);
    }
  });
  vscode.postMessage({ type: 'COMPARE_READY' });
});
