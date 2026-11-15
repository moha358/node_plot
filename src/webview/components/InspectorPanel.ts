import { addCustomSocket, promoteNodeCategory, removeEdge, removeNode } from '../../core/graphEngine';
import { NODE_CATEGORY_META, SOCKET_TYPE_META } from '../../core/theme';
import {
  EdgeLineStyle,
  NodeCategory,
  PlotDocument,
  PlotEdge,
  PlotFrame,
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
}

export class InspectorPanel {
  public readonly element: HTMLElement;

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element = document.createElement('aside');
    this.element.className = 'nplot-inspector';
  }

  public render(
    doc: PlotDocument,
    visible: boolean,
    selectedNodeId: string | null,
    selectedEdgeId: string | null,
    selectedFrameId: string | null
  ): void {
    this.element.classList.toggle('is-collapsed', !visible);
    if (!visible) {
      return;
    }
    this.element.innerHTML = '';

    if (selectedNodeId) {
      const node = doc.nodes.find((n) => n.id === selectedNodeId);
      if (node) {
        this.renderNodeInspector(doc, node);
        return;
      }
    }

    if (selectedEdgeId) {
      const edge = doc.edges.find((e) => e.id === selectedEdgeId);
      if (edge) {
        this.renderEdgeInspector(doc, edge);
        return;
      }
    }

    if (selectedFrameId) {
      const frame = doc.frames.find((f) => f.id === selectedFrameId);
      if (frame) {
        this.renderFrameInspector(doc, frame);
        return;
      }
    }

    this.renderPlotOverviewInspector(doc);
  }

  private createPanelTopBar(titleText: string, extraButton?: HTMLElement): HTMLElement {
    const header = document.createElement('div');
    header.className = 'nplot-field-row';
    header.style.justifyContent = 'space-between';

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

    const guide = document.createElement('div');
    guide.className = 'nplot-field';
    guide.innerHTML = `
      <div class="nplot-section-title">ショートカット・操作</div>
      <div class="nplot-chip">背景ダブルクリック：新規メモ付箋</div>
      <div class="nplot-chip">右端子(▶●◆■)→左端子ドラッグ：接続</div>
      <div class="nplot-chip">Delete / Backspace：選択要素を削除</div>
    `;
    this.element.appendChild(guide);
  }

  private renderNodeInspector(doc: PlotDocument, node: PlotNode): void {
    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => {
      const next = removeNode(doc, node.id);
      this.callbacks.onClearSelection();
      this.callbacks.onDocumentMutated(next);
    });

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
      const next = promoteNodeCategory(doc, node.id, catSelect.value as NodeCategory);
      this.callbacks.onDocumentMutated(next);
    });
    catField.appendChild(catLabel);
    catField.appendChild(catSelect);
    this.element.appendChild(catField);

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

    // Category specific parameters
    if (node.category === 'scene') {
      this.renderSceneParams(doc, node);
    } else if (node.category === 'character') {
      this.renderCharacterParams(doc, node);
    } else if (node.category === 'foreshadow') {
      this.renderForeshadowParams(doc, node);
    } else if (node.category === 'world_item') {
      this.renderWorldItemParams(doc, node);
    }

    // Custom Key-Value Parameters
    this.renderCustomParametersSection(doc, node);

    // Custom Socket Manager
    this.renderSocketManagerSection(doc, node);
  }

  private renderSceneParams(doc: PlotDocument, node: PlotNode): void {
    const sp = node.sceneParams ?? {
      chapter: '第1章',
      timepoint: '',
      pov: '',
      tension: 0,
      status: 'idea',
      manuscriptPath: '',
    };

    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = 'シーン専用パラメータ';
    this.element.appendChild(title);

    this.element.appendChild(
      this.createTextField('章・幕 (Chapter)', sp.chapter, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          sceneParams: { ...sp, chapter: val },
        }));
      })
    );

    this.element.appendChild(
      this.createTextField('作中時系列 (Timepoint)', sp.timepoint, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          sceneParams: { ...sp, timepoint: val },
        }));
      })
    );

    this.element.appendChild(
      this.createTextField('視点人物 (POV)', sp.pov, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          sceneParams: { ...sp, pov: val },
        }));
      })
    );

    // Tension slider (-5 to +5)
    const tensionField = document.createElement('div');
    tensionField.className = 'nplot-field';
    const tensionLabel = document.createElement('label');
    tensionLabel.textContent = `感情・テンション値: ${sp.tension > 0 ? `+${sp.tension}` : sp.tension}`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-5';
    slider.max = '5';
    slider.step = '1';
    slider.value = String(sp.tension);
    slider.addEventListener('change', () => {
      const val = Number.parseInt(slider.value, 10);
      this.updateNode(doc, node.id, (n) => ({
        ...n,
        sceneParams: { ...sp, tension: val },
      }));
    });
    tensionField.appendChild(tensionLabel);
    tensionField.appendChild(slider);
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
    statusField.appendChild(statusLabel);
    statusField.appendChild(statusSelect);
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
    openMsBtn.addEventListener('click', () => {
      this.callbacks.onOpenManuscript(node, true);
    });
    this.element.appendChild(openMsBtn);
  }

  private renderCharacterParams(doc: PlotDocument, node: PlotNode): void {
    const cp = node.characterParams ?? { role: '', goal: '', flaw: '' };
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = 'キャラクター属性';
    this.element.appendChild(title);

    this.element.appendChild(
      this.createTextField('役割・立ち位置', cp.role, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          characterParams: { ...cp, role: val },
        }));
      })
    );
    this.element.appendChild(
      this.createTextField('目的・動機 (Goal)', cp.goal, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          characterParams: { ...cp, goal: val },
        }));
      })
    );
    this.element.appendChild(
      this.createTextField('秘密・弱点・葛藤 (Flaw)', cp.flaw, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          characterParams: { ...cp, flaw: val },
        }));
      })
    );
  }

  private renderForeshadowParams(doc: PlotDocument, node: PlotNode): void {
    const fp = node.foreshadowParams ?? { hintDetail: '', payoffIdea: '' };
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = '伏線・謎の設計';
    this.element.appendChild(title);

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
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = 'アイテム・世界観ルール';
    this.element.appendChild(title);

    this.element.appendChild(
      this.createTextField('種別 (アイテム/設定/条件)', ip.itemType, (val) => {
        this.updateNode(doc, node.id, (n) => ({
          ...n,
          itemParams: { ...ip, itemType: val },
        }));
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
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = 'カスタムパラメータ (Key: Value)';
    wrapper.appendChild(title);

    node.customParams.forEach((param, idx) => {
      const row = document.createElement('div');
      row.className = 'nplot-field-row';

      const kInput = document.createElement('input');
      kInput.className = 'nplot-input';
      kInput.style.width = '40%';
      kInput.value = param.key;
      kInput.placeholder = '項目名';

      const vInput = document.createElement('input');
      vInput.className = 'nplot-input';
      vInput.style.width = '45%';
      vInput.value = param.value;
      vInput.placeholder = '値';

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
      rmBtn.addEventListener('click', () => {
        const nextParams = node.customParams.filter((_, i) => i !== idx);
        this.updateNode(doc, node.id, (n) => ({ ...n, customParams: nextParams }));
      });

      row.appendChild(kInput);
      row.appendChild(vInput);
      row.appendChild(rmBtn);
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
    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = '入出力ソケット端子追加';
    wrapper.appendChild(title);

    const row = document.createElement('div');
    row.className = 'nplot-field-row';

    const dirSelect = document.createElement('select');
    dirSelect.className = 'nplot-select';
    dirSelect.innerHTML = `<option value="in">入力(左)</option><option value="out">出力(右)</option>`;

    const typeSelect = document.createElement('select');
    typeSelect.className = 'nplot-select';
    const types: SocketDataType[] = ['flow', 'character', 'foreshadow', 'item'];
    for (const t of types) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = `${SOCKET_TYPE_META[t].symbol} ${SOCKET_TYPE_META[t].label}`;
      typeSelect.appendChild(opt);
    }

    row.appendChild(dirSelect);
    row.appendChild(typeSelect);
    wrapper.appendChild(row);

    const labelRow = document.createElement('div');
    labelRow.className = 'nplot-field-row';
    const sockLabelInput = document.createElement('input');
    sockLabelInput.className = 'nplot-input';
    sockLabelInput.style.flex = '1';
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

    labelRow.appendChild(sockLabelInput);
    labelRow.appendChild(addSockBtn);
    wrapper.appendChild(labelRow);
    this.element.appendChild(wrapper);
  }

  private renderEdgeInspector(doc: PlotDocument, edge: PlotEdge): void {
    this.element.appendChild(
      this.createPanelTopBar(`ワイヤー編集 (${SOCKET_TYPE_META[edge.dataType].label})`)
    );

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
    styleSelect.innerHTML = `
      <option value="solid" ${edge.lineStyle === 'solid' ? 'selected' : ''}>実線（確定ルート・確定関係）</option>
      <option value="dashed" ${edge.lineStyle === 'dashed' ? 'selected' : ''}>破線（IF分岐案・仮接続）</option>
    `;
    styleSelect.addEventListener('change', () => {
      const nextEdges = doc.edges.map((e) =>
        e.id === edge.id ? { ...e, lineStyle: styleSelect.value as EdgeLineStyle } : e
      );
      this.callbacks.onDocumentMutated({ ...doc, edges: nextEdges });
    });
    styleField.appendChild(styleLabel);
    styleField.appendChild(styleSelect);
    this.element.appendChild(styleField);

    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn';
    delBtn.textContent = 'この接続線を切断（削除）';
    delBtn.addEventListener('click', () => {
      const next = removeEdge(doc, edge.id);
      this.callbacks.onClearSelection();
      this.callbacks.onDocumentMutated(next);
    });
    this.element.appendChild(delBtn);
  }

  private renderFrameInspector(doc: PlotDocument, frame: PlotFrame): void {
    this.element.appendChild(this.createPanelTopBar('フレーム編集'));

    this.element.appendChild(
      this.createTextField('フレーム見出し', frame.title, (val) => {
        const nextFrames = doc.frames.map((f) => (f.id === frame.id ? { ...f, title: val } : f));
        this.callbacks.onDocumentMutated({ ...doc, frames: nextFrames });
      })
    );

    this.element.appendChild(
      this.createTextField('幅 (px)', String(frame.width), (val) => {
        const w = Math.max(180, Number.parseInt(val, 10) || frame.width);
        const nextFrames = doc.frames.map((f) => (f.id === frame.id ? { ...f, width: w } : f));
        this.callbacks.onDocumentMutated({ ...doc, frames: nextFrames });
      })
    );

    this.element.appendChild(
      this.createTextField('高さ (px)', String(frame.height), (val) => {
        const h = Math.max(140, Number.parseInt(val, 10) || frame.height);
        const nextFrames = doc.frames.map((f) => (f.id === frame.id ? { ...f, height: h } : f));
        this.callbacks.onDocumentMutated({ ...doc, frames: nextFrames });
      })
    );

    const delBtn = document.createElement('button');
    delBtn.className = 'nplot-btn';
    delBtn.textContent = 'フレーム枠を削除（中のノードは残す）';
    delBtn.addEventListener('click', () => {
      const nextFrames = doc.frames.filter((f) => f.id !== frame.id);
      this.callbacks.onClearSelection();
      this.callbacks.onDocumentMutated({ ...doc, frames: nextFrames });
    });
    this.element.appendChild(delBtn);
  }

  private updateNode(
    doc: PlotDocument,
    nodeId: string,
    updater: (n: PlotNode) => PlotNode
  ): void {
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
    input.addEventListener('change', () => onChange(input.value));
    field.appendChild(lbl);
    field.appendChild(input);
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
    textarea.addEventListener('change', () => onChange(textarea.value));
    field.appendChild(lbl);
    field.appendChild(textarea);
    return field;
  }
}
