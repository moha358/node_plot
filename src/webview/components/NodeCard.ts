import { getForeshadowNodeStatus } from '../../core/plotAnalyzer';
import { NODE_CATEGORY_META, SOCKET_TYPE_META } from '../../core/theme';
import {
  NodeCategory,
  PlotDocument,
  PlotNode,
  PlotSocket,
  SocketDataType,
} from '../../core/types';

export interface NodeCardCallbacks {
  onSelectNode: (nodeId: string) => void;
  onStartDragNode: (nodeId: string, e: PointerEvent) => void;
  onPromoteCategory: (nodeId: string, newCategory: NodeCategory) => void;
  onStartSocketDrag: (nodeId: string, socket: PlotSocket, e: PointerEvent) => void;
  onCompleteSocketDrop: (nodeId: string, socket: PlotSocket) => void;
  onOpenManuscript: (node: PlotNode) => void;
}

export interface ActiveSocketDragInfo {
  fromNodeId: string;
  fromSocketId: string;
  dataType: SocketDataType;
}

export function createNodeCardElement(
  doc: PlotDocument,
  node: PlotNode,
  isSelected: boolean,
  isDimmed: boolean,
  activeSocketDrag: ActiveSocketDragInfo | null,
  callbacks: NodeCardCallbacks
): HTMLElement {
  const card = document.createElement('article');
  card.className = `nplot-node ${isSelected ? 'is-selected' : ''} ${
    isDimmed ? 'is-trace-dimmed' : ''
  }`;
  card.dataset.nodeId = node.id;
  card.style.left = `${node.x}px`;
  card.style.top = `${node.y}px`;

  card.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    callbacks.onSelectNode(node.id);
  });

  // Header
  const meta = NODE_CATEGORY_META[node.category];
  const header = document.createElement('div');
  header.className = 'nplot-node-header';
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    e.stopPropagation();
    callbacks.onSelectNode(node.id);
    callbacks.onStartDragNode(node.id, e);
  });

  const badge = document.createElement('span');
  badge.className = 'nplot-node-badge';
  badge.style.background = meta.cssColorVar;
  badge.textContent = meta.badgeText;
  header.appendChild(badge);

  // Category switcher (1-click promotion from sticky note to scene/character/foreshadow/item)
  const categorySelect = document.createElement('select');
  categorySelect.className = 'nplot-select';
  categorySelect.title = 'ノード種別を切り替え（メモ付箋からシーンや伏線へ昇格可能）';
  const allCats: NodeCategory[] = ['note', 'scene', 'character', 'foreshadow', 'world_item'];
  for (const c of allCats) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = NODE_CATEGORY_META[c].label;
    opt.selected = node.category === c;
    categorySelect.appendChild(opt);
  }
  categorySelect.addEventListener('change', (e) => {
    e.stopPropagation();
    callbacks.onPromoteCategory(node.id, categorySelect.value as NodeCategory);
  });
  header.appendChild(categorySelect);
  card.appendChild(header);

  // Title & Body
  const titleEl = document.createElement('div');
  titleEl.className = 'nplot-node-title-row';
  titleEl.textContent = node.title || '（無題）';
  card.appendChild(titleEl);

  if (node.body.trim()) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'nplot-node-body';
    bodyEl.textContent = node.body;
    card.appendChild(bodyEl);
  }

  // Multi-Socket Grid (B案)
  if (node.sockets.length > 0) {
    const socketsGrid = document.createElement('div');
    socketsGrid.className = 'nplot-sockets-grid';

    const inCol = document.createElement('div');
    inCol.className = 'nplot-socket-col is-in';
    const outCol = document.createElement('div');
    outCol.className = 'nplot-socket-col is-out';

    for (const sock of node.sockets) {
      const sockMeta = SOCKET_TYPE_META[sock.dataType];
      const row = document.createElement('div');
      row.className = 'nplot-socket-row';

      const pin = document.createElement('span');
      pin.className = 'nplot-socket-pin';
      pin.dataset.nodeId = node.id;
      pin.dataset.socketId = sock.id;
      pin.style.color = sockMeta.cssColorVar;
      pin.textContent = sockMeta.symbol;
      pin.title = `${sock.label} (${sockMeta.label})`;

      if (activeSocketDrag) {
        const isCompatible =
          sock.direction === 'in' &&
          node.id !== activeSocketDrag.fromNodeId &&
          sock.dataType === activeSocketDrag.dataType;
        pin.classList.add(
          isCompatible ? 'is-compatible-target' : 'is-incompatible-target'
        );
      }

      if (sock.direction === 'out') {
        pin.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          callbacks.onStartSocketDrag(node.id, sock, e);
        });
      }

      pin.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        callbacks.onCompleteSocketDrop(node.id, sock);
      });

      const labelSpan = document.createElement('span');
      labelSpan.className = 'nplot-socket-label';
      labelSpan.textContent = sock.label;

      if (sock.direction === 'in') {
        row.appendChild(pin);
        row.appendChild(labelSpan);
        inCol.appendChild(row);
      } else {
        row.appendChild(labelSpan);
        row.appendChild(pin);
        outCol.appendChild(row);
      }
    }

    socketsGrid.appendChild(inCol);
    socketsGrid.appendChild(outCol);
    card.appendChild(socketsGrid);
  }

  // Parameters & Status Chips Footer
  const paramsFooter = document.createElement('div');
  paramsFooter.className = 'nplot-node-params';

  if (node.category === 'scene' && node.sceneParams) {
    const sp = node.sceneParams;
    if (sp.chapter) {
      const chip = document.createElement('span');
      chip.className = 'nplot-chip';
      chip.textContent = sp.chapter;
      paramsFooter.appendChild(chip);
    }
    if (sp.timepoint) {
      const chip = document.createElement('span');
      chip.className = 'nplot-chip';
      chip.textContent = `🕒 ${sp.timepoint}`;
      paramsFooter.appendChild(chip);
    }
    const tensionChip = document.createElement('span');
    tensionChip.className = 'nplot-chip';
    const tSign = sp.tension > 0 ? `+${sp.tension}` : `${sp.tension}`;
    tensionChip.textContent = `感情:${tSign}`;
    paramsFooter.appendChild(tensionChip);

    if (sp.manuscriptPath) {
      const msBtn = document.createElement('button');
      msBtn.className = 'nplot-btn';
      msBtn.textContent = `📄 ${sp.manuscriptPath}`;
      msBtn.title = 'クリックして Genkou Sheet（またはエディタ）で原稿を開く';
      msBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onOpenManuscript(node);
      });
      paramsFooter.appendChild(msBtn);
    }
  } else if (node.category === 'character' && node.characterParams?.role) {
    const chip = document.createElement('span');
    chip.className = 'nplot-chip';
    chip.textContent = node.characterParams.role;
    paramsFooter.appendChild(chip);
  } else if (node.category === 'foreshadow') {
    const status = getForeshadowNodeStatus(doc, node.id);
    const chip = document.createElement('span');
    if (status === 'resolved') {
      chip.className = 'nplot-chip is-ok';
      chip.textContent = '✓ 回収済';
    } else if (status === 'unresolved') {
      chip.className = 'nplot-chip is-alert';
      chip.textContent = '⚠ 未回収の伏線';
    } else {
      chip.className = 'nplot-chip is-alert';
      chip.textContent = '⚠ 未提示';
    }
    paramsFooter.appendChild(chip);
  }

  for (const cp of node.customParams) {
    const chip = document.createElement('span');
    chip.className = 'nplot-chip';
    chip.textContent = `${cp.key}: ${cp.value}`;
    paramsFooter.appendChild(chip);
  }

  if (paramsFooter.childElementCount > 0) {
    card.appendChild(paramsFooter);
  }

  return card;
}
