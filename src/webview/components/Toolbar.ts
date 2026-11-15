import { summarizePlotStats } from '../../core/plotAnalyzer';
import { CERTAINTY_META, CERTAINTY_ORDER, NODE_CATEGORY_META } from '../../core/theme';
import {
  EditorViewMode,
  NodeCategory,
  PlotConfig,
  PlotDocument,
  PlotThemeMode,
} from '../../core/types';
import { CertaintyFilter } from './CanvasViewport';

export interface ToolbarCallbacks {
  onAddNode: (category: NodeCategory) => void;
  onAddFrame: () => void;
  onFilterChange: (query: string) => void;
  onSearchNext: (backwards: boolean) => void;
  onCertaintyFilterChange: (filter: CertaintyFilter) => void;
  onChangeViewMode: (mode: EditorViewMode) => void;
  onToggleOutlineDrawer: () => void;
  onToggleInspector: () => void;
  onToggleTraceMode: () => void;
  onThemeChange: (theme: PlotThemeMode) => void;
  onExportMarkdown: () => void;
  onSyncGenkou: () => void;
  onRestoreBackup: () => void;
}

export interface ToolbarState {
  filterQuery: string;
  certaintyFilter: CertaintyFilter;
  viewMode: EditorViewMode;
  showOutlineDrawer: boolean;
  showInspector: boolean;
  traceModeEnabled: boolean;
  hasSelection: boolean;
}

const COMPACT_NODE_LABELS: Record<NodeCategory, string> = {
  note: 'メモ',
  scene: 'シーン',
  character: '人物',
  foreshadow: '伏線',
  world_item: '設定',
};

const VIEW_MODES: { mode: EditorViewMode; label: string; title: string }[] = [
  { mode: 'node', label: 'ノード', title: 'ノードキャンバス表示' },
  {
    mode: 'matrix',
    label: '登場表',
    title: 'キャラクター × シーンの登場表（視点人物・不在区間の確認、クリックで登場を付け外し）',
  },
  {
    mode: 'lines',
    label: 'セリフ棚',
    title: 'キャラクターごとに書き溜めたセリフを一覧し、シーンへ配置（候補・確定）する',
  },
  { mode: 'json', label: '{ } JSON', title: 'JSONソース表示・編集' },
];

export class Toolbar {
  public readonly element: HTMLElement;

  constructor(private readonly callbacks: ToolbarCallbacks) {
    this.element = document.createElement('header');
    this.element.className = 'nplot-toolbar';
  }

  public render(doc: PlotDocument, config: PlotConfig, state: ToolbarState): void {
    const stats = summarizePlotStats(doc);
    const prevSearch = this.element.querySelector<HTMLInputElement>('.nplot-search');
    const searchHadFocus = prevSearch !== null && document.activeElement === prevSearch;
    const caret = prevSearch?.selectionStart ?? null;
    this.element.replaceChildren();

    // Left group: View mode switch + Compact quick-add buttons
    const leftGroup = document.createElement('div');
    leftGroup.className = 'nplot-toolbar-group';

    const viewSwitch = document.createElement('div');
    viewSwitch.className = 'nplot-view-switch';
    for (const vm of VIEW_MODES) {
      const btn = document.createElement('button');
      btn.className = 'nplot-view-switch-btn';
      if (state.viewMode === vm.mode) {
        btn.classList.add('is-active');
      }
      btn.textContent = vm.label;
      btn.title = vm.title;
      btn.addEventListener('click', () => this.callbacks.onChangeViewMode(vm.mode));
      viewSwitch.appendChild(btn);
    }
    leftGroup.appendChild(viewSwitch);

    const divider = document.createElement('span');
    divider.className = 'nplot-toolbar-divider';
    leftGroup.appendChild(divider);

    const categories: NodeCategory[] = ['note', 'scene', 'character', 'foreshadow', 'world_item'];
    for (const cat of categories) {
      const meta = NODE_CATEGORY_META[cat];
      const btn = document.createElement('button');
      btn.className = 'nplot-btn';
      btn.title = `${meta.label}ノードを画面中央に追加`;
      const dot = document.createElement('span');
      dot.textContent = '●';
      dot.style.color = meta.cssColorVar;
      btn.append(dot, document.createTextNode(`+${COMPACT_NODE_LABELS[cat]}`));
      btn.addEventListener('click', () => this.callbacks.onAddNode(cat));
      leftGroup.appendChild(btn);
    }

    const frameBtn = document.createElement('button');
    frameBtn.className = 'nplot-btn';
    frameBtn.textContent = state.hasSelection ? '▢ 選択を枠で囲む' : '+枠';
    frameBtn.title = state.hasSelection
      ? '選択中のノードを囲む枠を作成（例：キャラクターを組織で束ねる）'
      : '章・グループ枠を追加（枠の中に枠を置くと入れ子になります）';
    frameBtn.addEventListener('click', () => this.callbacks.onAddFrame());
    leftGroup.appendChild(frameBtn);

    // Center group: Search + filters + View/Analysis toggles
    const centerGroup = document.createElement('div');
    centerGroup.className = 'nplot-toolbar-group';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'nplot-input nplot-search';
    searchInput.placeholder = '検索（Enterで次へ）';
    searchInput.title = '題名・本文・タグ・章・視点・パラメータを検索。一致しないノードは薄く表示されます';
    searchInput.value = state.filterQuery;
    searchInput.addEventListener('input', () => this.callbacks.onFilterChange(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.callbacks.onSearchNext(e.shiftKey);
      } else if (e.key === 'Escape') {
        searchInput.value = '';
        this.callbacks.onFilterChange('');
        searchInput.blur();
      }
    });
    centerGroup.appendChild(searchInput);

