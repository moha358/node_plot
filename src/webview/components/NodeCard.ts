import { getForeshadowNodeStatus } from '../../core/plotAnalyzer';
import { CERTAINTY_META, NODE_CATEGORY_META, SOCKET_TYPE_META } from '../../core/theme';
import {
  NodeCategory,
  PlotDocument,
  PlotNode,
  PlotSocket,
  SocketDataType,
} from '../../core/types';
import { getLines, speakerDisplayName } from '../../core/lineShelf';
import { startInlineEdit } from './inlineEdit';

/** シーン／キャラクターカードに付けるセリフ件数チップ。セリフが 1 件も無いときは出さない。 */
function createLineCountChip(
  doc: PlotDocument,
  node: PlotNode,
  callbacks: NodeCardCallbacks
): HTMLElement | null {
  const all = getLines(doc);
  if (all.length === 0) {
    return null;
  }
  let label: string;
  let preview: string[];
  if (node.category === 'scene') {
    const placed = all.filter((l) => l.placedSceneId === node.id);
    const cand = all.filter((l) => l.candidateSceneIds.includes(node.id));
    if (placed.length + cand.length === 0) {
      return null;
    }
    const speakers = new Map(doc.nodes.map((n) => [n.id, n]));
    label = `💬 ★${placed.length} ☆${cand.length}`;
    preview = [...placed, ...cand]
      .slice(0, 8)
      .map((l) => `${placed.includes(l) ? '★' : '☆'} ${speakerDisplayName(speakers.get(l.speakerId))}「${l.text}」`);
  } else {
    const mine = all.filter((l) => l.speakerId === node.id);
    if (mine.length === 0) {
      return null;
    }
    label = `💬 ${mine.length}`;
    preview = mine.slice(-8).map((l) => `「${l.text}」`);
  }
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'nplot-chip nplot-chip-lines';
  chip.textContent = label;
  chip.title = [...preview, '', 'クリックでセリフ棚を開く'].join('\n');
  chip.addEventListener('pointerdown', (e) => e.stopPropagation());
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onOpenLineShelf(node.category === 'scene' ? { sceneId: node.id } : { speakerId: node.id });
  });
  return chip;
}

export interface NodeCardCallbacks {
  onNodePointerDown: (nodeId: string, e: PointerEvent) => void;
  onStartDragNode: (nodeId: string, e: PointerEvent) => void;
  onStartResizeNode: (nodeId: string, e: PointerEvent) => void;
  onResetNodeWidth: (nodeId: string) => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onPromoteCategory: (nodeId: string, newCategory: NodeCategory) => void;
  onStartSocketDrag: (nodeId: string, socket: PlotSocket, e: PointerEvent) => void;
  onOpenManuscript: (node: PlotNode) => void;
  onOpenLineShelf: (opts: { sceneId?: string; speakerId?: string }) => void;
}

export interface ActiveSocketDragInfo {
  fromNodeId: string;
  fromSocketId: string;
  dataType: SocketDataType;
}

/**
 * ノードカードの DOM を生成する。選択・減光・接続候補ハイライトなどの「状態による装飾」は
 * CanvasViewport.applyDecorations がクラス付け替えで行う（DOM 再生成を避けダブルクリック等を壊さないため）。
 */
