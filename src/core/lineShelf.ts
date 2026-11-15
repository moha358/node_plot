import { computeSceneOrder, isPovOfCharacter } from './plotAnalyzer';
import { LineStatus, PlotDocument, PlotLine, PlotNode } from './types';

/**
 * セリフ棚（書き溜めセリフ）のコアロジック。
 * セリフはノードとは別の `doc.lines` に保持し、話者（キャラクターノード）とシーンへの配置を ID で参照する。
 * 参照先ノードが消えた・カテゴリが変わった場合も ID は保持し（Undo や JSON 編集での消失を防ぐ）、
 * 表示・集計時に「存在するシーン／キャラクター」だけを有効として扱う。
 */

let lineCounter = 1;

export function generateLineId(): string {
  return `line_${Date.now()}_${lineCounter++}`;
}

export function getLines(doc: PlotDocument): PlotLine[] {
  return doc.lines ?? [];
}

function withLines(doc: PlotDocument, lines: PlotLine[]): PlotDocument {
  return { ...doc, lines };
}

export function createLine(options: {
  speakerId?: string;
  text: string;
  note?: string;
  id?: string;
}): PlotLine {
  return {
    id: options.id ?? generateLineId(),
    speakerId: options.speakerId ?? '',
    text: options.text,
    note: options.note ?? '',
    candidateSceneIds: [],
  };
}

function sceneIdSet(doc: PlotDocument): Set<string> {
  return new Set(doc.nodes.filter((n) => n.category === 'scene').map((n) => n.id));
}

/** 存在するシーンへの配置のみを有効とみなして状態を導出する。 */
export function getLineStatus(line: PlotLine, validSceneIds: ReadonlySet<string>): LineStatus {
  if (line.placedSceneId && validSceneIds.has(line.placedSceneId)) {
    return 'placed';
  }
  if (line.candidateSceneIds.some((id) => validSceneIds.has(id))) {
    return 'candidate';
  }
  return 'unplaced';
}

export function addLines(doc: PlotDocument, lines: PlotLine[]): PlotDocument {
  const valid = lines.filter((l) => l.text.trim().length > 0);
  if (valid.length === 0) {
    return doc;
  }
  return withLines(doc, [...getLines(doc), ...valid]);
}

export function updateLine(
  doc: PlotDocument,
  lineId: string,
  patch: Partial<Pick<PlotLine, 'speakerId' | 'text' | 'note'>>
): PlotDocument {
  return withLines(
    doc,
    getLines(doc).map((l) => (l.id === lineId ? { ...l, ...patch } : l))
  );
}

export function removeLine(doc: PlotDocument, lineId: string): PlotDocument {
  return withLines(
    doc,
    getLines(doc).filter((l) => l.id !== lineId)
  );
}

function mapLine(doc: PlotDocument, lineId: string, fn: (l: PlotLine) => PlotLine): PlotDocument {
  return withLines(
    doc,
    getLines(doc).map((l) => (l.id === lineId ? fn(l) : l))
  );
}

/** シーンを候補に加える。すでに確定済みの配置先なら何もしない。 */
export function addLineCandidate(doc: PlotDocument, lineId: string, sceneId: string): PlotDocument {
  return mapLine(doc, lineId, (l) =>
    l.placedSceneId === sceneId || l.candidateSceneIds.includes(sceneId)
      ? l
      : { ...l, candidateSceneIds: [...l.candidateSceneIds, sceneId] }
  );
}

/** 候補・確定のいずれからもシーンを外す。 */
export function detachLineFromScene(doc: PlotDocument, lineId: string, sceneId: string): PlotDocument {
  return mapLine(doc, lineId, (l) => {
    const next: PlotLine = { ...l, candidateSceneIds: l.candidateSceneIds.filter((id) => id !== sceneId) };
    if (next.placedSceneId === sceneId) {
      delete next.placedSceneId;
    }
    return next;
  });
}

/**
 * シーンへの配置を確定する。以前の確定先は候補に戻す（別案として残す）。
 */
