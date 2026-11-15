import { createInitialPlotDocument } from '../core/serializer';
import { DEFAULT_PLOT_CONFIG } from '../core/theme';
import {
  HostToWebviewMessage,
  PlotDocument,
  WebviewToHostMessage,
} from '../core/types';
import { InteractionController } from './components/InteractionController';

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
    }
  );

  const mainArea = document.createElement('div');
  mainArea.className = 'nplot-main-area';

  const canvasCol = document.createElement('div');
  canvasCol.className = 'nplot-canvas-column';
  canvasCol.appendChild(controller.canvasViewport.viewportElement);
  canvasCol.appendChild(controller.jsonViewElement);
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
        controller.setDocumentAndConfig(msg.document, msg.config);
        break;
      }
      case 'DOCUMENT_CHANGED': {
        currentVersion = msg.version;
        controller.setDocumentAndConfig(msg.document);
        break;
      }
      case 'EDIT_RESULT': {
        currentVersion = msg.version;
        if (!msg.accepted && msg.document) {
          controller.setDocumentAndConfig(msg.document);
        }
        break;
      }
      case 'CONFIG_CHANGED': {
        document.body.dataset.theme = msg.config.theme;
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
