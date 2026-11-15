import { computeFrameHierarchy, getNodeFramePath } from '../../core/frameLayout';
import { appearanceCellKey, buildAppearanceMatrix } from '../../core/plotAnalyzer';
import { PlotDocument, PlotNode } from '../../core/types';

export interface AppearanceMatrixCallbacks {
  onToggleAppearance: (characterId: string, sceneId: string) => void;
  onFocusNode: (nodeId: string) => void;
}

interface CharacterGroup {
  label: string;
  characters: PlotNode[];
}

/** キャラクターを所属枠（組織など）ごとにまとめる。枠の外側→内側のパスをグループ名にする。 */
function groupCharactersByFrame(doc: PlotDocument): CharacterGroup[] {
  const hierarchy = computeFrameHierarchy(doc);
  const characters = doc.nodes.filter((n) => n.category === 'character');
  const byPosition = (a: PlotNode, b: PlotNode) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  const groups = new Map<string, { label: string; framed: boolean; items: PlotNode[] }>();
  for (const c of [...characters].sort(byPosition)) {
    const path = getNodeFramePath(doc, c.id, hierarchy);
    const label = path.length > 0 ? path.map((f) => f.title).join(' › ') : '（枠なし）';
    const g = groups.get(label) ?? { label, framed: path.length > 0, items: [] };
    g.items.push(c);
    groups.set(label, g);
  }
  // キャンバスの読み順（各グループ先頭メンバーの位置）で並べ、枠なしは末尾
  return [...groups.values()]
    .sort((a, b) => Number(!a.framed) - Number(!b.framed) || byPosition(a.items[0], b.items[0]))
    .map((g) => ({ label: g.label, characters: g.items }));
}

/**
 * 登場表ビュー：行＝キャラクター（所属枠ごとにグループ化）、列＝時系列順のシーン。
 * セルのクリックで登場（character ワイヤー）を付け外しでき、POV 一致セルは ◎ で示す。
 * キャンバス上で大量の人物ワイヤーを引かずに「誰がどこに出ているか／誰が長く不在か」を俯瞰できる。
 */
export class AppearanceMatrixView {
  public readonly element: HTMLElement;

