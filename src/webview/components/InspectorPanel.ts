import {
  FRAME_COLORS,
  FRAME_COLOR_LABELS,
  collectFrameContents,
  computeFrameHierarchy,
  getFrameAncestors,
  getNodeFramePath,
} from '../../core/frameLayout';
import {
  addCustomSocket,
  applyCertaintyFromTags,
  countNodesWithCertaintyTags,
  removeEdge,
} from '../../core/graphEngine';
import {
  addLines,
  createLine,
  detachLineFromScene,
  getLines,
  parseLineCaptureText,
  placeLine,
  speakerDisplayName,
  summarizeSceneLines,
  unplaceLine,
} from '../../core/lineShelf';
import {
  CERTAINTY_META,
  CERTAINTY_ORDER,
  CERTAINTY_TAG_ALIASES,
  NODE_CATEGORY_META,
  SOCKET_TYPE_META,
} from '../../core/theme';
import {
  EdgeLineStyle,
  NodeCategory,
  NodeCertainty,
  PlotDocument,
  PlotEdge,
  PlotFrame,
  PlotLine,
  PlotNode,
  SceneStatus,
  SocketDataType,
  SocketDirection,
} from '../../core/types';

export interface InspectorCallbacks {
  onDocumentMutated: (nextDoc: PlotDocument) => void;
  onClearSelection: () => void;
  onCloseInspector: () => void;
  onOpenManuscript: (node: PlotNode, createIfMissing: boolean) => void;
  onPromoteCategory: (nodeId: string, category: NodeCategory) => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onWrapSelectionInFrame: () => void;
  onFitFrameToContents: (frameId: string) => void;
  onDeleteFrame: (frameId: string, withContents: boolean) => void;
  onFocusNode: (nodeId: string) => void;
  onNotify: (message: string) => void;
  onOpenLineShelf: (opts: { sceneId?: string; speakerId?: string; focusInput?: boolean }) => void;
}

export interface InspectorSelection {
  nodeIds: string[];
  edgeId: string | null;
  frameId: string | null;
}

