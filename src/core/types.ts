export type NodeCategory = 'note' | 'scene' | 'character' | 'foreshadow' | 'world_item';

export type SocketDataType = 'flow' | 'character' | 'foreshadow' | 'item';

export type SocketDirection = 'in' | 'out';

export type SceneStatus = 'idea' | 'draft' | 'fixed' | 'written';

export type EdgeLineStyle = 'solid' | 'dashed';

export type PlotThemeMode = 'dark' | 'light' | 'sepia';

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
  colorTag?: string;
}

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

