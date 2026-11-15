import {
  computeTensionCurve,
  detectUnresolvedForeshadows,
  getSceneConnectedElements,
} from '../../core/plotAnalyzer';
import { PlotDocument } from '../../core/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class OutlinePanel {
  public readonly element: HTMLElement;

  constructor(private readonly onFocusNode: (nodeId: string) => void) {
    this.element = document.createElement('section');
    this.element.className = 'nplot-outline-drawer';
  }

  public render(doc: PlotDocument, visible: boolean): void {
    this.element.style.display = visible ? 'grid' : 'none';
    if (!visible) {
      return;
    }
    this.element.innerHTML = '';

    // Column 1: Ordered Scene Timeline
    const colScenes = document.createElement('div');
    colScenes.className = 'nplot-outline-col';
    const titleScenes = document.createElement('div');
    titleScenes.className = 'nplot-section-title';
    titleScenes.textContent = '時系列シーン構成（Flow順）';
    colScenes.appendChild(titleScenes);

    const curve = computeTensionCurve(doc);
    if (curve.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'シーンノードがありません。';
      colScenes.appendChild(empty);
    } else {
      for (const pt of curve) {
        const item = document.createElement('div');
        item.className = 'nplot-outline-item';
        const connected = getSceneConnectedElements(doc, pt.nodeId);
        const charNames = connected.characters.map((c) => c.title).join(', ');
        const chPrefix = pt.chapter ? `[${pt.chapter}] ` : '';

        const leftSpan = document.createElement('span');
        leftSpan.textContent = `${pt.orderIndex}. ${chPrefix}${pt.title}`;
        const rightSpan = document.createElement('span');
        rightSpan.className = 'nplot-chip';
        const sign = pt.tension > 0 ? `+${pt.tension}` : `${pt.tension}`;
        rightSpan.textContent = `感情:${sign}${charNames ? ` | 👤${connected.characters.length}` : ''}`;

        item.appendChild(leftSpan);
        item.appendChild(rightSpan);
        item.addEventListener('click', () => this.onFocusNode(pt.nodeId));
        colScenes.appendChild(item);
      }
    }

    // Column 2: Tension Curve SVG Graph
    const colCurve = document.createElement('div');
    colCurve.className = 'nplot-outline-col';
    const titleCurve = document.createElement('div');
    titleCurve.className = 'nplot-section-title';
    titleCurve.textContent = '感情・テンション推移曲線 (-5 〜 +5)';
    colCurve.appendChild(titleCurve);
    colCurve.appendChild(this.renderTensionSvg(curve));

    // Column 3: Unresolved Foreshadow Checker
    const colForeshadow = document.createElement('div');
    colForeshadow.className = 'nplot-outline-col';
    const unresolved = detectUnresolvedForeshadows(doc);
    const titleHint = document.createElement('div');
    titleHint.className = 'nplot-section-title';
    titleHint.textContent = `未回収・未提示の伏線チェック (${unresolved.length}件)`;
    colForeshadow.appendChild(titleHint);

    if (unresolved.length === 0) {
      const okItem = document.createElement('div');
      okItem.className = 'nplot-outline-item';
      okItem.textContent = '✓ すべての伏線が回収シーンに接続されています';
      colForeshadow.appendChild(okItem);
    } else {
      for (const u of unresolved) {
        const item = document.createElement('div');
        item.className = 'nplot-outline-item';
        const label = document.createElement('span');
        label.textContent = `⚠ ${u.title}`;
        const status = document.createElement('span');
        status.className = 'nplot-chip is-alert';
        status.textContent = u.statusLabel;
        item.appendChild(label);
        item.appendChild(status);
        item.addEventListener('click', () => this.onFocusNode(u.sourceNodeId));
        colForeshadow.appendChild(item);
      }
    }

    this.element.appendChild(colScenes);
    this.element.appendChild(colCurve);
    this.element.appendChild(colForeshadow);
  }

  private renderTensionSvg(
    curve: ReturnType<typeof computeTensionCurve>
  ): SVGSVGElement {
    const width = 340;
    const height = 135;
    const padX = 28;
    const padY = 18;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = '100%';
    svg.style.height = '135px';

    // Zero baseline
    const midY = height / 2;
    const zeroLine = document.createElementNS(SVG_NS, 'line');
    zeroLine.setAttribute('x1', String(padX));
    zeroLine.setAttribute('y1', String(midY));
    zeroLine.setAttribute('x2', String(width - padX));
    zeroLine.setAttribute('y2', String(midY));
    zeroLine.style.stroke = 'var(--nplot-border-strong)';
    zeroLine.style.strokeDasharray = '4 4';
    svg.appendChild(zeroLine);

    if (curve.length === 0) {
      return svg;
    }

    const usableW = width - padX * 2;
    const usableH = height - padY * 2;
    const coords = curve.map((pt, idx) => {
      const x =
        curve.length === 1
          ? width / 2
          : padX + (idx / (curve.length - 1)) * usableW;
      const norm = (pt.tension + 5) / 10; // 0..1
      const y = padY + (1 - norm) * usableH;
      return { x, y, pt };
    });

    if (coords.length > 1) {
      const poly = document.createElementNS(SVG_NS, 'polyline');
      poly.setAttribute(
        'points',
        coords.map((c) => `${c.x},${c.y}`).join(' ')
      );
      poly.style.fill = 'none';
      poly.style.stroke = 'var(--nplot-socket-flow)';
      poly.style.strokeWidth = '2.5px';
      svg.appendChild(poly);
    }

    for (const c of coords) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(c.x));
      circle.setAttribute('cy', String(c.y));
      circle.setAttribute('r', '5');
      circle.style.fill = 'var(--nplot-socket-flow)';
      circle.style.cursor = 'pointer';
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${c.pt.orderIndex}. ${c.pt.title} (感情: ${c.pt.tension})`;
      circle.appendChild(title);
      circle.addEventListener('click', () => this.onFocusNode(c.pt.nodeId));
      svg.appendChild(circle);
    }

    return svg;
  }
}