export function placeLine(doc: PlotDocument, lineId: string, sceneId: string): PlotDocument {
  return mapLine(doc, lineId, (l) => {
    if (l.placedSceneId === sceneId) {
      return l;
    }
    const candidates = l.candidateSceneIds.filter((id) => id !== sceneId);
    if (l.placedSceneId) {
      candidates.push(l.placedSceneId);
    }
    return { ...l, candidateSceneIds: candidates, placedSceneId: sceneId };
  });
}

/** 確定を取り消して候補に戻す。 */
export function unplaceLine(doc: PlotDocument, lineId: string): PlotDocument {
  return mapLine(doc, lineId, (l) => {
    if (!l.placedSceneId) {
      return l;
    }
    const next: PlotLine = {
      ...l,
      candidateSceneIds: l.candidateSceneIds.includes(l.placedSceneId)
        ? l.candidateSceneIds
        : [...l.candidateSceneIds, l.placedSceneId],
    };
    delete next.placedSceneId;
    return next;
  });
}

/**
 * ノード削除時にセリフ側の参照を掃除する。削除シーンへの配置は外れて棚に戻り、
 * 削除キャラクターのセリフは「話者未定」になる（セリフ自体は消さない）。
 */
export function detachLinesFromNodes(doc: PlotDocument, nodeIds: ReadonlySet<string>): PlotDocument {
  if (!doc.lines || doc.lines.length === 0 || nodeIds.size === 0) {
    return doc;
  }
  let changed = false;
  const lines = doc.lines.map((l) => {
    const touches =
      nodeIds.has(l.speakerId) ||
      (l.placedSceneId !== undefined && nodeIds.has(l.placedSceneId)) ||
      l.candidateSceneIds.some((id) => nodeIds.has(id));
    if (!touches) {
      return l;
    }
    changed = true;
    const next: PlotLine = {
      ...l,
      speakerId: nodeIds.has(l.speakerId) ? '' : l.speakerId,
      candidateSceneIds: l.candidateSceneIds.filter((id) => !nodeIds.has(id)),
    };
    if (next.placedSceneId && nodeIds.has(next.placedSceneId)) {
      delete next.placedSceneId;
    }
    return next;
  });
  return changed ? { ...doc, lines } : doc;
}

export interface SceneLineSummary {
  placed: PlotLine[];
  candidates: PlotLine[];
}

/** シーン ID → そのシーンに確定／候補として紐づくセリフ。 */
export function summarizeSceneLines(doc: PlotDocument): Map<string, SceneLineSummary> {
  const scenes = sceneIdSet(doc);
  const result = new Map<string, SceneLineSummary>();
  const get = (id: string) => {
    let s = result.get(id);
    if (!s) {
      s = { placed: [], candidates: [] };
      result.set(id, s);
    }
    return s;
  };
  for (const line of getLines(doc)) {
    if (line.placedSceneId && scenes.has(line.placedSceneId)) {
      get(line.placedSceneId).placed.push(line);
    }
    for (const id of line.candidateSceneIds) {
      if (scenes.has(id)) {
        get(id).candidates.push(line);
      }
    }
  }
  return result;
}

export interface SpeakerColumn {
  /** キャラクターノード。話者未定（または話者が存在しない）列は null。 */
  speaker: PlotNode | null;
  lines: PlotLine[];
}

/**
 * セリフ棚の列（話者ごと）を作る。キャラクターはキャンバスの読み順、最後に「話者未定」列。
 * セリフのないキャラクターも列として出す（書き溜め先として選べるように）。
 */
export function groupLinesBySpeaker(doc: PlotDocument): SpeakerColumn[] {
  const characters = doc.nodes
    .filter((n) => n.category === 'character')
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const byId = new Map<string, PlotLine[]>(characters.map((c) => [c.id, []]));
  const orphan: PlotLine[] = [];
  for (const line of getLines(doc)) {
    const bucket = byId.get(line.speakerId);
    if (bucket) {
      bucket.push(line);
    } else {
      orphan.push(line);
    }
  }
  const columns: SpeakerColumn[] = characters.map((c) => ({ speaker: c, lines: byId.get(c.id)! }));
  columns.push({ speaker: null, lines: orphan });
  return columns;
}

export interface LineStats {
  total: number;
  placed: number;
  candidate: number;
  unplaced: number;
}

