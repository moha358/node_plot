import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { connectSockets, createNode, removeEdge } from '../../src/core/graphEngine';
import {
  computeSceneOrder,
  computeTensionCurve,
  detectUnresolvedForeshadows,
  getForeshadowNodeStatus,
  getSceneConnectedElements,
} from '../../src/core/plotAnalyzer';
import { createInitialPlotDocument } from '../../src/core/serializer';

describe('PlotAnalyzer (時系列トポロジカルソート・未回収伏線検知・テンション曲線)', () => {
  it('初期プロットの時系列シーン順序とテンション曲線、伏線回収状態を正しく算出する', () => {
    const doc = createInitialPlotDocument();
    const order = computeSceneOrder(doc);
    assert.equal(order.hasCycle, false);
    assert.deepEqual(
      order.orderedScenes.map((s) => s.id),
      ['node_scene_1', 'node_scene_2']
    );

    const curve = computeTensionCurve(doc);
    assert.equal(curve.length, 2);
    assert.equal(curve[0].tension, 1);
    assert.equal(curve[1].tension, 5);

    // 初期サンプルでは伏線「逆回りする銀時計」は scene_1 で提示され scene_2 で回収済み
    assert.equal(getForeshadowNodeStatus(doc, 'node_hint_watch'), 'resolved');
    assert.equal(detectUnresolvedForeshadows(doc).length, 0);

    // 回収エッジを外すと「未回収の伏線」として検出される
    const unresolvedDoc = removeEdge(doc, 'edge_hint_resolve');
    assert.equal(getForeshadowNodeStatus(unresolvedDoc, 'node_hint_watch'), 'unresolved');
    const unresolvedList = detectUnresolvedForeshadows(unresolvedDoc);
    assert.equal(unresolvedList.length, 1);
    assert.equal(unresolvedList[0].sourceNodeId, 'node_hint_watch');
  });

  it('シーン間の循環フロー（ループ）を検知してもクラッシュせず全シーンを返す', () => {
    const s1 = createNode({ id: 's1', category: 'scene', x: 100, y: 100 });
    const s2 = createNode({ id: 's2', category: 'scene', x: 300, y: 100 });
    let doc = createInitialPlotDocument();
    doc = { ...doc, nodes: [s1, s2], edges: [] };
    doc = connectSockets(doc, 's1', 'flow_out', 's2', 'flow_in').document;
    doc = connectSockets(doc, 's2', 'flow_out', 's1', 'flow_in').document;

    const order = computeSceneOrder(doc);
    assert.equal(order.hasCycle, true);
    assert.equal(order.orderedScenes.length, 2);
    assert.deepEqual(order.cycleNodeIds, ['s1', 's2']);
  });

  it('シーンに接続された登場人物・提示伏線・回収伏線を逆引き取得できる', () => {
    const doc = createInitialPlotDocument();
    const s1Elements = getSceneConnectedElements(doc, 'node_scene_1');
    assert.equal(s1Elements.characters.length, 1);
    assert.equal(s1Elements.characters[0].title, '主人公：アキラ');
    assert.deepEqual(s1Elements.plantedForeshadows, ['伏線：逆回りする銀時計']);

    const s2Elements = getSceneConnectedElements(doc, 'node_scene_2');
    assert.deepEqual(s2Elements.resolvedForeshadows, ['伏線：逆回りする銀時計']);
  });

  it('150ノード規模の長編プロットでも高速（50ms未満）に時系列ソート・伏線検知が完了する', () => {
    let doc = createInitialPlotDocument('長編テスト');
    doc = { ...doc, nodes: [], edges: [] };
    for (let i = 1; i <= 150; i++) {
      const n = createNode({
        id: `scene_${i}`,
        category: 'scene',
        title: `シーン ${i}`,
        x: i * 100,
        y: 100,
      });
      doc.nodes.push(n);
      if (i > 1) {
        doc.edges.push({
          id: `e_${i}`,
          fromNodeId: `scene_${i - 1}`,
          fromSocketId: 'flow_out',
          toNodeId: `scene_${i}`,
          toSocketId: 'flow_in',
          dataType: 'flow',
          lineStyle: 'solid',
        });
      }
    }

    const start = performance.now();
    const order = computeSceneOrder(doc);
    const unresolved = detectUnresolvedForeshadows(doc);
    const curve = computeTensionCurve(doc);
    const elapsed = performance.now() - start;

    assert.equal(order.orderedScenes.length, 150);
    assert.equal(unresolved.length, 0);
    assert.equal(curve.length, 150);
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
  });
});
