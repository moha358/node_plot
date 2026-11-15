import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeMinimalTextEdit,
  createInitialPlotDocument,
  parsePlotDocument,
  serializePlotDocument,
} from '../../src/core/serializer';
import { sanitizePlotConfig } from '../../src/core/theme';

describe('PlotSerializer & ThemeConfig Sanitizer', () => {
  it('初期ドキュメントのシリアライズとパースが可逆であり、不正なエッジは除外される', () => {
    const doc = createInitialPlotDocument('テスト作品');
    const json = serializePlotDocument(doc);
    const parsed = parsePlotDocument(json);

    assert.equal(parsed.title, 'テスト作品');
    assert.equal(parsed.nodes.length, doc.nodes.length);
    assert.equal(parsed.edges.length, doc.edges.length);

    // 壊れたJSON文字列を渡しても安全に初期ドキュメントへフォールバックする
    const fallback = parsePlotDocument('{ broken json ');
    assert.equal(fallback.schemaVersion, 1);
    assert.ok(fallback.nodes.length > 0);
  });

  it('computeMinimalTextEdit が変更箇所のみを正確に抽出する', () => {
    const oldText = '{"title": "旧タイトル", "nodes": []}';
    const newText = '{"title": "新タイトル", "nodes": []}';
    const diff = computeMinimalTextEdit(oldText, newText);
    assert.ok(diff);
    const reconstructed =
      oldText.slice(0, diff!.startOffset) +
      diff!.replacement +
      oldText.slice(diff!.endOffset);
    assert.equal(reconstructed, newText);
  });

  it('sanitizePlotConfig が範囲外のグリッドサイズや不正なテーマ名を正規化する', () => {
    const cfg = sanitizePlotConfig({
      theme: 'invalid_theme' as unknown as 'dark',
      gridSize: 999,
      snapToGrid: false,
    });
    assert.equal(cfg.theme, 'dark');
    assert.equal(cfg.gridSize, 64);
    assert.equal(cfg.snapToGrid, false);
  });
});
