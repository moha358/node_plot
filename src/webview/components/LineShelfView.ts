import {
  addLineCandidate,
  addLines,
  computeLineStats,
  createLine,
  detachLineFromScene,
  getLineStatus,
  getLines,
  getOrderedScenes,
  groupLinesBySpeaker,
  moveLine,
  parseLineCaptureText,
  placeLine,
  removeLine,
  speakerDisplayName,
  summarizeSceneLines,
  unplaceLine,
  updateLine,
} from '../../core/lineShelf';
import { LineStatus, PlotDocument, PlotLine, PlotNode } from '../../core/types';

export interface LineShelfCallbacks {
  onDocumentMutated: (next: PlotDocument) => void;
  onFocusNode: (nodeId: string) => void;
  onNotify: (message: string, kind?: 'info' | 'warning') => void;
}

export type LineStatusFilter = 'all' | LineStatus;

const LINE_DRAG_MIME = 'application/x-nplot-line';
const UNASSIGNED_SPEAKER = '';

const STATUS_LABELS: Record<LineStatus, string> = {
  unplaced: '未配置',
  candidate: '候補あり',
  placed: '確定',
};

const FILTERS: { value: LineStatusFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'unplaced', label: '未配置' },
  { value: 'candidate', label: '候補あり' },
  { value: 'placed', label: '確定' },
];

/**
 * セリフ棚ビュー：プロット確定後に「各キャラが言いそうなセリフ」を書き溜め、あとからシーンへ配置する。
 *
 * - 上部の入力欄は常設（再描画で消えない）。Enter で追加、Shift+Enter で改行、
 *   複数行や `@名前 本文` / `名前「本文」` 形式の貼り付けはまとめて取り込む。
 * - 左：話者ごとの列。カードを別の列へドラッグすると話者を変更。
 * - 右：時系列順のシーン一覧。カードをドロップで候補に追加（Shift を押しながらで確定）。
 *   シーンをクリックするとそのシーンに紐づくセリフだけに絞り込む。
 */
export class LineShelfView {
  public readonly element: HTMLElement;
  private readonly speakerSelect: HTMLSelectElement;
  private readonly captureInput: HTMLTextAreaElement;
  private readonly filterBar: HTMLElement;
  private readonly board: HTMLElement;
  private readonly sceneLane: HTMLElement;

  private doc: PlotDocument | null = null;
  private statusFilter: LineStatusFilter = 'all';
  private focusSceneId: string | null = null;
  private highlightLineIds = new Set<string>();
  private selectedSpeakerId = UNASSIGNED_SPEAKER;
  private draggingLineId: string | null = null;