  constructor(private readonly callbacks: AppearanceMatrixCallbacks) {
    this.element = document.createElement('section');
    this.element.className = 'nplot-matrix-view is-hidden';
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  public render(doc: PlotDocument): void {
    const scrollLeft = this.element.scrollLeft;
    const scrollTop = this.element.scrollTop;
    this.element.replaceChildren();

    const groups = groupCharactersByFrame(doc);
    const ordered = groups.flatMap((g) => g.characters);
    const matrix = buildAppearanceMatrix(doc, ordered);

    const legend = document.createElement('div');
    legend.className = 'nplot-matrix-legend';
    legend.textContent =
      '● 登場　◎ 登場＋視点人物　○ 視点人物だが未接続　｜セルをクリックで登場を付け外し・人物名／シーン名クリックでキャンバスへ移動';
    this.element.appendChild(legend);

    if (matrix.scenes.length === 0 || matrix.characters.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nplot-matrix-empty';
      empty.textContent =
        matrix.scenes.length === 0
          ? 'シーンノードがありません。キャンバスでシーンを追加してください。'
          : 'キャラクターノードがありません。キャンバスでキャラクターを追加してください。';
      this.element.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'nplot-matrix-table';

    // --- Header: chapter band row ---
    const thead = document.createElement('thead');
    const chapterRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'nplot-matrix-corner';
    corner.rowSpan = 2;
    corner.textContent = '人物 ＼ シーン';
    chapterRow.appendChild(corner);
    let runStart = 0;
    for (let i = 1; i <= matrix.scenes.length; i++) {
      const prevCh = matrix.scenes[i - 1].sceneParams?.chapter ?? '';
      const curCh = i < matrix.scenes.length ? matrix.scenes[i].sceneParams?.chapter ?? '' : null;
      if (curCh !== prevCh) {
        const th = document.createElement('th');
        th.className = 'nplot-matrix-chapter';
        th.colSpan = i - runStart;
        th.textContent = prevCh || '—';
        th.title = prevCh;
        chapterRow.appendChild(th);
        runStart = i;
      }
    }
    const statHead = document.createElement('th');
    statHead.className = 'nplot-matrix-stat-head';
    statHead.colSpan = 2;
    statHead.rowSpan = 2;
    statHead.textContent = '登場 / 視点';
    chapterRow.appendChild(statHead);
    thead.appendChild(chapterRow);

    // --- Header: scene row ---
    const sceneRow = document.createElement('tr');
    matrix.scenes.forEach((scene, idx) => {
      const th = document.createElement('th');
      th.className = 'nplot-matrix-scene';
      const sp = scene.sceneParams;
      const lines = [
        `${idx + 1}. ${scene.title}`,
        sp?.chapter ? `章: ${sp.chapter}` : '',
        sp?.pov ? `視点: ${sp.pov}` : '視点: 未設定',
        sp?.timepoint ? `作中時間: ${sp.timepoint}` : '',
      ].filter(Boolean);
      if (matrix.unmatchedPovSceneIds.has(scene.id)) {
        lines.push('⚠ 視点の記述がどのキャラクター名とも一致しません');
        th.classList.add('is-pov-unmatched');
      }
      th.title = lines.join('\n');
      const num = document.createElement('span');
      num.className = 'nplot-matrix-scene-num';
      num.textContent = String(idx + 1);
      const label = document.createElement('span');
      label.className = 'nplot-matrix-scene-label';
      label.textContent = scene.title;
      th.append(num, label);
      th.addEventListener('click', () => this.callbacks.onFocusNode(scene.id));
      sceneRow.appendChild(th);
    });
    thead.appendChild(sceneRow);
    table.appendChild(thead);

    // --- Body ---
    const tbody = document.createElement('tbody');
    const totalCols = matrix.scenes.length + 3;
    for (const group of groups) {
      if (groups.length > 1 || group.label !== '（枠なし）') {
        const gRow = document.createElement('tr');
        gRow.className = 'nplot-matrix-group-row';
        const gCell = document.createElement('th');
        gCell.colSpan = totalCols;
        gCell.textContent = group.label;
        gRow.appendChild(gCell);
        tbody.appendChild(gRow);
      }
      for (const c of group.characters) {
        const tr = document.createElement('tr');
        const nameTh = document.createElement('th');
        nameTh.className = 'nplot-matrix-name';
        nameTh.textContent = c.title;
        nameTh.title = [c.title, c.characterParams?.role ?? ''].filter(Boolean).join('\n');
        nameTh.addEventListener('click', () => this.callbacks.onFocusNode(c.id));
        tr.appendChild(nameTh);

        let absentRun = 0;
        let longestAbsent = 0;
        let seenFirst = false;
        for (const scene of matrix.scenes) {
          const cell = matrix.cells.get(appearanceCellKey(c.id, scene.id));
          const td = document.createElement('td');
          td.className = 'nplot-matrix-cell';
          const btn = document.createElement('button');
          btn.type = 'button';
          if (cell?.appears && cell.isPov) {
            btn.textContent = '◎';
            td.classList.add('is-appear', 'is-pov');
          } else if (cell?.appears) {
            btn.textContent = '●';
            td.classList.add('is-appear');
          } else if (cell?.isPov) {
            btn.textContent = '○';
            td.classList.add('is-pov-only');
          } else {
            btn.textContent = '';
          }
          btn.title = `${c.title} × ${scene.title}\n${cell?.appears ? 'クリックで登場を外す' : 'クリックで登場させる'}`;
          btn.addEventListener('click', () => this.callbacks.onToggleAppearance(c.id, scene.id));
          td.appendChild(btn);
          tr.appendChild(td);

          if (cell?.appears) {
            seenFirst = true;
            longestAbsent = Math.max(longestAbsent, absentRun);
            absentRun = 0;
          } else if (seenFirst) {
            absentRun++;
          }
        }

        const appearCount = matrix.appearanceCount.get(c.id) ?? 0;
        const povCount = matrix.povCount.get(c.id) ?? 0;
        const tdA = document.createElement('td');
        tdA.className = 'nplot-matrix-stat';
        tdA.textContent = String(appearCount);
        tdA.title = longestAbsent > 0 ? `登場の間の最長不在: ${longestAbsent} シーン連続` : '';
        const tdP = document.createElement('td');
        tdP.className = 'nplot-matrix-stat';
        tdP.textContent = String(povCount);
        tr.append(tdA, tdP);
        tbody.appendChild(tr);
      }
    }

    // --- Footer: cast count per scene ---
    const footRow = document.createElement('tr');
    footRow.className = 'nplot-matrix-foot';
    const footTh = document.createElement('th');
    footTh.className = 'nplot-matrix-name';
    footTh.textContent = '登場人数';
    footRow.appendChild(footTh);
    for (const scene of matrix.scenes) {
      const td = document.createElement('td');
      td.className = 'nplot-matrix-stat';
      td.textContent = String(matrix.castCount.get(scene.id) ?? 0);
      footRow.appendChild(td);
    }
    footRow.appendChild(document.createElement('td'));
    footRow.appendChild(document.createElement('td'));
    tbody.appendChild(footRow);

    table.appendChild(tbody);
    this.element.appendChild(table);
    this.element.scrollLeft = scrollLeft;
    this.element.scrollTop = scrollTop;
  }
}
