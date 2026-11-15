import { SOCKET_TYPE_META } from '../../core/theme';
import { PlotDocument, SocketDataType } from '../../core/types';

export interface SocketPosition {
  x: number;
  y: number;
}

export interface TempWireState {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  dataType: SocketDataType;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_OFFSET = 10000;

export class EdgeRenderer {
  public readonly svgElement: SVGSVGElement;

  constructor(private readonly onSelectEdge: (edgeId: string) => void) {
    this.svgElement = document.createElementNS(SVG_NS, 'svg');
    this.svgElement.setAttribute('class', 'nplot-edge-svg');
    this.svgElement.setAttribute('viewBox', `0 0 ${SVG_OFFSET * 2} ${SVG_OFFSET * 2}`);
  }

  public static buildCubicBezierPath(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(55, Math.abs(x2 - x1) * 0.48);
    const cx1 = x1 + dx;
    const cy1 = y1;
    const cx2 = x2 - dx;
    const cy2 = y2;
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  }

  public render(
    doc: PlotDocument,
    socketPositions: Map<string, SocketPosition>,
    selectedEdgeId: string | null,
    activeTraceEdgeIds: Set<string> | null,
    tempWire: TempWireState | null
  ): void {
    this.svgElement.innerHTML = '';

    for (const edge of doc.edges) {
      const fromKey = `${edge.fromNodeId}:${edge.fromSocketId}`;
      const toKey = `${edge.toNodeId}:${edge.toSocketId}`;
      const p1 = socketPositions.get(fromKey);
      const p2 = socketPositions.get(toKey);
      if (!p1 || !p2) {
        continue;
      }

      const x1 = p1.x + SVG_OFFSET;
      const y1 = p1.y + SVG_OFFSET;
      const x2 = p2.x + SVG_OFFSET;
      const y2 = p2.y + SVG_OFFSET;

      const group = document.createElementNS(SVG_NS, 'g');
      const isDimmed = activeTraceEdgeIds !== null && !activeTraceEdgeIds.has(edge.id);
      group.setAttribute(
        'class',
        `nplot-edge-group ${isDimmed ? 'is-trace-dimmed' : ''}`
      );

      const path = document.createElementNS(SVG_NS, 'path');
      const d = EdgeRenderer.buildCubicBezierPath(x1, y1, x2, y2);
      path.setAttribute('d', d);

      const classes = ['nplot-edge-path'];
      if (edge.lineStyle === 'dashed') {
        classes.push('is-dashed');
      }
      if (edge.id === selectedEdgeId) {
        classes.push('is-selected');
      }
      path.setAttribute('class', classes.join(' '));
      path.style.stroke = SOCKET_TYPE_META[edge.dataType].cssColorVar;

      path.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onSelectEdge(edge.id);
      });
      group.appendChild(path);

      if (edge.label) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const labelLen = edge.label.length * 11 + 14;

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('class', 'nplot-edge-label-bg');
        rect.setAttribute('x', String(mx - labelLen / 2));
        rect.setAttribute('y', String(my - 10));
        rect.setAttribute('width', String(labelLen));
        rect.setAttribute('height', '20');
        group.appendChild(rect);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', 'nplot-edge-label');
        text.setAttribute('x', String(mx));
        text.setAttribute('y', String(my + 4));
        text.setAttribute('text-anchor', 'middle');
        text.textContent = edge.label;
        group.appendChild(text);
      }

      this.svgElement.appendChild(group);
    }

    if (tempWire) {
      const tempPath = document.createElementNS(SVG_NS, 'path');
      const d = EdgeRenderer.buildCubicBezierPath(
        tempWire.fromX + SVG_OFFSET,
        tempWire.fromY + SVG_OFFSET,
        tempWire.toX + SVG_OFFSET,
        tempWire.toY + SVG_OFFSET
      );
      tempPath.setAttribute('d', d);
      tempPath.setAttribute('class', 'nplot-edge-temp');
      tempPath.style.stroke = SOCKET_TYPE_META[tempWire.dataType].cssColorVar;
      this.svgElement.appendChild(tempPath);
    }
  }
}