  constructor(private readonly callbacks: LineShelfCallbacks) {
    this.element = document.createElement('section');
    this.element.className = 'nplot-lines-view is-hidden';

    const main = document.createElement('div');
    main.className = 'nplot-lines-main';

    // --- Capture bar (persistent) ---
    const capture = document.createElement('div');
    capture.className = 'nplot-lines-capture';

    this.speakerSelect = document.createElement('select');
    this.speakerSelect.className = 'nplot-select nplot-lines-speaker';
    this.speakerSelect.title = '話者（本文で @名前 を指定した場合はそちらが優先）';
    this.speakerSelect.addEventListener('change', () => {
      this.selectedSpeakerId = this.speakerSelect.value;
    });

    this.captureInput = document.createElement('textarea');
    this.captureInput.className = 'nplot-input nplot-lines-capture-input';
    this.captureInput.rows = 1;
    this.captureInput.placeholder =
      'セリフを書き留める…（Enter で追加・Shift+Enter でセリフ内の改行／空行や「@名前」「名前「」「「」で始まる行は別のセリフとして取り込み）';
    this.captureInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submitCapture();
      }
    });
    this.captureInput.addEventListener('input', () => this.autosizeCapture());

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'nplot-btn is-primary';
    addBtn.textContent = '＋ 書き留める';
    addBtn.addEventListener('click', () => this.submitCapture());

    capture.append(this.speakerSelect, this.captureInput, addBtn);

    this.filterBar = document.createElement('div');
    this.filterBar.className = 'nplot-lines-filterbar';

    this.board = document.createElement('div');
    this.board.className = 'nplot-lines-board';

    main.append(capture, this.filterBar, this.board);

    this.sceneLane = document.createElement('aside');
    this.sceneLane.className = 'nplot-lines-scenes';

    this.element.append(main, this.sceneLane);
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  /** 指定シーンで絞り込んだ状態にする（キャンバスのシーンカード・インスペクタから開くとき）。 */
  public focusScene(sceneId: string | null): void {
    this.focusSceneId = sceneId;
    if (sceneId) {
      this.statusFilter = 'all';
    }
  }

  /** 入力欄の話者を指定する（インスペクタの「このキャラのセリフを書く」から）。 */
  public presetSpeaker(speakerId: string): void {
    this.selectedSpeakerId = speakerId;
  }

  public focusCaptureInput(): void {
    window.setTimeout(() => this.captureInput.focus(), 0);
  }

  public render(doc: PlotDocument): void {
    this.doc = doc;
    const sceneIds = new Set(doc.nodes.filter((n) => n.category === 'scene').map((n) => n.id));
    if (this.focusSceneId && !sceneIds.has(this.focusSceneId)) {
      this.focusSceneId = null;
    }
    this.renderSpeakerOptions(doc);
    this.renderFilterBar(doc);
    this.renderBoard(doc, sceneIds);
    this.renderSceneLane(doc);
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  private renderSpeakerOptions(doc: PlotDocument): void {
    const characters = doc.nodes.filter((n) => n.category === 'character');
    if (
      this.selectedSpeakerId !== UNASSIGNED_SPEAKER &&
      !characters.some((c) => c.id === this.selectedSpeakerId)
    ) {
      this.selectedSpeakerId = UNASSIGNED_SPEAKER;
    }
    this.speakerSelect.replaceChildren();
    const none = document.createElement('option');
    none.value = UNASSIGNED_SPEAKER;
    none.textContent = '話者未定';
    this.speakerSelect.appendChild(none);
    for (const c of characters) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = speakerDisplayName(c);
      this.speakerSelect.appendChild(opt);
    }
    this.speakerSelect.value = this.selectedSpeakerId;
  }

  private autosizeCapture(): void {
    this.captureInput.style.height = 'auto';
    this.captureInput.style.height = `${Math.min(this.captureInput.scrollHeight, 160)}px`;
  }

  private submitCapture(): void {
    if (!this.doc) {
      return;
    }
    const raw = this.captureInput.value;
    if (!raw.trim()) {
      return;
    }
    const characters = this.doc.nodes.filter((n) => n.category === 'character');
    const parsed = parseLineCaptureText(raw, characters, this.selectedSpeakerId);
    if (parsed.length === 0) {
      return;
    }
    const lines = parsed.map((p) => {
      const line = createLine({ speakerId: p.speakerId, text: p.text, note: p.note });
      if (this.focusSceneId) {
        line.candidateSceneIds = [this.focusSceneId];
      }
      return line;
    });
    // 最後に使われた話者を次の入力の既定にする（会話を続けて書けるように）
    this.selectedSpeakerId = parsed[parsed.length - 1].speakerId;
    this.highlightLineIds = new Set(lines.map((l) => l.id));
    this.captureInput.value = '';
    this.autosizeCapture();
    this.callbacks.onDocumentMutated(addLines(this.doc, lines));

    const unknown = [...new Set(parsed.map((p) => p.unknownSpeakerName).filter(Boolean))];
    if (unknown.length > 0) {
      this.callbacks.onNotify(
        `未登録の話者（${unknown.join('、')}）のセリフは「話者未定」に入れました。キャラクターノードを追加すると割り当てられます。`,
        'warning'
      );
    } else if (lines.length > 1) {
      this.callbacks.onNotify(`${lines.length} 件のセリフを書き留めました`);
    }
    this.captureInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Filter bar
  // ---------------------------------------------------------------------------

  private renderFilterBar(doc: PlotDocument): void {
    this.filterBar.replaceChildren();
    const stats = computeLineStats(doc);
    const counts: Record<LineStatusFilter, number> = {
      all: stats.total,
      unplaced: stats.unplaced,
      candidate: stats.candidate,
      placed: stats.placed,
    };
    const group = document.createElement('div');
    group.className = 'nplot-view-switch';
    for (const f of FILTERS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nplot-view-switch-btn';
      btn.classList.toggle('is-active', this.statusFilter === f.value);
      btn.textContent = `${f.label} ${counts[f.value]}`;
      btn.addEventListener('click', () => {
        this.statusFilter = f.value;
        this.render(doc);
      });
      group.appendChild(btn);
    }
    this.filterBar.appendChild(group);

    if (this.focusSceneId) {
      const scene = doc.nodes.find((n) => n.id === this.focusSceneId);
      const chip = document.createElement('span');
      chip.className = 'nplot-lines-focus-chip';
      chip.textContent = `シーン「${scene?.title ?? ''}」のセリフのみ表示中`;
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'nplot-lines-icon-btn';
      clear.textContent = '×';
      clear.title = '絞り込みを解除';
      clear.addEventListener('click', () => {
        this.focusSceneId = null;
        this.render(doc);
      });
      chip.appendChild(clear);
      this.filterBar.appendChild(chip);
    }

    const help = document.createElement('span');
    help.className = 'nplot-lines-help';
    help.textContent = 'カードを別のカードの上下へドラッグで並べ替え・右のシーンへドラッグで候補に（Shift+ドロップで確定）・別の列へドラッグで話者変更・シーンをクリックで会話順表示・本文ダブルクリックで編集';
    this.filterBar.appendChild(help);
  }

  // ---------------------------------------------------------------------------
  // Board (speaker columns)
  // ---------------------------------------------------------------------------

  private lineVisible(line: PlotLine, sceneIds: ReadonlySet<string>): boolean {
    if (this.focusSceneId) {
      if (line.placedSceneId !== this.focusSceneId && !line.candidateSceneIds.includes(this.focusSceneId)) {
        return false;
      }
    }
    return this.statusFilter === 'all' || getLineStatus(line, sceneIds) === this.statusFilter;
  }

  private renderBoard(doc: PlotDocument, sceneIds: ReadonlySet<string>): void {
    const scrollLeft = this.board.scrollLeft;
    const columnScroll = new Map<string, number>();
    this.board.querySelectorAll<HTMLElement>('.nplot-lines-column').forEach((col) => {
      const list = col.querySelector<HTMLElement>('.nplot-lines-list');
      if (list) {
        columnScroll.set(col.dataset.speakerId ?? '', list.scrollTop);
      }
    });
    this.board.replaceChildren();

    if (getLines(doc).length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nplot-matrix-empty';
      empty.textContent =
        'まだセリフがありません。上の入力欄に、キャラクターが言いそうなセリフを思いつくまま書き留めてください。どこにハマるかは後で決められます。';
      this.board.appendChild(empty);
    }

    const sceneTitles = new Map(
      doc.nodes.filter((n) => n.category === 'scene').map((n) => [n.id, n.title])
    );

    if (this.focusSceneId) {
      this.renderConversationColumn(doc, sceneIds, sceneTitles);
      this.board.scrollLeft = scrollLeft;
      this.highlightLineIds.clear();
      return;
    }

    for (const column of groupLinesBySpeaker(doc)) {
      const speakerId = column.speaker?.id ?? UNASSIGNED_SPEAKER;
      const visible = column.lines.filter((l) => this.lineVisible(l, sceneIds));
      // 話者未定列は空なら出さない（キャラクターの列は書き溜め先として常に出す）
      if (!column.speaker && column.lines.length === 0) {
        continue;
      }

      const col = document.createElement('div');
      col.className = 'nplot-lines-column';
      col.dataset.speakerId = speakerId;
      if (!column.speaker) {
        col.classList.add('is-unassigned');
      }

      const head = document.createElement('div');
      head.className = 'nplot-lines-column-head';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'nplot-lines-column-name';
      name.textContent = speakerDisplayName(column.speaker);
      if (column.speaker) {
        const speaker = column.speaker;
        name.title = `${speaker.title}\nクリックで入力欄の話者に設定`;
        name.addEventListener('click', () => {
          this.selectedSpeakerId = speaker.id;
          this.speakerSelect.value = speaker.id;
          this.captureInput.focus();
        });
      } else {
        name.title = '話者の決まっていないセリフ';
        name.disabled = true;
      }
      const count = document.createElement('span');
      count.className = 'nplot-lines-column-count';
      count.textContent =
        visible.length === column.lines.length
          ? String(column.lines.length)
          : `${visible.length} / ${column.lines.length}`;
      head.append(name, count);

      const list = document.createElement('div');
      list.className = 'nplot-lines-list';
      for (const line of visible) {
        list.appendChild(this.createLineCard(doc, line, sceneIds, sceneTitles, { columnSpeakerId: speakerId }));
      }

      this.attachDropTarget(col, (lineId) => {
        const line = getLines(doc).find((l) => l.id === lineId);
        if (line && line.speakerId !== speakerId) {
          this.callbacks.onDocumentMutated(updateLine(doc, lineId, { speakerId }));
        }
      });

      col.append(head, list);
      this.board.appendChild(col);
      const prevScroll = columnScroll.get(speakerId);
      if (prevScroll) {
        list.scrollTop = prevScroll;
      }
    }

    this.board.scrollLeft = scrollLeft;
    // 新規追加カードを一度だけ強調し、見える位置へ
    const firstNew = this.board.querySelector<HTMLElement>('.nplot-line-card.is-new');
    firstNew?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.highlightLineIds.clear();
  }

  /**
   * シーン絞り込み時の「会話順」表示：話者混在の 1 列に配列順で並べ、ドラッグで順番を入れ替える。
   */
  private renderConversationColumn(
    doc: PlotDocument,
    sceneIds: ReadonlySet<string>,
    sceneTitles: Map<string, string>
  ): void {
    const scene = doc.nodes.find((n) => n.id === this.focusSceneId);
    const speakers = new Map(doc.nodes.filter((n) => n.category === 'character').map((n) => [n.id, n]));
    const all = getLines(doc).filter(
      (l) => l.placedSceneId === this.focusSceneId || l.candidateSceneIds.includes(this.focusSceneId!)
    );
    const visible = all.filter((l) => this.lineVisible(l, sceneIds));

    const col = document.createElement('div');
    col.className = 'nplot-lines-column is-conversation';
    const head = document.createElement('div');
    head.className = 'nplot-lines-column-head';
    const name = document.createElement('span');
    name.className = 'nplot-lines-column-name';
    name.textContent = `会話順：${scene?.title ?? ''}`;
    const count = document.createElement('span');
    count.className = 'nplot-lines-column-count';
    count.textContent = visible.length === all.length ? String(all.length) : `${visible.length} / ${all.length}`;
    head.append(name, count);

    const list = document.createElement('div');
    list.className = 'nplot-lines-list';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nplot-help';
      empty.textContent =
        'このシーンのセリフはまだありません。上の入力欄で書き留めるとこのシーンの候補になります。絞り込みを解除すると、話者ごとの列からドラッグで追加できます。';
      list.appendChild(empty);
    }
    for (const line of visible) {
      list.appendChild(
        this.createLineCard(doc, line, sceneIds, sceneTitles, {
          speakerLabel: speakerDisplayName(speakers.get(line.speakerId)),
        })
      );
    }
    col.append(head, list);
    this.board.appendChild(col);
    const firstNew = list.querySelector<HTMLElement>('.nplot-line-card.is-new');
    firstNew?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private createLineCard(
    doc: PlotDocument,
    line: PlotLine,
    sceneIds: ReadonlySet<string>,
    sceneTitles: Map<string, string>,
    opts: { columnSpeakerId?: string; speakerLabel?: string } = {}
  ): HTMLElement {
    const status = getLineStatus(line, sceneIds);
    const card = document.createElement('div');
    card.className = `nplot-line-card is-${status}`;
    if (this.highlightLineIds.has(line.id)) {
      card.classList.add('is-new');
    }
    card.dataset.lineId = line.id;
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      this.draggingLineId = line.id;
      e.dataTransfer?.setData(LINE_DRAG_MIME, line.id);
      e.dataTransfer?.setData('text/plain', line.text);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'copyMove';
      }
      card.classList.add('is-dragging');
      this.element.classList.add('is-line-dragging');
    });
    card.addEventListener('dragend', () => {
      this.draggingLineId = null;
      card.classList.remove('is-dragging');
      this.element.classList.remove('is-line-dragging');
    });
    this.attachReorderTarget(doc, card, line.id, opts.columnSpeakerId);

    if (opts.speakerLabel !== undefined) {
      const who = document.createElement('div');
      who.className = 'nplot-line-speaker';
      who.textContent = opts.speakerLabel;
      card.appendChild(who);
    }

    const text = document.createElement('div');
    text.className = 'nplot-line-text';
    text.textContent = `「${line.text}」`;
    text.title = 'ダブルクリックで編集';
    text.addEventListener('dblclick', () => {
      this.startEdit(text, line.text, true, (val) => {
        const trimmed = val.trim();
        if (trimmed && trimmed !== line.text) {
          this.callbacks.onDocumentMutated(updateLine(doc, line.id, { text: trimmed }));
        }
      });
    });
    card.appendChild(text);

    const note = document.createElement('div');
    note.className = 'nplot-line-note';
    note.textContent = line.note || '＋ メモ（言い方・状況）';
    note.classList.toggle('is-empty', !line.note);
    note.title = 'ダブルクリックでメモを編集';
    note.addEventListener('dblclick', () => {
      this.startEdit(note, line.note, false, (val) => {
        if (val.trim() !== line.note) {
          this.callbacks.onDocumentMutated(updateLine(doc, line.id, { note: val.trim() }));
        }
      });
    });
    card.appendChild(note);

    // Scene chips
    const chips = document.createElement('div');
    chips.className = 'nplot-line-scenes';
    if (line.placedSceneId && sceneIds.has(line.placedSceneId)) {
      const sceneId = line.placedSceneId;
      chips.appendChild(
        this.createSceneChip(sceneTitles.get(sceneId) ?? '', true, {
          onMain: () => this.callbacks.onFocusNode(sceneId),
          mainTitle: 'クリックでキャンバスのシーンへ移動',
          onRemove: () => this.callbacks.onDocumentMutated(unplaceLine(doc, line.id)),
          removeTitle: '確定を取り消して候補に戻す',
        })
      );
    }
    for (const sceneId of line.candidateSceneIds) {
      if (!sceneIds.has(sceneId)) {
        continue;
      }
      chips.appendChild(
        this.createSceneChip(sceneTitles.get(sceneId) ?? '', false, {
          onMain: () => this.callbacks.onDocumentMutated(placeLine(doc, line.id, sceneId)),
          mainTitle: 'クリックでこのシーンに確定',
          onRemove: () => this.callbacks.onDocumentMutated(detachLineFromScene(doc, line.id, sceneId)),
          removeTitle: '候補から外す',
        })
      );
    }
    card.appendChild(chips);

    // Footer: status + add-scene select + delete
    const foot = document.createElement('div');
    foot.className = 'nplot-line-foot';
    const pill = document.createElement('span');
    pill.className = `nplot-line-status is-${status}`;
    pill.textContent = STATUS_LABELS[status];
    foot.appendChild(pill);

    const scenes = getOrderedScenes(doc).filter(
      (s) => s.id !== line.placedSceneId && !line.candidateSceneIds.includes(s.id)
    );
    if (scenes.length > 0) {
      const addSel = document.createElement('select');
      addSel.className = 'nplot-select nplot-line-add-scene';
      addSel.title = 'はまりそうなシーンを候補に追加（ドラッグでも可）';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '＋候補シーン';
      addSel.appendChild(ph);
      for (const s of scenes) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = sceneOptionLabel(s);
        addSel.appendChild(opt);
      }
      addSel.addEventListener('change', () => {
        if (addSel.value) {
          this.callbacks.onDocumentMutated(addLineCandidate(doc, line.id, addSel.value));
        }
      });
      foot.appendChild(addSel);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'nplot-lines-icon-btn nplot-line-delete';
    del.textContent = '🗑';
    del.title = 'このセリフを削除（⌘Z / Ctrl+Z で元に戻せます）';
    del.addEventListener('click', () => {
      this.callbacks.onDocumentMutated(removeLine(doc, line.id));
      this.callbacks.onNotify('セリフを削除しました（⌘Z / Ctrl+Z で元に戻せます）');
    });
    foot.appendChild(del);
    card.appendChild(foot);

    return card;
  }

  private createSceneChip(
    title: string,
    placed: boolean,
    opts: { onMain: () => void; mainTitle: string; onRemove: () => void; removeTitle: string }
  ): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `nplot-line-scene-chip ${placed ? 'is-placed' : 'is-candidate'}`;
    const main = document.createElement('button');
    main.type = 'button';
    main.textContent = `${placed ? '★' : '☆'} ${title}`;
    main.title = opts.mainTitle;
    main.addEventListener('click', opts.onMain);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'nplot-line-scene-chip-remove';
    rm.textContent = '×';
    rm.title = opts.removeTitle;
    rm.addEventListener('click', opts.onRemove);
    chip.append(main, rm);
    return chip;
  }

  /** カード内のインライン編集。Enter（本文は ⌘/Ctrl+Enter でも）で確定、Esc で取り消し。 */
  private startEdit(
    target: HTMLElement,
    initial: string,
    multiline: boolean,
    onCommit: (value: string) => void
  ): void {
    const input = document.createElement('textarea');
    input.className = 'nplot-input nplot-line-edit';
    input.value = initial;
    input.rows = multiline ? 3 : 1;
    let done = false;
    const finish = (commit: boolean) => {
      if (done) {
        return;
      }
      done = true;
      if (commit) {
        onCommit(input.value);
      }
      if (input.isConnected) {
        input.replaceWith(target);
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => finish(true));
    target.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------------------
  // Scene lane (drop targets)
  // ---------------------------------------------------------------------------

  private renderSceneLane(doc: PlotDocument): void {
    const scrollTop = this.sceneLane.scrollTop;
    this.sceneLane.replaceChildren();

    const title = document.createElement('div');
    title.className = 'nplot-section-title';
    title.textContent = 'シーン（時系列順）';
    this.sceneLane.appendChild(title);

    const scenes = getOrderedScenes(doc);
    if (scenes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nplot-help';
      empty.textContent = 'シーンノードがまだありません。セリフは先に書き溜めておき、シーンができたら配置できます。';
      this.sceneLane.appendChild(empty);
      return;
    }

    const summary = summarizeSceneLines(doc);
    let lastChapter: string | null = null;
    scenes.forEach((scene, idx) => {
      const chapter = scene.sceneParams?.chapter ?? '';
      if (chapter !== lastChapter) {
        lastChapter = chapter;
        const ch = document.createElement('div');
        ch.className = 'nplot-lines-scene-chapter';
        ch.textContent = chapter || '—';
        this.sceneLane.appendChild(ch);
      }
      const s = summary.get(scene.id);
      const placed = s?.placed.length ?? 0;
      const cand = s?.candidates.length ?? 0;

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'nplot-lines-scene';
      item.classList.toggle('is-focused', this.focusSceneId === scene.id);
      item.classList.toggle('is-empty', placed === 0);
      item.title = [
        `${idx + 1}. ${scene.title}`,
        scene.sceneParams?.pov ? `視点: ${scene.sceneParams.pov}` : '',
        `確定 ${placed} / 候補 ${cand}`,
        'クリックでこのシーンのセリフに絞り込み（もう一度で解除）',
        'セリフをドロップで候補に追加、Shift+ドロップで確定',
      ]
        .filter(Boolean)
        .join('\n');

      const num = document.createElement('span');
      num.className = 'nplot-matrix-scene-num';
      num.textContent = String(idx + 1);
      const label = document.createElement('span');
      label.className = 'nplot-lines-scene-title';
      label.textContent = scene.title;
      const counts = document.createElement('span');
      counts.className = 'nplot-lines-scene-counts';
      counts.textContent = `★${placed} ☆${cand}`;
      item.append(num, label, counts);

      item.addEventListener('click', () => {
        this.focusSceneId = this.focusSceneId === scene.id ? null : scene.id;
        this.render(doc);
      });
      item.addEventListener('dblclick', () => this.callbacks.onFocusNode(scene.id));

      this.attachDropTarget(item, (lineId, e) => {
        const next = e.shiftKey ? placeLine(doc, lineId, scene.id) : addLineCandidate(doc, lineId, scene.id);
        if (next !== doc) {
          this.callbacks.onDocumentMutated(next);
          if (e.shiftKey) {
            this.callbacks.onNotify(`「${scene.title}」に確定しました`);
          }
        }
      });

      this.sceneLane.appendChild(item);
    });
    this.sceneLane.scrollTop = scrollTop;
  }

  /**
   * カードの上へのドロップで並べ替える。上半分なら前、下半分なら後ろへ入れる。
   * 話者列のカードへ落とした場合は、話者もその列のキャラクターに変える。
   */
  private attachReorderTarget(
    doc: PlotDocument,
    card: HTMLElement,
    targetLineId: string,
    columnSpeakerId: string | undefined
  ): void {
    const positionOf = (e: DragEvent): 'before' | 'after' => {
      const rect = card.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    };
    const clear = () => card.classList.remove('is-drop-before', 'is-drop-after');
    card.addEventListener('dragover', (e) => {
      if (!this.draggingLineId || this.draggingLineId === targetLineId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      const pos = positionOf(e);
      card.classList.toggle('is-drop-before', pos === 'before');
      card.classList.toggle('is-drop-after', pos === 'after');
    });
    card.addEventListener('dragleave', (e) => {
      if (!(e.relatedTarget instanceof Node) || !card.contains(e.relatedTarget)) {
        clear();
      }
    });
    card.addEventListener('drop', (e) => {
      clear();
      const lineId = e.dataTransfer?.getData(LINE_DRAG_MIME) || this.draggingLineId;
      if (!lineId || lineId === targetLineId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.draggingLineId = null;
      let next = doc;
      const moving = getLines(doc).find((l) => l.id === lineId);
      if (columnSpeakerId !== undefined && moving && moving.speakerId !== columnSpeakerId) {
        next = updateLine(next, lineId, { speakerId: columnSpeakerId });
      }
      next = moveLine(next, lineId, targetLineId, positionOf(e));
      if (next !== doc) {
        this.callbacks.onDocumentMutated(next);
      }
    });
  }

  private attachDropTarget(el: HTMLElement, onDrop: (lineId: string, e: DragEvent) => void): void {
    el.addEventListener('dragover', (e) => {
      if (!this.draggingLineId && !e.dataTransfer?.types.includes(LINE_DRAG_MIME)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy';
      }
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', (e) => {
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) {
        el.classList.remove('is-drop-target');
      }
    });
    el.addEventListener('drop', (e) => {
      el.classList.remove('is-drop-target');
      const lineId = e.dataTransfer?.getData(LINE_DRAG_MIME) || this.draggingLineId;
      if (!lineId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.draggingLineId = null;
      onDrop(lineId, e);
    });
  }
}

function sceneOptionLabel(scene: PlotNode): string {
  const ch = scene.sceneParams?.chapter;
  return ch ? `${ch}｜${scene.title}` : scene.title;
}
