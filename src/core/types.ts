export type NodeCategory = 'note' | 'scene' | 'character' | 'foreshadow' | 'world_item';

export type SocketDataType = 'flow' | 'character' | 'foreshadow' | 'item';

export type SocketDirection = 'in' | 'out';

export type SceneStatus = 'idea' | 'draft' | 'fixed' | 'written';

export type EdgeLineStyle = 'solid' | 'dashed';

export type PlotThemeMode = 'dark' | 'light' | 'sepia';

export type EditorViewMode = 'node' | 'matrix' | 'lines' | 'json';

/** 全ノード共通の確定度（執筆ステータスとは別軸）。未設定は undefined。 */
export type NodeCertainty = 'decided' | 'proposed' | 'unsorted';

/** グループ枠の塗り色トークン名（実際の色は globalTheme.css の --nplot-frame-color-* で定義）。 */
export type FrameColor =
  | 'none'
  | 'gray'
  | 'blue'
  | 'teal'
  | 'green'
  | 'amber'
  | 'orange'
  | 'rose'
  | 'violet';

export interface PlotSocket {
  id: string;
  label: string;
  dataType: SocketDataType;
  direction: SocketDirection;
  isCustom?: boolean;
}

export interface CustomParamEntry {
  key: string;
  value: string;
}

export interface SceneParameters {
  chapter: string;
  timepoint: string;
  pov: string;
  tension: number; // -5 to +5
  status: SceneStatus;
  manuscriptPath: string;
}

export interface CharacterParameters {
  role: string;
  goal: string;
  flaw: string;
}

export interface ForeshadowParameters {
  hintDetail: string;
  payoffIdea: string;
}

export interface WorldItemParameters {
  itemType: string;
  ruleOrCondition: string;
}

export interface PlotNode {
  id: string;
  category: NodeCategory;
  title: string;
  body: string;
  x: number;
  y: number;
  width?: number;
  colorTag?: string;
  certainty?: NodeCertainty;
  tags: string[];
  sockets: PlotSocket[];
  sceneParams?: SceneParameters;
  characterParams?: CharacterParameters;
  foreshadowParams?: ForeshadowParameters;
  itemParams?: WorldItemParameters;
  customParams: CustomParamEntry[];
}

export interface PlotEdge {
  id: string;
  fromNodeId: string;
  fromSocketId: string;
  toNodeId: string;
  toSocketId: string;
  dataType: SocketDataType;
  lineStyle: EdgeLineStyle;
  label?: string;
}

export interface PlotFrame {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colorTag?: FrameColor;
}

/**
 * 書き溜めたセリフ（どこにハマるか未定のものを含む）。キャンバスのノードとは別に保持する。
 * 配置状態は保持せず `placedSceneId` / `candidateSceneIds` から導出する（lineShelf.getLineStatus）。
 */
export interface PlotLine {
  id: string;
  /** 発話するキャラクターノードの ID。空文字は「話者未定」。 */
  speakerId: string;
  text: string;
  /** 言い方・状況・誰に向けた言葉かなどのメモ */
  note: string;
  /** はまりそうなシーン（複数可）。placedSceneId は含めない。 */
  candidateSceneIds: string[];
  /** 確定した配置先シーン */
  placedSceneId?: string;
}

export type LineStatus = 'placed' | 'candidate' | 'unplaced';

export interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface PlotDocument {
  schemaVersion: 1;
  title: string;
  synopsis: string;
  viewport: ViewportState;
  nodes: PlotNode[];
  edges: PlotEdge[];
  frames: PlotFrame[];
  /** 書き溜めセリフ。未使用のファイルでは省略される（後方互換）。 */
  lines?: PlotLine[];
}

export interface PlotConfig {
  enabled: boolean;
  theme: PlotThemeMode;
  snapToGrid: boolean;
  gridSize: number;
}

export interface UnresolvedForeshadowItem {
  id: string;
  title: string;
  sourceNodeId: string;
  sourceNodeTitle: string;
  kind: 'foreshadow_node_unplanted' | 'foreshadow_node_unresolved' | 'scene_plant_unconnected';
  statusLabel: string;
}

export interface TensionPoint {
  orderIndex: number;
  nodeId: string;
  title: string;
  chapter: string;
  tension: number;
  status: SceneStatus;
}

export interface PlotSummaryStats {
  totalNodes: number;
  sceneCount: number;
  characterCount: number;
  foreshadowCount: number;
  unresolvedForeshadowCount: number;
  hasFlowCycle: boolean;
}

export type HostToWebviewMessage =
  | {
      type: 'INIT_DOCUMENT';
      document: PlotDocument;
      config: PlotConfig;
      version: number;
      fileName: string;
    }
  | {
      type: 'DOCUMENT_CHANGED';
      document: PlotDocument;
      version: number;
    }
  | {
      type: 'EDIT_RESULT';
      version: number;
      accepted: boolean;
      document?: PlotDocument;
    }
  | {
      type: 'CONFIG_CHANGED';
      config: PlotConfig;
    }
  | {
      type: 'FOCUS_NODE';
      nodeId: string;
    }
  | {
      /** .nplot の JSON が壊れている場合。Webview は編集をブロックし、サンプルで上書きしない。 */
      type: 'PARSE_ERROR';
      message: string;
      version: number;
      fileName?: string;
      config?: PlotConfig;
    };

export type WebviewToHostMessage =
  | {
      type: 'READY';
    }
  | {
      type: 'UPDATE_DOCUMENT';
      document: PlotDocument;
      version: number;
    }
  | {
      type: 'UPDATE_CONFIG';
      partialConfig: Partial<PlotConfig>;
    }
  | {
      type: 'OPEN_MANUSCRIPT';
      nodeId: string;
      manuscriptPath: string;
      sceneTitle: string;
      createIfMissing: boolean;
    }
  | {
      type: 'REQUEST_EXPORT';
      format: 'markdown' | 'sync_genkou';
    }
  | {
      type: 'REQUEST_RESTORE_BACKUP';
    }
  | {
      type: 'OPEN_IN_TEXT_EDITOR';
    };

export interface ComparePaneData {
  label: string;
  detail: string;
  text: string;
  adoptLabel: string;
}

export type CompareHostToWebviewMessage = {
  type: 'INIT_COMPARE';
  config: PlotConfig;
  fileName: string;
  left: ComparePaneData;
  right: ComparePaneData;
};

export type CompareWebviewToHostMessage =
  | {
      type: 'COMPARE_READY';
    }
  | {
      type: 'ADOPT';
      side: 'left' | 'right';
    };

