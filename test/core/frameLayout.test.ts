import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectFrameContents,
  computeFrameHierarchy,
  fitFrameToContents,
  getFrameAncestors,
  getNodeFramePath,
  removeFrameWithContents,
  resizeRect,
  sortFramesForRender,
  wrapInNewFrame,
} from '../../src/core/frameLayout';
import { createNode } from '../../src/core/graphEngine';
import { PlotDocument } from '../../src/core/types';

function makeDoc(): PlotDocument {
  return {
    schemaVersion: 1,
    title: '入れ子テスト',
    synopsis: '',
    viewport: { panX: 0, panY: 0, zoom: 1 },
    nodes: [
      createNode({ id: 'boss', category: 'character', x: 120, y: 120 }),
      createNode({ id: 'member', category: 'character', x: 420, y: 140 }),
      createNode({ id: 'outsider', category: 'character', x: 1500, y: 100 }),
      createNode({ id: 'loose', category: 'note', x: 40, y: 700 }),
    ],
    edges: [
      {
        id: 'e1',
        fromNodeId: 'boss',
        fromSocketId: 'appear_out',
        toNodeId: 'outsider',
        toSocketId: 'relation_in',
        dataType: 'character',
        lineStyle: 'solid',
      },
    ],
    frames: [
      // 勢力（外側）> 組織A（内側）
      { id: 'faction', title: '勢力', x: 0, y: 0, width: 1000, height: 600 },
      { id: 'orgA', title: '組織A', x: 380, y: 80, width: 400, height: 300 },
    ],
  };
}

describe('FrameLayout（枠の入れ子・所属・リサイズ）', () => {
  it('枠の親子関係とノードの所属を最内側の枠で導出する', () => {
    const doc = makeDoc();
    const h = computeFrameHierarchy(doc);
    assert.equal(h.frameParent.get('orgA'), 'faction');
    assert.equal(h.frameParent.get('faction'), null);
    assert.equal(h.nodeFrame.get('boss'), 'faction');
    assert.equal(h.nodeFrame.get('member'), 'orgA');
    assert.equal(h.nodeFrame.get('outsider'), null);

    assert.deepEqual(
      getNodeFramePath(doc, 'member').map((f) => f.title),
      ['勢力', '組織A']
    );
    assert.deepEqual(getFrameAncestors(doc, 'orgA').map((f) => f.id), ['faction']);
  });

  it('枠の中身には入れ子の子枠と、そのさらに内側のノードも含まれる', () => {
    const doc = makeDoc();
    const contents = collectFrameContents(doc, 'faction');
    assert.deepEqual([...contents.frameIds], ['orgA']);
    assert.deepEqual([...contents.nodeIds].sort(), ['boss', 'member']);

    const inner = collectFrameContents(doc, 'orgA');
    assert.equal(inner.frameIds.size, 0);
    assert.deepEqual([...inner.nodeIds], ['member']);
  });

  it('描画順は大きい枠が奥（先）、入れ子の内側の枠が手前（後）になる', () => {
    const doc = makeDoc();
    const reversed = [...doc.frames].reverse();
    assert.deepEqual(
      sortFramesForRender(reversed).map((f) => f.id),
      ['faction', 'orgA']
    );
  });

  it('リサイズハンドルは動かした辺のみ変更し、最小サイズで止まる', () => {
    const r = { x: 100, y: 100, width: 400, height: 300 };
    assert.deepEqual(resizeRect(r, 'se', 50, 20, 160, 100), {
      x: 100,
      y: 100,
      width: 450,
      height: 320,
    });
    assert.deepEqual(resizeRect(r, 'nw', -30, -10, 160, 100), {
      x: 70,
      y: 90,
      width: 430,
      height: 310,
    });
    // 左辺を右へ大きく動かしても最小幅で止まり、右辺は動かない
    const shrunk = resizeRect(r, 'w', 1000, 0, 160, 100);
    assert.equal(shrunk.width, 160);
    assert.equal(shrunk.x + shrunk.width, 500);
    // スナップ関数は動かした辺にのみ適用される
    const snapped = resizeRect(r, 'e', 13, 0, 160, 100, (v) => Math.round(v / 20) * 20);
    assert.equal(snapped.x, 100);
    assert.equal(snapped.width, 420);
  });

  it('選択ノードを囲む枠を作成すると、そのノードが新しい枠に所属する', () => {
    const doc = makeDoc();
    const rects = new Map([
      ['outsider', { x: 1500, y: 100, width: 232, height: 120 }],
    ]);
    const { document: next, frame } = wrapInNewFrame(doc, rects, {
      id: 'orgB',
      title: '組織B',
      colorTag: 'green',
    });
    assert.ok(frame);
    assert.equal(frame.colorTag, 'green');
    assert.equal(computeFrameHierarchy(next).nodeFrame.get('outsider'), 'orgB');
    // 何も選択していなければ枠は作られない
    assert.equal(wrapInNewFrame(doc, new Map(), { id: 'x', title: 'x' }).frame, null);
  });

  it('「中身に合わせる」は中身の外接矩形＋余白に枠を合わせ、中身が空なら変更しない', () => {
    const doc = makeDoc();
    const rects = new Map([['member', { x: 420, y: 140, width: 232, height: 100 }]]);
    const fitted = fitFrameToContents(doc, 'orgA', rects);
    const orgA = fitted.frames.find((f) => f.id === 'orgA')!;
    assert.ok(orgA.x < 420 && orgA.y < 140);
    assert.ok(orgA.x + orgA.width > 652 && orgA.y + orgA.height > 240);

    const empty: PlotDocument = { ...doc, frames: [...doc.frames, { id: 'void', title: '空', x: 3000, y: 3000, width: 300, height: 200 }] };
    assert.equal(fitFrameToContents(empty, 'void', rects), empty);
  });

  it('中身ごと削除すると、子枠・内側ノード・それらに繋がるエッジも消える', () => {
    const doc = makeDoc();
    const next = removeFrameWithContents(doc, 'faction');
    assert.deepEqual(next.frames, []);
    assert.deepEqual(next.nodes.map((n) => n.id).sort(), ['loose', 'outsider']);
    assert.equal(next.edges.length, 0);
  });
});
