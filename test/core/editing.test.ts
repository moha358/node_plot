import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyCertaintyFromTags,
  countEdgesLostByPromotion,
  countNodesWithCertaintyTags,
  createNode,
  extractNodeClipboard,
  insertNodeClipboard,
  isNodeClipboardPayload,
  removeNodes,
  toggleCharacterAppearance,
} from '../../src/core/graphEngine';
import {
  appearanceCellKey,
  buildAppearanceMatrix,
  isPovOfCharacter,
} from '../../src/core/plotAnalyzer';
import {
  createInitialPlotDocument,
  parsePlotDocument,
  serializePlotDocument,
  tryParsePlotDocument,
} from '../../src/core/serializer';
import { CERTAINTY_TAG_ALIASES } from '../../src/core/theme';
import { PlotDocument } from '../../src/core/types';

describe('編集機能（登場表・POV・クリップボード・確定度・安全なパース）', () => {
  it('POV の自由記述（複数視点・括弧付き）をキャラクター名と照合する', () => {
    const rojin = createNode({ id: 'r', category: 'character', title: 'ロジン（仮）' });
    const bio = createNode({ id: 'b', category: 'character', title: '生物学者' });
    const marine = createNode({ id: 'm', category: 'character', title: '海洋生物学者' });
    assert.equal(isPovOfCharacter('生物学者／ロジン', rojin), true);
    assert.equal(isPovOfCharacter('生物学者／ロジン', bio), true);
    assert.equal(isPovOfCharacter('海洋生物学者（案）', marine), true);
    // 部分一致では誤判定しない
    assert.equal(isPovOfCharacter('海洋生物学者（案）', bio), false);
    assert.equal(isPovOfCharacter('', bio), false);
  });

  it('登場表は時系列順のシーン列で登場・視点・人数を集計し、トグルで character ワイヤーを付け外しする', () => {
    const doc = createInitialPlotDocument();
    const matrix = buildAppearanceMatrix(doc);
    assert.deepEqual(
      matrix.scenes.map((s) => s.id),
      ['node_scene_1', 'node_scene_2']
    );
    const cell = matrix.cells.get(appearanceCellKey('node_char_hero', 'node_scene_1'));
    assert.deepEqual(cell, { appears: true, isPov: true }); // POV「アキラ」＝「主人公：アキラ」
    assert.equal(matrix.appearanceCount.get('node_char_hero'), 2);
    assert.equal(matrix.castCount.get('node_scene_2'), 1);

    const removed = toggleCharacterAppearance(doc, 'node_char_hero', 'node_scene_2');
    assert.equal(removed.appears, false);
    assert.equal(
      removed.document.edges.some(
        (e) => e.fromNodeId === 'node_char_hero' && e.toNodeId === 'node_scene_2'
      ),
      false
    );
    const added = toggleCharacterAppearance(removed.document, 'node_char_hero', 'node_scene_2');
    assert.equal(added.appears, true);
    const edge = added.document.edges.find(
      (e) => e.fromNodeId === 'node_char_hero' && e.toNodeId === 'node_scene_2'
    );
    assert.equal(edge?.fromSocketId, 'appear_out');
    assert.equal(edge?.toSocketId, 'chars_in');

    // 人物端子を持たないノードには登場させられない
    const refused = toggleCharacterAppearance(doc, 'node_char_hero', 'node_note_1');
    assert.ok(refused.reason);
    assert.equal(refused.document, doc);
  });

  it('コピー＆貼り付けは新しいIDを振り、選択内部のエッジだけを付け替えて複製する', () => {
    const doc = createInitialPlotDocument();
    const payload = extractNodeClipboard(doc, ['node_scene_1', 'node_hint_watch']);
    assert.equal(payload.nodes.length, 2);
    assert.deepEqual(payload.edges.map((e) => e.id), ['edge_hint_plant']);
    assert.equal(isNodeClipboardPayload(JSON.parse(JSON.stringify(payload))), true);
    assert.equal(isNodeClipboardPayload({ nodes: [] }), false);

    const { document: next, newNodeIds } = insertNodeClipboard(doc, payload, 40, 40);
    assert.equal(next.nodes.length, doc.nodes.length + 2);
    assert.equal(newNodeIds.length, 2);
    assert.ok(newNodeIds.every((id) => !doc.nodes.some((n) => n.id === id)));
    const copiedEdge = next.edges.find(
      (e) => newNodeIds.includes(e.fromNodeId) && newNodeIds.includes(e.toNodeId)
    );
    assert.ok(copiedEdge);
    const copiedScene = next.nodes.find((n) => n.id === newNodeIds[0])!;
    assert.equal(copiedScene.x, doc.nodes.find((n) => n.id === 'node_scene_1')!.x + 40);
  });

  it('複数ノードの一括削除で関連エッジも消え、種別変更で失われる接続数を事前に数えられる', () => {
    const doc = createInitialPlotDocument();
    const next = removeNodes(doc, ['node_scene_1', 'node_scene_2']);
    assert.equal(next.nodes.length, doc.nodes.length - 2);
    assert.equal(next.edges.length, 0);
    // シーン1をメモにすると、シーン1に繋がる3本（flow・character・伏線提示）が外れる
    assert.equal(countEdgesLostByPromotion(doc, 'node_scene_1', 'note'), 3);
  });

  it('タグ（決定／案／未統合）から確定度を一括設定できる', () => {
    const doc: PlotDocument = {
      ...createInitialPlotDocument(),
      nodes: [
        { ...createNode({ id: 'a' }), tags: ['決定', '主人公'] },
        { ...createNode({ id: 'b' }), tags: ['案'] },
        { ...createNode({ id: 'c' }), tags: ['未統合'] },
        { ...createNode({ id: 'd' }), tags: ['案'], certainty: 'decided' },
      ],
      edges: [],
    };
    assert.equal(countNodesWithCertaintyTags(doc, CERTAINTY_TAG_ALIASES), 3);
    const kept = applyCertaintyFromTags(doc, CERTAINTY_TAG_ALIASES, false);
    assert.equal(kept.updatedCount, 3);
    assert.deepEqual(
      kept.document.nodes.map((n) => n.certainty),
      ['decided', 'proposed', 'unsorted', 'decided']
    );
    assert.deepEqual(kept.document.nodes[0].tags, ['決定', '主人公']);

    const moved = applyCertaintyFromTags(doc, CERTAINTY_TAG_ALIASES, true);
    assert.deepEqual(moved.document.nodes[0].tags, ['主人公']);
    assert.deepEqual(moved.document.nodes[3].tags, ['案']); // 既に設定済みのノードは触らない
  });

  it('壊れた JSON はサンプルへすり替えずエラーを返し、空ファイルのみ新規扱いにする', () => {
    const broken = tryParsePlotDocument('{"nodes": [');
    assert.equal(broken.ok, false);
    const notObject = tryParsePlotDocument('[1,2,3]');
    assert.equal(notObject.ok, false);
    const empty = tryParsePlotDocument('   ');
    assert.ok(empty.ok && empty.isEmpty);
  });

  it('ノード幅・確定度・枠の色は保存と読み込みで保持され、不正値は除去される', () => {
    const doc = createInitialPlotDocument();
    doc.nodes[0] = { ...doc.nodes[0], width: 9999, certainty: 'proposed' };
    doc.frames[0] = { ...doc.frames[0], colorTag: 'violet' };
    const parsed = parsePlotDocument(serializePlotDocument(doc));
    assert.equal(parsed.nodes[0].width, 640); // 上限にクランプ
    assert.equal(parsed.nodes[0].certainty, 'proposed');
    assert.equal(parsed.frames[0].colorTag, 'violet');

    const raw = JSON.parse(serializePlotDocument(doc));
    raw.nodes[0].certainty = 'maybe';
    raw.frames[0].colorTag = 'url(javascript:alert(1))';
    const sanitized = parsePlotDocument(JSON.stringify(raw));
    assert.equal(sanitized.nodes[0].certainty, undefined);
    assert.equal(sanitized.frames[0].colorTag, undefined);
  });
});