    const certaintySelect = document.createElement('select');
    certaintySelect.className = 'nplot-select';
    certaintySelect.title = '確定度で絞り込み（一致しないノードは薄く表示）';
    const certaintyOptions: { value: CertaintyFilter; label: string }[] = [
      { value: 'all', label: '確定度: すべて' },
      ...CERTAINTY_ORDER.map((c) => ({ value: c as CertaintyFilter, label: CERTAINTY_META[c].label })),
      { value: 'none', label: '未設定のみ' },
    ];
    for (const o of certaintyOptions) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = state.certaintyFilter === o.value;
      certaintySelect.appendChild(opt);
    }
    certaintySelect.classList.toggle('is-active', state.certaintyFilter !== 'all');
    certaintySelect.addEventListener('change', () =>
      this.callbacks.onCertaintyFilterChange(certaintySelect.value as CertaintyFilter)
    );
    centerGroup.appendChild(certaintySelect);

    const traceBtn = document.createElement('button');
    traceBtn.className = 'nplot-btn';
    traceBtn.classList.toggle('is-active', state.traceModeEnabled);
    traceBtn.textContent = '関連強調';
    traceBtn.title = '選択ノードに繋がる人物・伏線・前後シーンのみを強調表示';
    traceBtn.addEventListener('click', () => this.callbacks.onToggleTraceMode());
    centerGroup.appendChild(traceBtn);

    const outlineBtn = document.createElement('button');
    outlineBtn.className = 'nplot-btn';
    outlineBtn.classList.toggle('is-active', state.showOutlineDrawer);
    const alertBadge =
      stats.unresolvedForeshadowCount > 0 ? ` ⚠${stats.unresolvedForeshadowCount}` : '';
    outlineBtn.textContent = `時系列・曲線${alertBadge}`;
    outlineBtn.title = '下部の時系列アウトライン・テンション曲線・未回収伏線パネルを開閉';
    outlineBtn.addEventListener('click', () => this.callbacks.onToggleOutlineDrawer());
    centerGroup.appendChild(outlineBtn);

    const inspectorBtn = document.createElement('button');
    inspectorBtn.className = 'nplot-btn';
    inspectorBtn.classList.toggle('is-active', state.showInspector);
    inspectorBtn.textContent = '詳細パネル';
    inspectorBtn.title = '右側のパラメータ編集インスペクタを開閉';
    inspectorBtn.addEventListener('click', () => this.callbacks.onToggleInspector());
    centerGroup.appendChild(inspectorBtn);

    // Right group: Theme, Genkou sync, Markdown export
    const rightGroup = document.createElement('div');
    rightGroup.className = 'nplot-toolbar-group';

    const themeSelect = document.createElement('select');
    themeSelect.className = 'nplot-select';
    themeSelect.title = 'キャンバステーマ切替';
    const themes: { value: PlotThemeMode; label: string }[] = [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'sepia', label: 'Sepia' },
    ];
    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      opt.selected = config.theme === t.value;
      themeSelect.appendChild(opt);
    }
    themeSelect.addEventListener('change', () => {
      this.callbacks.onThemeChange(themeSelect.value as PlotThemeMode);
    });
    rightGroup.appendChild(themeSelect);

    const syncBtn = document.createElement('button');
    syncBtn.className = 'nplot-btn';
    syncBtn.textContent = 'Genkou同期';
    syncBtn.title = '時系列シーン順を .genkou.json の原稿順序へ反映';
    syncBtn.addEventListener('click', () => this.callbacks.onSyncGenkou());
    rightGroup.appendChild(syncBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'nplot-btn';
    exportBtn.textContent = 'MD出力';
    exportBtn.title = '時系列順の構成案を Markdown (.md) として出力';
    exportBtn.addEventListener('click', () => this.callbacks.onExportMarkdown());
    rightGroup.appendChild(exportBtn);

    const backupBtn = document.createElement('button');
    backupBtn.className = 'nplot-btn';
    backupBtn.textContent = '復元';
    backupBtn.title = '自動バックアップ世代から比較・復元';
    backupBtn.addEventListener('click', () => this.callbacks.onRestoreBackup());
    rightGroup.appendChild(backupBtn);

    this.element.append(leftGroup, centerGroup, rightGroup);

    if (searchHadFocus) {
      searchInput.focus();
      if (caret !== null) {
        searchInput.setSelectionRange(caret, caret);
      }
    }
  }
}