export class InspectorPanel {
  public readonly element: HTMLElement;
  private fieldCounter = 0;

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element = document.createElement('aside');
    this.element.className = 'nplot-inspector';
  }

  public render(doc: PlotDocument, visible: boolean, selection: InspectorSelection): void {
    this.element.classList.toggle('is-collapsed', !visible);
    if (!visible) {
      return;
    }
    // change イベント（フォーカス移動）で再描画されても、移動先の入力欄のフォーカスを保つ
    const active = document.activeElement as HTMLElement | null;
    const focusKey =
      active && this.element.contains(active) ? active.dataset.fieldKey ?? null : null;
    const scrollTop = this.element.scrollTop;
    this.fieldCounter = 0;
    this.element.replaceChildren();
    this.renderContent(doc, selection);
    this.element.scrollTop = scrollTop;
    if (focusKey) {
      this.element.querySelector<HTMLElement>(`[data-field-key="${focusKey}"]`)?.focus();
    }
  }

  private renderContent(doc: PlotDocument, selection: InspectorSelection): void {
    if (selection.nodeIds.length > 1) {
      this.renderMultiSelectionInspector(doc, selection.nodeIds);
      return;
    }
    if (selection.nodeIds.length === 1) {
      const node = doc.nodes.find((n) => n.id === selection.nodeIds[0]);
      if (node) {
        this.renderNodeInspector(doc, node);
        return;
      }
    }
    if (selection.edgeId) {
      const edge = doc.edges.find((e) => e.id === selection.edgeId);
      if (edge) {
        this.renderEdgeInspector(doc, edge);
        return;
      }
    }
    if (selection.frameId) {
      const frame = doc.frames.find((f) => f.id === selection.frameId);
      if (frame) {
        this.renderFrameInspector(doc, frame);
        return;
      }
    }
    this.renderPlotOverviewInspector(doc);
  }

  private createPanelTopBar(titleText: string, extraButton?: HTMLElement): HTMLElement {
    const header = document.createElement('div');
    header.className = 'nplot-field-row nplot-panel-topbar';

    const secTitle = document.createElement('div');
    secTitle.className = 'nplot-section-title';
    secTitle.textContent = titleText;
    header.appendChild(secTitle);

    const actions = document.createElement('div');
    actions.className = 'nplot-field-row';
    if (extraButton) {
      actions.appendChild(extraButton);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'nplot-btn';
    closeBtn.textContent = '×';
    closeBtn.title = '詳細パネルを折りたたむ（キャンバスを広く使う）';
    closeBtn.addEventListener('click', () => this.callbacks.onCloseInspector());
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    return header;
  }

  private createSectionTitle(text: string): HTMLElement {
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = text;
    return title;
  }

  private createHelp(text: string): HTMLElement {
    const help = document.createElement('div');
    help.className = 'nplot-help';
    help.textContent = text;
    return help;
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  private renderPlotOverviewInspector(doc: PlotDocument): void {
    this.element.appendChild(this.createPanelTopBar('プロット全体設定'));

    this.element.appendChild(
      this.createTextField('作品タイトル', doc.title, (val) => {
        this.callbacks.onDocumentMutated({ ...doc, title: val });
      })
    );

    this.element.appendChild(
      this.createTextAreaField('ログライン・全体あらすじ', doc.synopsis, (val) => {
        this.callbacks.onDocumentMutated({ ...doc, synopsis: val });
      })
    );

    const pendingCertainty = countNodesWithCertaintyTags(doc, CERTAINTY_TAG_ALIASES);
    if (pendingCertainty > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'nplot-field nplot-callout';
      wrap.appendChild(this.createSectionTitle('確定度の一括設定'));
      wrap.appendChild(
        this.createHelp(
          `「決定」「案」「未統合」などのタグが付いたノードが ${pendingCertainty} 件あります。タグから確定度（カードの枠線表現・絞り込みに使用）を設定できます。`
        )
      );
      const row = document.createElement('div');
      row.className = 'nplot-field-row is-wrap';
      const keepBtn = document.createElement('button');
      keepBtn.className = 'nplot-btn';
      keepBtn.textContent = 'タグから設定';
      keepBtn.addEventListener('click', () => {
        const r = applyCertaintyFromTags(doc, CERTAINTY_TAG_ALIASES, false);
        this.callbacks.onDocumentMutated(r.document);
        this.callbacks.onNotify(`${r.updatedCount} 件のノードに確定度を設定しました。`);
      });
      const moveBtn = document.createElement('button');
      moveBtn.className = 'nplot-btn';
      moveBtn.textContent = '設定してタグを外す';
      moveBtn.addEventListener('click', () => {
        const r = applyCertaintyFromTags(doc, CERTAINTY_TAG_ALIASES, true);
        this.callbacks.onDocumentMutated(r.document);
        this.callbacks.onNotify(
          `${r.updatedCount} 件のノードに確定度を設定し、元のタグを外しました。`
        );
      });
      row.append(keepBtn, moveBtn);
      wrap.appendChild(row);
      this.element.appendChild(wrap);
    }

    const guide = document.createElement('div');
    guide.className = 'nplot-field';
    guide.appendChild(this.createSectionTitle('ショートカット・操作'));
    const tips = [
      '背景ダブルクリック：新規メモ付箋（枠の中でも可）',
      '背景ドラッグ／中ボタンドラッグ：パン',
      'Shift＋背景ドラッグ：範囲選択',
      'Shift／⌘クリック：複数選択に追加・解除',
      '右端子(▶●◆■)→左端子またはカードへドロップ：接続',
      'タイトル・枠見出しのダブルクリック：名前を編集',
      '枠の辺・角ドラッグ：サイズ変更／カード右端ドラッグ：幅変更',
      '⌘C / ⌘V：コピー・貼り付け　⌘D：複製　⌘A：全選択',
      'Delete / Backspace：選択要素を削除　Esc：選択解除',
      '⌘Z：元に戻す（VS Code 標準の Undo）',
    ];
    for (const tip of tips) {
      const chip = document.createElement('div');
      chip.className = 'nplot-chip';
      chip.textContent = tip;
      guide.appendChild(chip);
    }
    this.element.appendChild(guide);
  }

  // ---------------------------------------------------------------------------
  // Multi selection
  // ---------------------------------------------------------------------------

  private renderMultiSelectionInspector(doc: PlotDocument, nodeIds: string[]): void {
    const ids = new Set(nodeIds);
    const nodes = doc.nodes.filter((n) => ids.has(n.id));
    this.element.appendChild(this.createPanelTopBar(`${nodes.length} 件のノードを選択中`));

    const counts = new Map<NodeCategory, number>();
    for (const n of nodes) {
      counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    }
    const summary = document.createElement('div');
    summary.className = 'nplot-field-row is-wrap';
    for (const [cat, count] of counts) {
      const chip = document.createElement('span');
      chip.className = 'nplot-chip';
      chip.textContent = `${NODE_CATEGORY_META[cat].label} ×${count}`;
      summary.appendChild(chip);
    }
    this.element.appendChild(summary);

    const wrapBtn = document.createElement('button');
    wrapBtn.className = 'nplot-btn is-primary';
    wrapBtn.textContent = '▢ 選択を枠で囲む（グループ化）';
    wrapBtn.title = '選択したノードを囲む新しい枠を作ります。例：キャラクターを組織ごとに束ねる';
    wrapBtn.addEventListener('click', () => this.callbacks.onWrapSelectionInFrame());
    this.element.appendChild(wrapBtn);

    this.element.appendChild(
      this.createCertaintyField(
        undefined,
        (value) => {
          const nextNodes = doc.nodes.map((n) => (ids.has(n.id) ? this.withCertainty(n, value) : n));
          this.callbacks.onDocumentMutated({ ...doc, nodes: nextNodes });
        },
        true
      )
    );

    const actions = document.createElement('div');
    actions.className = 'nplot-field-row';
    const dupBtn = document.createElement('button');
    dupBtn.className = 'nplot-btn';
    dupBtn.textContent = '複製';
    dupBtn.addEventListener('click', () => this.callbacks.onDuplicateSelection());
    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn is-danger';
    delBtn.textContent = '選択したノードを削除';
    delBtn.addEventListener('click', () => this.callbacks.onDeleteSelection());
    actions.append(dupBtn, delBtn);
    this.element.appendChild(actions);
  }

  private withCertainty(n: PlotNode, value: NodeCertainty | undefined): PlotNode {
    const next = { ...n };
    if (value) {
      next.certainty = value;
    } else {
      delete next.certainty;
    }
    return next;
  }

  private createCertaintyField(
    current: NodeCertainty | undefined,
    onChange: (value: NodeCertainty | undefined) => void,
    isBulk = false
  ): HTMLElement {
    const field = document.createElement('div');
    field.className = 'nplot-field';
    const label = document.createElement('label');
    label.textContent = isBulk ? '確定度を一括設定' : '確定度（決定／案／未整理）';
    const row = document.createElement('div');
    row.className = 'nplot-segmented';
    const options: { value: NodeCertainty | undefined; label: string; title: string }[] = [
      ...CERTAINTY_ORDER.map((c) => ({
        value: c as NodeCertainty | undefined,
        label: CERTAINTY_META[c].label,
        title: CERTAINTY_META[c].description,
      })),
      { value: undefined, label: '未設定', title: '確定度を設定しない' },
    ];
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nplot-segmented-btn';
      if (!isBulk && current === opt.value) {
        btn.classList.add('is-active');
      }
      btn.textContent = opt.label;
      btn.title = opt.title;
      btn.addEventListener('click', () => onChange(opt.value));
      row.appendChild(btn);
    }
    field.append(label, row);
    return field;
  }

  // ---------------------------------------------------------------------------
  // Single node
  // ---------------------------------------------------------------------------

  private renderNodeInspector(doc: PlotDocument, node: PlotNode): void {
    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn is-danger';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => this.callbacks.onDeleteSelection());

    this.element.appendChild(
      this.createPanelTopBar(`ノード編集 (${NODE_CATEGORY_META[node.category].label})`, delBtn)
    );

    // Category promotion select
    const catField = document.createElement('div');
    catField.className = 'nplot-field';
    const catLabel = document.createElement('label');
    catLabel.textContent = 'ノード種別（昇格・変更）';
    const catSelect = document.createElement('select');
    catSelect.className = 'nplot-select';
    const cats: NodeCategory[] = ['note', 'scene', 'character', 'foreshadow', 'world_item'];
    for (const c of cats) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = NODE_CATEGORY_META[c].label;
      opt.selected = node.category === c;
      catSelect.appendChild(opt);
    }
    catSelect.addEventListener('change', () => {
      this.callbacks.onPromoteCategory(node.id, catSelect.value as NodeCategory);
    });
    catField.append(catLabel, catSelect);
    this.element.appendChild(catField);

    // Frame membership (derived from geometry)
    const framePath = getNodeFramePath(doc, node.id, computeFrameHierarchy(doc));
    const pathField = document.createElement('div');
    pathField.className = 'nplot-field';
    const pathLabel = document.createElement('label');
    pathLabel.textContent = '所属する枠';
    const pathValue = document.createElement('div');
    pathValue.className = 'nplot-breadcrumb';
    pathValue.textContent =
      framePath.length > 0
        ? framePath.map((f) => f.title).join(' › ')
        : '（どの枠にも入っていません）';
    pathValue.title = 'ノードを枠の中へドラッグすると所属します（枠は入れ子にできます）';
    pathField.append(pathLabel, pathValue);
    this.element.appendChild(pathField);

    this.element.appendChild(
      this.createCertaintyField(node.certainty, (value) => {
        this.updateNode(doc, node.id, (n) => this.withCertainty(n, value));
      })
    );

    // Title & Body
    this.element.appendChild(
      this.createTextField('タイトル', node.title, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, title: val }));
      })
    );

    this.element.appendChild(
      this.createTextAreaField('本文・メモ・内容', node.body, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, body: val }));
      })
    );

    this.element.appendChild(
      this.createTextField('タグ（読点・カンマ区切り）', node.tags.join('、'), (val) => {
        const tags = val
          .split(/[、,，]/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter((t) => t.length > 0);
        this.updateNode(doc, node.id, (n) => ({ ...n, tags: [...new Set(tags)] }));
      })
    );

    if (node.width) {
      const widthRow = document.createElement('div');
      widthRow.className = 'nplot-field-row';
      widthRow.appendChild(this.createHelp(`カード幅: ${node.width}px`));
      const resetBtn = document.createElement('button');
      resetBtn.className = 'nplot-btn';
      resetBtn.textContent = '標準幅に戻す';
      resetBtn.addEventListener('click', () => {
        this.updateNode(doc, node.id, (n) => {
          const next = { ...n };
          delete next.width;
          return next;
        });
      });
      widthRow.appendChild(resetBtn);
      this.element.appendChild(widthRow);
    }

    // Category specific parameters
    if (node.category === 'scene') {
      this.renderSceneParams(doc, node);
      this.renderSceneLinesSection(doc, node);
    } else if (node.category === 'character') {
      this.renderCharacterParams(doc, node);
      this.renderCharacterLinesSection(doc, node);
    } else if (node.category === 'foreshadow') {
      this.renderForeshadowParams(doc, node);
    } else if (node.category === 'world_item') {
      this.renderWorldItemParams(doc, node);
    }

    this.renderCustomParametersSection(doc, node);
    this.renderSocketManagerSection(doc, node);
  }

  private renderSceneParams(doc: PlotDocument, node: PlotNode): void {
    const sp = node.sceneParams ?? {
      chapter: '第1章',
      timepoint: '',
      pov: '',
      tension: 0,
      status: 'idea' as SceneStatus,
      manuscriptPath: '',
    };

    this.element.appendChild(this.createSectionTitle('シーン専用パラメータ'));

    this.element.appendChild(
      this.createTextField('章・幕 (Chapter)', sp.chapter, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, sceneParams: { ...sp, chapter: val } }));
      })
    );

    this.element.appendChild(
      this.createTextField('作中時系列 (Timepoint)', sp.timepoint, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, sceneParams: { ...sp, timepoint: val } }));
      })
    );

    const povField = this.createTextField('視点人物 (POV)', sp.pov, (val) => {
      this.updateNode(doc, node.id, (n) => ({ ...n, sceneParams: { ...sp, pov: val } }));
    });
    const povInput = povField.querySelector('input');
    const characterNames = doc.nodes
      .filter((n) => n.category === 'character')
      .map((n) => n.title.replace(/（[^）]*）|\([^)]*\)/g, '').trim())
      .filter((t) => t.length > 0);
    if (povInput) {
      povInput.placeholder = 'キャラクター名（複数は「／」区切り）';
    }
    if (povInput && characterNames.length > 0) {
      const listId = `nplot-pov-list-${node.id}`;
      const datalist = document.createElement('datalist');
      datalist.id = listId;
      for (const name of new Set(characterNames)) {
        const opt = document.createElement('option');
        opt.value = name;
        datalist.appendChild(opt);
      }
      povInput.setAttribute('list', listId);
      povField.appendChild(datalist);
    }
    this.element.appendChild(povField);

    // Tension slider (-5 to +5)
    const tensionField = document.createElement('div');
    tensionField.className = 'nplot-field';
    const tensionLabel = document.createElement('label');
    const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    tensionLabel.textContent = `感情・テンション値: ${fmt(sp.tension)}`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-5';
    slider.max = '5';
    slider.step = '1';
    slider.value = String(sp.tension);
    slider.addEventListener('input', () => {
      tensionLabel.textContent = `感情・テンション値: ${fmt(Number.parseInt(slider.value, 10))}`;
    });
    slider.addEventListener('change', () => {
      const val = Number.parseInt(slider.value, 10);
      this.updateNode(doc, node.id, (n) => ({ ...n, sceneParams: { ...sp, tension: val } }));
    });
    tensionField.append(tensionLabel, slider);
    this.element.appendChild(tensionField);

    // Status
    const statusField = document.createElement('div');
    statusField.className = 'nplot-field';
    const statusLabel = document.createElement('label');
    statusLabel.textContent = '執筆ステータス';
    const statusSelect = document.createElement('select');
    statusSelect.className = 'nplot-select';
    const statuses: { value: SceneStatus; label: string }[] = [
      { value: 'idea', label: '構想中 (Idea)' },
      { value: 'draft', label: 'プロット作成済 (Draft)' },
      { value: 'fixed', label: '構成確定 (Fixed)' },
      { value: 'written', label: '原稿執筆済 (Written)' },
    ];
    for (const st of statuses) {
      const opt = document.createElement('option');
      opt.value = st.value;
      opt.textContent = st.label;
      opt.selected = sp.status === st.value;
      statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener('change', () => {
      this.updateNode(doc, node.id, (n) => ({
        ...n,
        sceneParams: { ...sp, status: statusSelect.value as SceneStatus },
      }));
    });
    statusField.append(statusLabel, statusSelect);
    this.element.appendChild(statusField);

    // Genkou Sheet Manuscript Link
    this.element.appendChild(
      this.createTextField('原稿ファイルパス (Genkou連携)', sp.manuscriptPath, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          sceneParams: { ...sp, manuscriptPath: val },
        }));
      })
    );

    const openMsBtn = document.createElement('button');
    openMsBtn.className = 'nplot-btn';
    openMsBtn.textContent = '📄 原稿を Genkou で開く / 作成';
    openMsBtn.addEventListener('click', () => this.callbacks.onOpenManuscript(node, true));
    this.element.appendChild(openMsBtn);
  }

  // ---------------------------------------------------------------------------
  // Lines (セリフ棚)
  // ---------------------------------------------------------------------------

  private renderSceneLinesSection(doc: PlotDocument, node: PlotNode): void {
    const summary = summarizeSceneLines(doc).get(node.id) ?? { placed: [], candidates: [] };
    const speakers = new Map(doc.nodes.filter((n) => n.category === 'character').map((n) => [n.id, n]));
    const wrap = document.createElement('div');
    wrap.className = 'nplot-inspector-lines';
    wrap.appendChild(
      this.createSectionTitle(`セリフ（確定 ${summary.placed.length}・候補 ${summary.candidates.length}）`)
    );

    const renderItem = (line: PlotLine, placed: boolean) => {
      const row = document.createElement('div');
      row.className = `nplot-inspector-line ${placed ? 'is-placed' : 'is-candidate'}`;
      const text = document.createElement('div');
      text.className = 'nplot-inspector-line-text';
      text.textContent = `${speakerDisplayName(speakers.get(line.speakerId))}「${line.text}」`;
      text.title = line.note ? `メモ: ${line.note}` : '';
      const actions = document.createElement('div');
      actions.className = 'nplot-inspector-line-actions';
      if (placed) {
        actions.appendChild(
          this.createMiniButton('候補に戻す', () => this.callbacks.onDocumentMutated(unplaceLine(doc, line.id)))
        );
      } else {
        actions.appendChild(
          this.createMiniButton('★ 確定', () =>
            this.callbacks.onDocumentMutated(placeLine(doc, line.id, node.id))
          )
        );
      }
      actions.appendChild(
        this.createMiniButton('外す', () =>
          this.callbacks.onDocumentMutated(detachLineFromScene(doc, line.id, node.id))
        )
      );
      row.append(text, actions);
      wrap.appendChild(row);
    };
    summary.placed.forEach((l) => renderItem(l, true));
    summary.candidates.forEach((l) => renderItem(l, false));
    if (summary.placed.length + summary.candidates.length === 0) {
      wrap.appendChild(
        this.createHelp('まだこのシーンに配置されたセリフはありません。セリフ棚からドラッグで候補に追加できます。')
      );
    }

    const row = document.createElement('div');
    row.className = 'nplot-field-row';
    row.appendChild(
      this.createMiniButton('セリフ棚でこのシーンを開く', () =>
        this.callbacks.onOpenLineShelf({ sceneId: node.id })
      )
    );
    wrap.appendChild(row);
    this.element.appendChild(wrap);
  }

  private renderCharacterLinesSection(doc: PlotDocument, node: PlotNode): void {
    const lines = getLines(doc).filter((l) => l.speakerId === node.id);
    const sceneIds = new Set(doc.nodes.filter((n) => n.category === 'scene').map((n) => n.id));
    const placed = lines.filter((l) => l.placedSceneId && sceneIds.has(l.placedSceneId)).length;
    const wrap = document.createElement('div');
    wrap.className = 'nplot-inspector-lines';
    wrap.appendChild(this.createSectionTitle(`セリフ（${lines.length} 件・うち確定 ${placed}）`));

    const input = document.createElement('textarea');
    input.className = 'nplot-input nplot-inspector-line-input';
    input.rows = 2;
    input.placeholder = `${speakerDisplayName(node)}が言いそうなセリフ（Enter で追加・Shift+Enter で改行）`;
    const submit = () => {
      const text = input.value.trim();
      if (!text) {
        return;
      }
      const characters = doc.nodes.filter((n) => n.category === 'character');
      const added = parseLineCaptureText(text, characters, node.id).map((p) =>
        createLine({ speakerId: p.speakerId, text: p.text, note: p.note })
      );
      if (added.length === 0) {
        return;
      }
      input.value = '';
      this.callbacks.onDocumentMutated(addLines(doc, added));
      this.callbacks.onNotify(`${speakerDisplayName(node)}のセリフを ${added.length} 件書き留めました`);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    wrap.appendChild(input);

    const recent = lines.slice(-3).reverse();
    for (const line of recent) {
      const item = document.createElement('div');
      item.className = 'nplot-inspector-line-text is-recent';
      item.textContent = `「${line.text}」`;
      wrap.appendChild(item);
    }

    const row = document.createElement('div');
    row.className = 'nplot-field-row';
    row.appendChild(this.createMiniButton('追加', submit));
    row.appendChild(
      this.createMiniButton('セリフ棚で一覧', () => this.callbacks.onOpenLineShelf({ speakerId: node.id }))
    );
    wrap.appendChild(row);
    this.element.appendChild(wrap);
  }

  private createMiniButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nplot-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private renderCharacterParams(doc: PlotDocument, node: PlotNode): void {
    const cp = node.characterParams ?? { role: '', goal: '', flaw: '' };
    this.element.appendChild(this.createSectionTitle('キャラクター属性'));

    this.element.appendChild(
      this.createTextField('役割・立ち位置', cp.role, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, characterParams: { ...cp, role: val } }));
      })
    );
    this.element.appendChild(
      this.createTextField('目的・動機 (Goal)', cp.goal, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, characterParams: { ...cp, goal: val } }));
      })
    );
    this.element.appendChild(
      this.createTextField('秘密・弱点・葛藤 (Flaw)', cp.flaw, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, characterParams: { ...cp, flaw: val } }));
      })
    );
  }

  private renderForeshadowParams(doc: PlotDocument, node: PlotNode): void {
    const fp = node.foreshadowParams ?? { hintDetail: '', payoffIdea: '' };
    this.element.appendChild(this.createSectionTitle('伏線・謎の設計'));

    this.element.appendChild(
      this.createTextField('提示方法の具体案', fp.hintDetail, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          foreshadowParams: { ...fp, hintDetail: val },
        }));
      })
    );
    this.element.appendChild(
      this.createTextField('回収時の真相・カタルシス', fp.payoffIdea, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          foreshadowParams: { ...fp, payoffIdea: val },
        }));
      })
    );
  }

  private renderWorldItemParams(doc: PlotDocument, node: PlotNode): void {
    const ip = node.itemParams ?? { itemType: '', ruleOrCondition: '' };
    this.element.appendChild(this.createSectionTitle('アイテム・世界観ルール'));

    this.element.appendChild(
      this.createTextField('種別 (アイテム/設定/条件)', ip.itemType, (val) => {
        this.updateNode(doc, node.id, (n) => ({ ...n, itemParams: { ...ip, itemType: val } }));
      })
    );
    this.element.appendChild(
      this.createTextField('発動条件・制約ルール', ip.ruleOrCondition, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          itemParams: { ...ip, ruleOrCondition: val },
        }));
      })
    );
  }

  private renderCustomParametersSection(doc: PlotDocument, node: PlotNode): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'nplot-field';
    wrapper.appendChild(this.createSectionTitle('カスタムパラメータ (Key: Value)'));

    node.customParams.forEach((param, idx) => {
      const row = document.createElement('div');
      row.className = 'nplot-field-row';

      const kInput = document.createElement('input');
      kInput.className = 'nplot-input nplot-kv-key';
      kInput.value = param.key;
      kInput.placeholder = '項目名';
      kInput.dataset.fieldKey = `f${this.fieldCounter++}`;

      const vInput = document.createElement('input');
      vInput.className = 'nplot-input nplot-kv-value';
      vInput.value = param.value;
      vInput.placeholder = '値';
      vInput.dataset.fieldKey = `f${this.fieldCounter++}`;

      const commitChange = () => {
        const nextParams = [...node.customParams];
        nextParams[idx] = { key: kInput.value.trim() || '項目', value: vInput.value };
        this.updateNode(doc, node.id, (n) => ({ ...n, customParams: nextParams }));
      };
      kInput.addEventListener('change', commitChange);
      vInput.addEventListener('change', commitChange);

      const rmBtn = document.createElement('button');
      rmBtn.className = 'nplot-btn';
      rmBtn.textContent = '×';
      rmBtn.title = 'このパラメータを削除';
      rmBtn.addEventListener('click', () => {
        const nextParams = node.customParams.filter((_, i) => i !== idx);
        this.updateNode(doc, node.id, (n) => ({ ...n, customParams: nextParams }));
      });

      row.append(kInput, vInput, rmBtn);
      wrapper.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'nplot-btn';
    addBtn.textContent = '+ パラメータを追加';
    addBtn.addEventListener('click', () => {
      this.updateNode(doc, node.id, (n) => ({
        ...n,
        customParams: [...n.customParams, { key: '属性', value: '' }],
      }));
    });
    wrapper.appendChild(addBtn);
    this.element.appendChild(wrapper);
  }

  private renderSocketManagerSection(doc: PlotDocument, node: PlotNode): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'nplot-field';
    wrapper.appendChild(this.createSectionTitle('入出力ソケット端子追加'));

    const row = document.createElement('div');
    row.className = 'nplot-field-row';

    const dirSelect = document.createElement('select');
    dirSelect.className = 'nplot-select';
    for (const [value, label] of [
      ['in', '入力(左)'],
      ['out', '出力(右)'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      dirSelect.appendChild(opt);
    }

    const typeSelect = document.createElement('select');
    typeSelect.className = 'nplot-select';
    const types: SocketDataType[] = ['flow', 'character', 'foreshadow', 'item'];
    for (const t of types) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = `${SOCKET_TYPE_META[t].symbol} ${SOCKET_TYPE_META[t].label}`;
      typeSelect.appendChild(opt);
    }

    row.append(dirSelect, typeSelect);
    wrapper.appendChild(row);

    const labelRow = document.createElement('div');
    labelRow.className = 'nplot-field-row';
    const sockLabelInput = document.createElement('input');
    sockLabelInput.className = 'nplot-input nplot-grow';
    sockLabelInput.placeholder = '端子名（例: 秘密の鍵）';

    const addSockBtn = document.createElement('button');
    addSockBtn.className = 'nplot-btn';
    addSockBtn.textContent = '+ 追加';
    addSockBtn.addEventListener('click', () => {
      const next = addCustomSocket(
        doc,
        node.id,
        sockLabelInput.value || 'カスタム端子',
        typeSelect.value as SocketDataType,
        dirSelect.value as SocketDirection
      );
      this.callbacks.onDocumentMutated(next);
    });

    labelRow.append(sockLabelInput, addSockBtn);
    wrapper.appendChild(labelRow);
    this.element.appendChild(wrapper);
  }

  // ---------------------------------------------------------------------------
  // Edge
  // ---------------------------------------------------------------------------

  private renderEdgeInspector(doc: PlotDocument, edge: PlotEdge): void {
    this.element.appendChild(
      this.createPanelTopBar(`ワイヤー編集 (${SOCKET_TYPE_META[edge.dataType].label})`)
    );

    const from = doc.nodes.find((n) => n.id === edge.fromNodeId);
    const to = doc.nodes.find((n) => n.id === edge.toNodeId);
    const route = document.createElement('div');
    route.className = 'nplot-breadcrumb';
    route.textContent = `${from?.title ?? '?'} → ${to?.title ?? '?'}`;
    this.element.appendChild(route);

    this.element.appendChild(
      this.createTextField('関係ラベル（線上に表示）', edge.label ?? '', (val) => {
        const nextEdges = doc.edges.map((e) =>
          e.id === edge.id ? { ...e, label: val.trim() || undefined } : e
        );
        this.callbacks.onDocumentMutated({ ...doc, edges: nextEdges });
      })
    );

    const styleField = document.createElement('div');
    styleField.className = 'nplot-field';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = '線のスタイル';
    const styleSelect = document.createElement('select');
    styleSelect.className = 'nplot-select';
    for (const [value, label] of [
      ['solid', '実線（確定ルート・確定関係）'],
      ['dashed', '破線（IF分岐案・仮接続）'],
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.selected = edge.lineStyle === value;
      styleSelect.appendChild(opt);
    }
    styleSelect.addEventListener('change', () => {
      const nextEdges = doc.edges.map((e) =>
        e.id === edge.id ? { ...e, lineStyle: styleSelect.value as EdgeLineStyle } : e
      );
      this.callbacks.onDocumentMutated({ ...doc, edges: nextEdges });
    });
    styleField.append(styleLabel, styleSelect);
    this.element.appendChild(styleField);

    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn is-danger';
    delBtn.textContent = 'この接続線を切断（削除）';
    delBtn.addEventListener('click', () => {
      const next = removeEdge(doc, edge.id);
      this.callbacks.onClearSelection();
      this.callbacks.onDocumentMutated(next);
    });
    this.element.appendChild(delBtn);
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private renderFrameInspector(doc: PlotDocument, frame: PlotFrame): void {
    this.element.appendChild(this.createPanelTopBar('枠（グループ）編集'));

    const updateFrame = (patch: Partial<PlotFrame>) => {
      const nextFrames = doc.frames.map((f) => {
        if (f.id !== frame.id) {
          return f;
        }
        const next = { ...f, ...patch };
        if (!next.colorTag) {
          delete next.colorTag;
        }
        return next;
      });
      this.callbacks.onDocumentMutated({ ...doc, frames: nextFrames });
    };

    this.element.appendChild(
      this.createTextField('枠の見出し', frame.title, (val) => updateFrame({ title: val }))
    );

    // Color swatches
    const colorField = document.createElement('div');
    colorField.className = 'nplot-field';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = '塗り色';
    const swatches = document.createElement('div');
    swatches.className = 'nplot-swatches';
    const current = frame.colorTag ?? 'none';
    for (const color of FRAME_COLORS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'nplot-swatch';
      if (current === color) {
        sw.classList.add('is-active');
      }
      sw.dataset.color = color;
      sw.title = FRAME_COLOR_LABELS[color];
      sw.setAttribute('aria-label', FRAME_COLOR_LABELS[color]);
      sw.addEventListener('click', () =>
        updateFrame({ colorTag: color === 'none' ? undefined : color })
      );
      swatches.appendChild(sw);
    }
    colorField.append(colorLabel, swatches);
    this.element.appendChild(colorField);

    // Nesting info
    const hierarchy = computeFrameHierarchy(doc);
    const ancestors = getFrameAncestors(doc, frame.id, hierarchy);
    const contents = collectFrameContents(doc, frame.id);
    const directChildren = doc.frames.filter((f) => hierarchy.frameParent.get(f.id) === frame.id);
    const directNodes = doc.nodes.filter((n) => hierarchy.nodeFrame.get(n.id) === frame.id);

    const infoField = document.createElement('div');
    infoField.className = 'nplot-field';
    const infoLabel = document.createElement('label');
    infoLabel.textContent = '入れ子構造（枠の中に枠を置くと入れ子になります）';
    const crumb = document.createElement('div');
    crumb.className = 'nplot-breadcrumb';
    crumb.textContent = [...ancestors.map((f) => f.title), frame.title].join(' › ');
    infoField.append(
      infoLabel,
      crumb,
      this.createHelp(
        `直下のノード ${directNodes.length} 件・子枠 ${directChildren.length} 件（中身の合計：ノード ${contents.nodeIds.size} 件・枠 ${contents.frameIds.size} 件）`
      )
    );
    this.element.appendChild(infoField);

    if (directChildren.length > 0 || directNodes.length > 0) {
      const list = document.createElement('div');
      list.className = 'nplot-member-list';
      for (const f of directChildren) {
        const item = document.createElement('div');
        item.className = 'nplot-member-item is-frame';
        item.textContent = `▢ ${f.title}`;
        list.appendChild(item);
      }
      for (const n of directNodes.slice(0, 60)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'nplot-member-item';
        const dot = document.createElement('span');
        dot.textContent = '●';
        dot.style.color = NODE_CATEGORY_META[n.category].cssColorVar;
        item.append(dot, document.createTextNode(n.title));
        item.addEventListener('click', () => this.callbacks.onFocusNode(n.id));
        list.appendChild(item);
      }
      this.element.appendChild(list);
    }

    // Size
    const sizeRow = document.createElement('div');
    sizeRow.className = 'nplot-field-row';
    const wField = this.createTextField('幅 (px)', String(frame.width), (val) => {
      updateFrame({ width: Math.max(160, Number.parseInt(val, 10) || frame.width) });
    });
    const hField = this.createTextField('高さ (px)', String(frame.height), (val) => {
      updateFrame({ height: Math.max(100, Number.parseInt(val, 10) || frame.height) });
    });
    wField.classList.add('nplot-grow');
    hField.classList.add('nplot-grow');
    sizeRow.append(wField, hField);
    this.element.appendChild(sizeRow);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'nplot-btn';
    fitBtn.textContent = '中身に合わせてサイズ調整';
    fitBtn.title =
      '枠内のノード・子枠がちょうど収まる大きさにします（キャンバス上で辺や角をドラッグしても変更できます）';
    fitBtn.disabled = contents.nodeIds.size === 0 && contents.frameIds.size === 0;
    fitBtn.addEventListener('click', () => this.callbacks.onFitFrameToContents(frame.id));
    this.element.appendChild(fitBtn);

    const delRow = document.createElement('div');
    delRow.className = 'nplot-field-row is-wrap';
    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn';
    delBtn.textContent = '枠だけ削除（中身は残す）';
    delBtn.addEventListener('click', () => this.callbacks.onDeleteFrame(frame.id, false));
    delRow.appendChild(delBtn);

    if (contents.nodeIds.size > 0 || contents.frameIds.size > 0) {
      const delAllBtn = document.createElement('button');
      delAllBtn.className = 'nplot-btn is-danger';
      const idleLabel = '中身ごと削除…';
      delAllBtn.textContent = idleLabel;
      let armed = false;
      delAllBtn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          delAllBtn.textContent = `もう一度クリックで ノード${contents.nodeIds.size}件・枠${
            contents.frameIds.size + 1
          }件を削除`;
          window.setTimeout(() => {
            armed = false;
            delAllBtn.textContent = idleLabel;
          }, 4000);
          return;
        }
        this.callbacks.onDeleteFrame(frame.id, true);
      });
      delRow.appendChild(delAllBtn);
    }
    this.element.appendChild(delRow);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private updateNode(doc: PlotDocument, nodeId: string, updater: (n: PlotNode) => PlotNode): void {
    const nextNodes = doc.nodes.map((n) => (n.id === nodeId ? updater(n) : n));
    this.callbacks.onDocumentMutated({ ...doc, nodes: nextNodes });
  }

  private createTextField(
    label: string,
    value: string,
    onChange: (nextVal: string) => void
  ): HTMLElement {
    const field = document.createElement('div');
    field.className = 'nplot-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nplot-input';
    input.value = value;
    input.dataset.fieldKey = `f${this.fieldCounter++}`;
    input.addEventListener('change', () => onChange(input.value));
    field.append(lbl, input);
    return field;
  }

  private createTextAreaField(
    label: string,
    value: string,
    onChange: (nextVal: string) => void
  ): HTMLElement {
    const field = document.createElement('div');
    field.className = 'nplot-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const textarea = document.createElement('textarea');
    textarea.className = 'nplot-textarea';
    textarea.value = value;
    textarea.dataset.fieldKey = `f${this.fieldCounter++}`;
    textarea.addEventListener('change', () => onChange(textarea.value));
    field.append(lbl, textarea);
    return field;
  }
}