export function computeLineStats(doc: PlotDocument): LineStats {
  const scenes = sceneIdSet(doc);
  const stats: LineStats = { total: 0, placed: 0, candidate: 0, unplaced: 0 };
  for (const line of getLines(doc)) {
    stats.total++;
    stats[getLineStatus(line, scenes)]++;
  }
  return stats;
}

/** 時系列順のシーン（配置先の選択肢・ドロップ先の並び順に使う）。 */
export function getOrderedScenes(doc: PlotDocument): PlotNode[] {
  return computeSceneOrder(doc).orderedScenes;
}

/**
 * 名前の表記（「アキラ」「主人公：アキラ」など）からキャラクターを探す。
 * 完全一致（括弧・肩書き除去後）を優先し、無ければタイトルへの部分一致が一意な場合のみ採用する。
 */
export function findCharacterByName(name: string, characters: readonly PlotNode[]): PlotNode | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  const exact = characters.find((c) => c.title.trim() === trimmed || isPovOfCharacter(trimmed, c));
  if (exact) {
    return exact;
  }
  const partial = characters.filter((c) => c.title.includes(trimmed));
  return partial.length === 1 ? partial[0] : null;
}

export interface ParsedCaptureLine {
  speakerId: string;
  /** 話者名が書かれていたがキャラクターに一致しなかった場合の表記 */
  unknownSpeakerName?: string;
  text: string;
  note: string;
}

const BRACKET_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
];

function stripOuterBrackets(text: string): string {
  const t = text.trim();
  for (const [open, close] of BRACKET_PAIRS) {
    if (t.startsWith(open) && t.endsWith(close) && t.length >= 2) {
      return t.slice(open.length, t.length - close.length).trim();
    }
  }
  return t;
}

/** 行末の「// メモ」を切り出す。 */
function splitSlashNote(line: string): { body: string; note: string } {
  const m = line.match(/^(.*?)\s*\/\/\s*(.+)$/);
  return m ? { body: m[1].trim(), note: m[2].trim() } : { body: line.trim(), note: '' };
}

/** 閉じ鉤括弧の後ろの「（メモ）」を切り出す（複数行のセリフにも対応）。 */
function splitParenNote(text: string): { body: string; note: string } {
  const m = text.match(/^([\s\S]*[」』])\s*[（(]([^）)]*)[）)]\s*$/);
  return m ? { body: m[1].trim(), note: m[2].trim() } : { body: text.trim(), note: '' };
}

interface SpeakerMarker {
  name: string;
  rest: string;
}

/** 行頭の話者指定（`@名前`、既存キャラ名＋「 または ：）を読み取る。 */
function readSpeakerMarker(line: string, characters: readonly PlotNode[]): SpeakerMarker | null {
  const at = line.match(/^[@＠](\S+?)(?:\s+(.*))?$/);
  if (at) {
    return { name: at[1], rest: at[2] ?? '' };
  }
  const bracket = line.match(/^([^「『\s]{1,24})\s*([「『].*)$/);
  if (bracket && findCharacterByName(bracket[1], characters)) {
    return { name: bracket[1], rest: bracket[2] };
  }
  const colon = line.match(/^([^：:「『\s]{1,24})\s*[：:]\s*(.+)$/);
  if (colon && findCharacterByName(colon[1], characters)) {
    return { name: colon[1], rest: colon[2] };
  }
  return null;
}

/**
 * まとめ書き・貼り付けテキストをセリフに分解する。
 *
 * 新しいセリフとして区切るのは次の行だけで、それ以外の改行は同じセリフ内の改行として残す
 * （入力欄の Shift+Enter で複数行のセリフを書けるように）:
 * - 空行
 * - `@アキラ 師匠は、まだ生きてる`        … @名前 + 空白 + 本文
 * - `アキラ「師匠は、まだ生きてる」`      … 名前 + 鉤括弧（名前が既存キャラに一致する場合のみ）
 * - `アキラ：師匠は、まだ生きてる`        … 名前 + 全角/半角コロン（同上）
 * - `「師匠は、まだ生きてる」`            … 鉤括弧で始まる行（直前の話者、無ければ defaultSpeakerId）
 *
 * 行末の `// メモ` または閉じ鉤括弧の後ろの `（メモ）` はメモ欄に入る。
 * `@名前` 単独の行は以降の話者を切り替える。未登録の `@名前` は話者未定とし、メモに表記を残す。
 */