export function createNodeCardElement(
  doc: PlotDocument,
  node: PlotNode,
  interactive: boolean,
  callbacks: NodeCardCallbacks
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'nplot-node';
  if (node.certainty) {
    card.classList.add(`is-certainty-${node.certainty}`);
  }
  card.dataset.nodeId = node.id;
  card.dataset.category = node.category;
  card.style.left = `${node.x}px`;
  card.style.top = `${node.y}px`;
  if (node.width) {
    card.style.width = `${node.width}px`;
  }

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    callbacks.onNodePointerDown(node.id, e);
  });

  // Header
  const meta = NODE_CATEGORY_META[node.category];
  const header = document.createElement('div');
  header.className = 'nplot-node-header';
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).tagName === 'SELECT') {
      return;
    }
    e.stopPropagation();
    callbacks.onNodePointerDown(node.id, e);
    callbacks.onStartDragNode(node.id, e);
  });

  const headerLeft = document.createElement('div');
  headerLeft.className = 'nplot-node-header-left';
  const badge = document.createElement('span');
  badge.className = 'nplot-node-badge';
  badge.style.background = meta.cssColorVar;
  badge.textContent = meta.badgeText;
  headerLeft.appendChild(badge);

  if (node.certainty) {
    const cBadge = document.createElement('span');
    cBadge.className = `nplot-certainty-badge is-${node.certainty}`;
    cBadge.textContent = CERTAINTY_META[node.certainty].label;
    cBadge.title = CERTAINTY_META[node.certainty].description;
    headerLeft.appendChild(cBadge);
  }
  header.appendChild(headerLeft);

  if (interactive) {
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
    categorySelect.addEventListener('pointerdown', (e) => e.stopPropagation());
    categorySelect.addEventListener('change', (e) => {
      e.stopPropagation();
      callbacks.onPromoteCategory(node.id, categorySelect.value as NodeCategory);
    });
    header.appendChild(categorySelect);
  }
  card.appendChild(header);

  // Title & Body
  const titleEl = document.createElement('div');
  titleEl.className = 'nplot-node-title-row';
  titleEl.textContent = node.title || '（無題）';
  if (interactive) {
    titleEl.title = 'ダブルクリックでタイトルを編集';
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineEdit(titleEl, node.title, (next) => callbacks.onRenameNode(node.id, next));
    });
  }
  card.appendChild(titleEl);

  if (node.body.trim()) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'nplot-node-body';
    bodyEl.textContent = node.body;
    bodyEl.title = node.body;
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
      pin.dataset.dataType = sock.dataType;
      pin.dataset.direction = sock.direction;
      pin.style.color = sockMeta.cssColorVar;
      pin.textContent = sockMeta.symbol;
      pin.title = `${sock.label} (${sockMeta.label})`;

      if (interactive && sock.direction === 'out') {
        pin.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) {
            return;
          }
          e.stopPropagation();
          callbacks.onStartSocketDrag(node.id, sock, e);
        });
      }

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
    if (sp.pov) {
      const chip = document.createElement('span');
      chip.className = 'nplot-chip';
      chip.textContent = `視点: ${sp.pov}`;
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

    const linesChip = createLineCountChip(doc, node, callbacks);
    if (linesChip) {
      paramsFooter.appendChild(linesChip);
    }

    if (sp.manuscriptPath) {
      const msBtn = document.createElement('button');
      msBtn.className = 'nplot-btn';
      msBtn.textContent = `📄 ${sp.manuscriptPath}`;
      msBtn.title = 'クリックして Genkou Sheet（またはエディタ）で原稿を開く';
      msBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      msBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onOpenManuscript(node);
      });
      paramsFooter.appendChild(msBtn);
    }
  } else if (node.category === 'character') {
    if (node.characterParams?.role) {
      const chip = document.createElement('span');
      chip.className = 'nplot-chip';
      chip.textContent = node.characterParams.role;
      paramsFooter.appendChild(chip);
    }
    const linesChip = createLineCountChip(doc, node, callbacks);
    if (linesChip) {
      paramsFooter.appendChild(linesChip);
    }
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

  for (const tag of node.tags) {
    const chip = document.createElement('span');
    chip.className = 'nplot-chip is-tag';
    chip.textContent = `#${tag}`;
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

  if (interactive) {
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'nplot-node-resize';
    resizeHandle.title = 'ドラッグで幅を変更（ダブルクリックで標準幅に戻す）';
    resizeHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) {
        return;
      }
      e.stopPropagation();
      callbacks.onNodePointerDown(node.id, e);
      callbacks.onStartResizeNode(node.id, e);
    });
    resizeHandle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      callbacks.onResetNodeWidth(node.id);
    });
    card.appendChild(resizeHandle);
  }

  return card;
}
