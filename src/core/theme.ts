import { NodeCategory, NodeCertainty, PlotConfig, PlotThemeMode, SocketDataType } from './types';

export const DEFAULT_PLOT_CONFIG: PlotConfig = {
  enabled: false,
  theme: 'dark',
  snapToGrid: true,
  gridSize: 20,
};

export interface CategoryMeta {
  category: NodeCategory;
  label: string;
  badgeText: string;
  cssColorVar: string;
}

export const NODE_CATEGORY_META: Record<NodeCategory, CategoryMeta> = {
  note: {
    category: 'note',
    label: 'メモ付箋',
    badgeText: 'NOTE',
    cssColorVar: 'var(--nplot-node-note)',
  },
  scene: {
    category: 'scene',
    label: 'シーン / イベント',
    badgeText: 'SCENE',
    cssColorVar: 'var(--nplot-node-scene)',
  },
  character: {
    category: 'character',
    label: 'キャラクター',
    badgeText: 'CHAR',
    cssColorVar: 'var(--nplot-node-character)',
  },
  foreshadow: {
    category: 'foreshadow',
    label: '伏線 / 謎',
    badgeText: 'HINT',
    cssColorVar: 'var(--nplot-node-foreshadow)',
  },
  world_item: {
    category: 'world_item',
    label: '設定 / アイテム',
    badgeText: 'ITEM',
    cssColorVar: 'var(--nplot-node-item)',
  },
};

export interface SocketTypeMeta {
  dataType: SocketDataType;
  label: string;
  symbol: string;
  cssColorVar: string;
}

export const SOCKET_TYPE_META: Record<SocketDataType, SocketTypeMeta> = {
  flow: {
    dataType: 'flow',
    label: '時系列・因果フロー',
    symbol: '▶',
    cssColorVar: 'var(--nplot-socket-flow)',
  },
  character: {
    dataType: 'character',
    label: '登場人物',
    symbol: '●',
    cssColorVar: 'var(--nplot-socket-character)',
  },
  foreshadow: {
    dataType: 'foreshadow',
    label: '伏線（提示/回収）',
    symbol: '◆',
    cssColorVar: 'var(--nplot-socket-foreshadow)',
  },
  item: {
    dataType: 'item',
    label: '条件・アイテム・状態',
    symbol: '■',
    cssColorVar: 'var(--nplot-socket-item)',
  },
};

const VALID_THEMES: ReadonlySet<PlotThemeMode> = new Set(['dark', 'light', 'sepia']);

export function sanitizePlotConfig(input: Partial<Record<keyof PlotConfig, unknown>> | undefined): PlotConfig {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_PLOT_CONFIG };
  }

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_PLOT_CONFIG.enabled;
  const theme =
    typeof input.theme === 'string' && VALID_THEMES.has(input.theme as PlotThemeMode)
      ? (input.theme as PlotThemeMode)
      : DEFAULT_PLOT_CONFIG.theme;
  const snapToGrid = typeof input.snapToGrid === 'boolean' ? input.snapToGrid : DEFAULT_PLOT_CONFIG.snapToGrid;

  let gridSize = DEFAULT_PLOT_CONFIG.gridSize;
  if (typeof input.gridSize === 'number' && Number.isFinite(input.gridSize)) {
    gridSize = Math.max(8, Math.min(64, Math.round(input.gridSize)));
  }

  return {
    enabled,
    theme,
    snapToGrid,
    gridSize,
  };
}

export interface CertaintyMeta {
  certainty: NodeCertainty;
  label: string;
  description: string;
}

export const CERTAINTY_META: Record<NodeCertainty, CertaintyMeta> = {
  decided: { certainty: 'decided', label: '決定', description: '採用が決まった要素（実線の枠）' },
  proposed: { certainty: 'proposed', label: '案', description: '検討中の候補（破線の枠）' },
  unsorted: { certainty: 'unsorted', label: '未整理', description: 'まだ構成に組み込んでいない断片（点線・半透明）' },
};

export const CERTAINTY_ORDER: readonly NodeCertainty[] = ['decided', 'proposed', 'unsorted'];

/** タグ名から確定度を推定するための別名表（一括変換用）。 */
export const CERTAINTY_TAG_ALIASES: Readonly<Record<string, NodeCertainty>> = {
  決定: 'decided',
  確定: 'decided',
  案: 'proposed',
  仮: 'proposed',
  候補: 'proposed',
  未統合: 'unsorted',
  未整理: 'unsorted',
  保留: 'unsorted',
};