export function parseLineCaptureText(
  text: string,
  characters: readonly PlotNode[],
  defaultSpeakerId = ''
): ParsedCaptureLine[] {
  interface Draft {
    speakerId: string;
    unknown?: string;
    bodyLines: string[];
    notes: string[];
  }
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let speakerId = defaultSpeakerId;
  let unknown: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      current = null;
      continue;
    }

    const marker = readSpeakerMarker(line, characters);
    let rest = line;
    let startsNew = current === null || /^[「『]/.test(line);
    if (marker) {
      const found = findCharacterByName(marker.name, characters);
      speakerId = found?.id ?? '';
      unknown = found ? undefined : marker.name;
      rest = marker.rest;
      startsNew = true;
      if (!rest.trim()) {
        // `@名前` だけの行：話者の切り替えのみ
        current = null;
        continue;
      }
    }

    const { body, note } = splitSlashNote(rest);
    if (startsNew || !current) {
      current = { speakerId, unknown, bodyLines: [], notes: [] };
      drafts.push(current);
    }
    if (body) {
      current.bodyLines.push(body);
    }
    if (note) {
      current.notes.push(note);
    }
  }

  const result: ParsedCaptureLine[] = [];
  for (const d of drafts) {
    const { body, note: parenNote } = splitParenNote(d.bodyLines.join('\n'));
    const finalText = stripOuterBrackets(body);
    if (!finalText) {
      continue;
    }
    const notes = [...(d.unknown ? [`話者: ${d.unknown}`] : []), ...d.notes, ...(parenNote ? [parenNote] : [])];
    const entry: ParsedCaptureLine = { speakerId: d.speakerId, text: finalText, note: notes.join(' / ') };
    if (d.unknown) {
      entry.unknownSpeakerName = d.unknown;
    }
    result.push(entry);
  }
  return result;
}

/** 表示用の話者名（肩書き「主人公：」などを除いた短い名前）。 */
export function speakerDisplayName(speaker: PlotNode | null | undefined): string {
  if (!speaker) {
    return '話者未定';
  }
  const t = speaker.title.trim();
  const idx = Math.max(t.lastIndexOf('：'), t.lastIndexOf(':'));
  const short = idx >= 0 ? t.slice(idx + 1).trim() : t;
  return short || t || '無名';
}

function normalizeRelPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * 原稿ファイル（プロットファイルのフォルダーからの相対パス）に対応するシーンを探す。
 * `manuscriptPath` との完全一致を優先し、無ければファイル名一致が一意な場合のみ採用する。
 * 原稿執筆中にセリフを書き留めたとき、そのシーンを候補にするために使う。
 */
export function findSceneByManuscriptFile(doc: PlotDocument, relativePath: string): PlotNode | null {
  const target = normalizeRelPath(relativePath);
  if (!target || target.startsWith('../')) {
    return null;
  }
  const scenes = doc.nodes.filter((n) => n.category === 'scene' && n.sceneParams?.manuscriptPath?.trim());
  const exact = scenes.find((s) => normalizeRelPath(s.sceneParams!.manuscriptPath) === target);
  if (exact) {
    return exact;
  }
  const base = target.split('/').pop()!;
  const byName = scenes.filter(
    (s) => normalizeRelPath(s.sceneParams!.manuscriptPath).split('/').pop() === base
  );
  return byName.length === 1 ? byName[0] : null;
}

/**
 * `@名前` だけの入力を話者切り替えとして解釈する。該当しない入力は undefined、
 * 未登録の名前は話者未定（空文字）を返す。
 */
export function parseSpeakerSwitch(text: string, characters: readonly PlotNode[]): string | undefined {
  const m = text.trim().match(/^[@＠](\S+)$/);
  if (!m) {
    return undefined;
  }
  return findCharacterByName(m[1], characters)?.id ?? '';
}
