import { createInitialPlotDocument } from '../core/serializer';
import { DEFAULT_PLOT_CONFIG } from '../core/theme';
import {
  HostToWebviewMessage,
  PlotDocument,
  WebviewToHostMessage,
} from '../core/types';
import {
  InteractionController,
  PersistedViewState,
} from './components/InteractionController';

declare function acquireVsCodeApi(): {
  postMessage: (msg: WebviewToHostMessage) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

function bootstrap(): void {
  const vscode = acquireVsCodeApi();
  const appRoot = document.getElementById('app');
  if (!appRoot) {
    return;
  }

  let currentVersion = 1;

  const controller = new InteractionController(
    createInitialPlotDocument(),
    DEFAULT_PLOT_CONFIG,
    {
      commitDocument: (doc: PlotDocument) => {
        vscode.postMessage({
          type: 'UPDATE_DOCUMENT',
          document: doc,
          version: currentVersion,
        });
      },
      updateConfig: (partialConfig) => {
        vscode.postMessage({
          type: 'UPDATE_CONFIG',
          partialConfig,
        });
      },
      openManuscript: (node, createIfMissing) => {
        const manuscriptPath =
          node.sceneParams?.manuscriptPath?.trim() || `${node.id}.txt`;
        vscode.postMessage({
          type: 'OPEN_MANUSCRIPT',
          nodeId: node.id,
          manuscriptPath,
          sceneTitle: node.title,
          createIfMissing,
        });
      },
      requestExport: (format) => {
        vscode.postMessage({
          type: 'REQUEST_EXPORT',
          format,
        });
      },
      requestRestoreBackup: () => {
        vscode.postMessage({
          type: 'REQUEST_RESTORE_BACKUP',
        });
      },
      openInTextEditor: () => {
        vscode.postMessage({
          type: 'OPEN_IN_TEXT_EDITOR',
        });
      },
      saveViewState: (state) => {
        try {
          vscode.setState(state);
        } catch {
          // 状態保存に失敗しても編集は継続できる
        }
      },
    }
  );

  const readSavedState = (): PersistedViewState | undefined => {
    try {
      const raw = vscode.getState();
      return raw && typeof raw === 'object' ? (raw as PersistedViewState) : undefined;
    } catch {
      return undefined;
    }
  };

  const mainArea = document.createElement('div');
  mainArea.className = 'nplot-main-area';

  const canvasCol = document.createElement('div');
  canvasCol.className = 'nplot-canvas-column';
  canvasCol.appendChild(controller.canvasViewport.viewportElement);
  canvasCol.appendChild(controller.matrixView.element);
  canvasCol.appendChild(controller.lineShelfView.element);
  canvasCol.appendChild(controller.jsonViewElement);
  canvasCol.appendChild(controller.parseErrorElement);
  canvasCol.appendChild(controller.outlinePanel.element);

  mainArea.appendChild(canvasCol);
  mainArea.appendChild(controller.inspectorPanel.element);

  appRoot.appendChild(controller.toolbar.element);
  appRoot.appendChild(mainArea);

  window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') {
      return;
    }

    switch (msg.type) {
      case 'INIT_DOCUMENT': {
        currentVersion = msg.version;
        const saved = readSavedState();
        controller.restoreViewState(saved);
        // パン・ズームはファイルではなく Webview 状態を優先（パンだけでファイルを変更扱いにしない）
        controller.setDocumentAndConfig(msg.document, msg.config, {
          keepViewport: Boolean(saved?.viewport),
        });
        break;
      }
      case 'DOCUMENT_CHANGED': {
        currentVersion = msg.version;
        controller.setDocumentAndConfig(msg.document, undefined, { keepViewport: true });
        break;
      }
      case 'EDIT_RESULT': {
        currentVersion = msg.version;
        if (!msg.accepted && msg.document) {
          controller.setDocumentAndConfig(msg.document, undefined, { keepViewport: true });
        }
        break;
      }
      case 'PARSE_ERROR': {
        currentVersion = msg.version;
        if (msg.config) {
          controller.restoreViewState(readSavedState());
        }
        controller.setParseError(msg.message, msg.config);
        break;
      }
      case 'CONFIG_CHANGED': {
        controller.applyConfig(msg.config);
        break;
      }
      case 'FOCUS_NODE': {
        controller.focusNode(msg.nodeId);
        break;
      }
    }
  });

  vscode.postMessage({ type: 'READY' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
