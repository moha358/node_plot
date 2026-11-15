import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addCustomSocket,
  canConnectSockets,
  connectSockets,
  createNode,
  extractConnectedSubgraph,
  promoteNodeCategory,
  removeNode,
} from '../../src/core/graphEngine';
import { createInitialPlotDocument } from '../../src/core/serializer';
import { PlotDocument } from '../../src/core/types';

describe('GraphEngine (B案マルチソケット & ノード昇格)', () => {
  it('note（メモ付箋）を作成後、scene（シーン）へ昇格すると標準ソケットとパラメータが付与される', () => {
    const note = createNode({ id: 'n1', category: 'note', title: '思いつきメモ' });
    assert.equal(note.sockets.length, 0);

    const doc: PlotDocument = {
      schemaVersion: 1,
      title: 'テスト',
      synopsis: '',
      viewport: { panX: 0, panY: 0, zoom: 1 },
      nodes: [note],
      edges: [],
      frames: [],
    };

    const promoted = promoteNodeCategory(doc, 'n1', 'scene');
    const sceneNode = promoted.nodes[0];
    assert.equal(sceneNode.category, 'scene');
    assert.ok(sceneNode.sockets.some((s) => s.id === 'flow_in' && s.dataType === 'flow'));
    assert.ok(sceneNode.sockets.some((s) => s.id === 'flow_out' && s.dataType === 'flow'));
    assert.ok(sceneNode.sockets.some((s) => s.id === 'chars_in' && s.dataType === 'character'));
    assert.ok(
      sceneNode.sockets.some((s) => s.id === 'foreshadow_plant' && s.dataType === 'foreshadow')
    );
    assert.ok(sceneNode.sceneParams);
  });

  it('ソケットの型（flow / character / foreshadow / item）と方向（out -> in）が一致する場合のみ接続を許可する', () => {
    const doc = createInitialPlotDocument();

    // 異なる型のソケット同士（character out -> flow in）は拒否される
    const mismatch = canConnectSockets(
      doc,
      'node_char_hero',
      'appear_out',
      'node_scene_1',
      'flow_in'
    );
    assert.equal(mismatch.valid, false);

    // 同一ノード内の接続は拒否される
    const selfLoop = canConnectSockets(
      doc,
      'node_scene_1',
      'flow_out',
      'node_scene_1',
      'flow_in'
    );
    assert.equal(selfLoop.valid, false);

    // 逆方向（in -> out）は拒否される
    const reverse = canConnectSockets(
      doc,
      'node_scene_2',
      'flow_in',
      'node_scene_1',
      'flow_out'
    );
    assert.equal(reverse.valid, false);

    // 新規シーンを追加して flow_out -> flow_in 接続が成功することを確認
    const scene3 = createNode({ id: 'node_scene_3', category: 'scene', title: '結末' });
    const docWithS3: PlotDocument = { ...doc, nodes: [...doc.nodes, scene3] };
    const connected = connectSockets(
      docWithS3,
      'node_scene_2',
      'flow_out',
      'node_scene_3',
      'flow_in',
      { label: '解決へ' }
    );
    assert.ok(connected.addedEdge);
    assert.equal(connected.addedEdge?.dataType, 'flow');
    assert.equal(connected.document.edges.length, doc.edges.length + 1);
  });

  it('カスタムソケットの追加と関連サブグラフ（伏線チェーン含む）の抽出が正しく動作する', () => {
    let doc = createInitialPlotDocument();
    doc = addCustomSocket(doc, 'node_scene_1', '真犯人の手がかり', 'foreshadow', 'out');
    const s1 = doc.nodes.find((n) => n.id === 'node_scene_1')!;
    assert.ok(s1.sockets.some((s) => s.label === '真犯人の手がかり' && s.isCustom));

    // 伏線ノードを選択した際、提示シーンと回収シーンの両方がハイライト対象に含まれる
    const sub = extractConnectedSubgraph(doc, 'node_hint_watch');
    assert.ok(sub.nodeIds.has('node_hint_watch'));
    assert.ok(sub.nodeIds.has('node_scene_1'));
    assert.ok(sub.nodeIds.has('node_scene_2'));

    // ノード削除時に関連エッジもクリーンアップされる
    const afterRemove = removeNode(doc, 'node_hint_watch');
    assert.equal(
      afterRemove.edges.some(
        (e) => e.fromNodeId === 'node_hint_watch' || e.toNodeId === 'node_hint_watch'
      ),
      false
    );
  });
});
