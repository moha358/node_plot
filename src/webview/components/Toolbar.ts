import { summarizePlotStats } from '../../core/plotAnalyzer';
import { NODE_CATEGORY_META } from '../../core/theme';
import {
  EditorViewMode,
  NodeCategory,
  PlotConfig,
  PlotDocument,
  PlotThemeMode,
} from '../../core/types';

export interface ToolbarCallbacks {
  onAddNode: (category: NodeCategory) => void;
  onAddFrame: () => void;
  onFilterChange: (query: string) => void;
  onChangeViewMode: (mode: EditorViewMode) => void;
  onToggleOutlineDrawer: () => void;
  onToggleInspector: () => void;
  onToggleTraceMode: () => void;
  onThemeChange: (theme: PlotThemeMode) => void;
  onExportMarkdown: () => void;
  onSyncGenkou: () => void;
  onRestoreBackup: () => void;
}

const COMPACT_NODE_LABELS: Record<NodeCategory, string> = {
  note: 'メモ',
  scene: 'シーン',
  character: '人物',
  foreshadow: '伏線',
  world_item: '設定',
};

export class Toolbar {
  public readonly element: HTMLElement;

  constructor(private readonly callbacks: ToolbarCallbacks) {
    this.element = document.createElement('header');
    this.element.className = 'nplot-toolbar';
  }

  public render(
    doc: PlotDocument,
    config: PlotConfig,
    filterQuery: string,
    viewMode: EditorViewMode,
    showOutlineDrawer: boolean,
    showInspector: boolean,
    traceModeEnabled: boolean
  ): void {
    const stats = summarizePlotStats(doc);
    this.element.innerHTML = '';

    // Left group: View mode switch (Node ⇔ JSON) + Compact quick-add buttons
    const leftGroup = document.createElement('div');
    leftGroup.className = 'nplot-toolbar-group';

    const viewSwitch = document.createElement('div');
    viewSwitch.className = 'nplot-view-switch';

    const nodeModeBtn = document.createElement('button');
    nodeModeBtn.className = `nplot-view-switch-btn ${viewMode === 'node' ? 'is-active' : ''}`;
    nodeModeBtn.textContent = 'ノード';
    nodeModeBtn.title = 'ノードキャンバス表示に切り替え';
    nodeModeBtn.addEventListener('click', () => this.callbacks.onChangeViewMode('node'));

    const jsonModeBtn = document.createElement('button');
    jsonModeBtn.className = `nplot-view-switch-btn ${viewMode === 'json' ? 'is-active' : ''}`;
    jsonModeBtn.textContent = '{ } JSON';
    jsonModeBtn.title = 'JSONソース表示・編集に切り替え';
    jsonModeBtn.addEventListener('click', () => this.callbacks.onChangeViewMode('json'));

    viewSwitch.appendChild(nodeModeBtn);
    viewSwitch.appendChild(jsonModeBtn);
    leftGroup.appendChild(viewSwitch);

    const divider = document.createElement('span');
    divider.className = 'nplot-toolbar-divider';
    leftGroup.appendChild(divider);

    const categories: NodeCategory[] = ['note', 'scene', 'character', 'foreshadow', 'world_item'];
    for (const cat of categories) {
      const meta = NODE_CATEGORY_META[cat];
      const btn = document.createElement('button');
      btn.className = 'nplot-btn';
      btn.title = `${meta.label}ノードを追加`;
      const dot = document.createElement('span');
      dot.textContent = '●';
      dot.style.color = meta.cssColorVar;
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(`+${COMPACT_NODE_LABELS[cat]}`));
      btn.addEventListener('click', () => this.callbacks.onAddNode(cat));
      leftGroup.appendChild(btn);
    }

    const frameBtn = document.createElement('button');
    frameBtn.className = 'nplot-btn';
    frameBtn.textContent = '+枠';
    frameBtn.title = '章・グループフレーム枠を追加';
    frameBtn.addEventListener('click', () => this.callbacks.onAddFrame());
    leftGroup.appendChild(frameBtn);

    // Center group: Search + View/Analysis toggles
    const centerGroup = document.createElement('div');
    centerGroup.className = 'nplot-toolbar-group';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'nplot-input';
    searchInput.placeholder = '検索 (題名/タグ)...';
    searchInput.value = filterQuery;
    searchInput.addEventListener('input', () => {
      this.callbacks.onFilterChange(searchInput.value);
    });
    centerGroup.appendChild(searchInput);

    const traceBtn = document.createElement('button');
    traceBtn.className = `nplot-btn ${traceModeEnabled ? 'is-active' : ''}`;
    traceBtn.textContent = '関連強調';
    traceBtn.title = '選択ノードに繋がる人物・伏線・前後シーンのみを強調表示';
    traceBtn.addEventListener('click', () => this.callbacks.onToggleTraceMode());
    centerGroup.appendChild(traceBtn);

    const outlineBtn = document.createElement('button');
    outlineBtn.className = `nplot-btn ${showOutlineDrawer ? 'is-active' : ''}`;
    const alertBadge =
      stats.unresolvedForeshadowCount > 0 ? ` ⚠${stats.unresolvedForeshadowCount}` : '';
    outlineBtn.textContent = `時系列・曲線${alertBadge}`;
    outlineBtn.title = '下部の時系列アウトライン・テンション曲線・未回収伏線パネルを開閉';
    outlineBtn.addEventListener('click', () => this.callbacks.onToggleOutlineDrawer());
    centerGroup.appendChild(outlineBtn);

    const inspectorBtn = document.createElement('button');
    inspectorBtn.className = `nplot-btn ${showInspector ? 'is-active' : ''}`;
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

    this.element.appendChild(leftGroup);
    this.element.appendChild(centerGroup);
    this.element.appendChild(rightGroup);
  }
}
