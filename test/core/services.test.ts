import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { diffPlotDocuments } from '../../src/core/plotDiff';
import { createInitialPlotDocument } from '../../src/core/serializer';
import { BackupStore, matchesSavedFile } from '../../src/services/backupService';
import {
  generateMarkdownOutline,
  resolveSafeManuscriptPath,
  syncSceneOrderToGenkouFile,
} from '../../src/services/exportService';
import {
  disablePlotFolderOnDisk,
  enablePlotFolderOnDisk,
  isPlotFolderEnabledOnDisk,
} from '../../src/services/workspaceService';

const MIN = 60_000;

describe('Services (対象フォルダー管理・BackupStore・比較差分・Markdown出力・Genkou連携)', () => {
  it('対象フォルダーの有効化で .nplot.json と story.nplot が生成され、解除で無効化される', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node_plot_ws_'));
    try {
      assert.equal(isPlotFolderEnabledOnDisk(tmpDir), false);
      const res = enablePlotFolderOnDisk(tmpDir, true);
      assert.equal(isPlotFolderEnabledOnDisk(tmpDir), true);
      assert.ok(fs.existsSync(res.manifestPath));
      assert.ok(res.samplePlotPath && fs.existsSync(res.samplePlotPath));

      disablePlotFolderOnDisk(tmpDir);
      assert.equal(isPlotFolderEnabledOnDisk(tmpDir), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('BackupStore が間隔内の上書き・新世代作成・forceNewSnapshot・上限削除・一覧取得を正しく行う', () => {
    const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'node_plot_bk_'));
    try {
      const store = new BackupStore(tmpStorage);
      const uri = 'file:///workspace/story.nplot';
      const opts = { maxSnapshots: 2, snapshotIntervalMs: 5 * MIN };
      const t0 = 1_700_000_000_000;

      assert.equal(store.write(uri, 'story.nplot', '{"v":1}', { ...opts, now: t0 }), true);
      // 1分後の変更は同一世代を上書き
      store.write(uri, 'story.nplot', '{"v":2}', { ...opts, now: t0 + MIN });
      let snaps = store.listSnapshots(uri);
      assert.equal(snaps.length, 1);
      assert.equal(store.readSnapshot(snaps[0]), '{"v":2}');

      // 同一内容は書き込まない
      assert.equal(store.write(uri, 'story.nplot', '{"v":2}', { ...opts, now: t0 + 2 * MIN }), false);

      // 6分後の変更は新世代を作成
      store.write(uri, 'story.nplot', '{"v":3}', { ...opts, now: t0 + 6 * MIN });
      snaps = store.listSnapshots(uri);
      assert.equal(snaps.length, 2);

      // forceNewSnapshot は間隔内でも新世代を作り、maxSnapshots(2) を超えた古い世代を削除
      store.write(uri, 'story.nplot', '{"v":4}', {
        ...opts,
        now: t0 + 7 * MIN,
        forceNewSnapshot: true,
      });
      snaps = store.listSnapshots(uri);
      assert.equal(snaps.length, 2);
      assert.deepEqual(
        snaps.map((s) => store.readSnapshot(s)),
        ['{"v":4}', '{"v":3}']
      );

      const entries = store.listEntries();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].displayName, 'story.nplot');
    } finally {
      fs.rmSync(tmpStorage, { recursive: true, force: true });
    }
  });

  it('matchesSavedFile と diffPlotDocuments が保存済み判定とノード差分を正確に返す', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node_plot_saved_'));
    try {
      const f = path.join(tmpDir, 'story.nplot');
      fs.writeFileSync(f, 'saved-content', 'utf-8');
      assert.equal(matchesSavedFile(f, 'saved-content'), true);
      assert.equal(matchesSavedFile(f, 'unsaved-content'), false);
      assert.equal(matchesSavedFile(path.join(tmpDir, 'missing.nplot'), ''), false);

      const docA = createInitialPlotDocument('A');
      const docB = createInitialPlotDocument('B');
      docB.nodes[0] = { ...docB.nodes[0], title: '変更後の主人公名' };
      const diff = diffPlotDocuments(docA, docB);
      assert.equal(diff.changedCount, 1);
      assert.ok(diff.leftChangedNodeIds.has(docA.nodes[0].id));
      assert.ok(diff.rightChangedNodeIds.has(docB.nodes[0].id));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Markdown構成案の生成と .genkou.json への原稿順序同期、安全なパス解決が機能する', () => {
    const doc = createInitialPlotDocument('時計塔の謎');
    const md = generateMarkdownOutline(doc);
    assert.ok(md.includes('# 時計塔の謎'));
    assert.ok(md.includes('主人公：アキラ'));
    assert.ok(md.includes('1. [第1章] 発端：工房に残された銀時計'));
    assert.ok(md.includes('2. [第3章] 転機：時計塔の最上階'));
    assert.ok(md.includes('伏線：逆回りする銀時計'));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'node_plot_genkou_'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.genkou.json'),
        JSON.stringify({ order: ['99_epilogue.txt'] }),
        'utf8'
      );
      const synced = syncSceneOrderToGenkouFile(tmpDir, doc);
      assert.deepEqual(synced.orderedFiles, [
        '01_opening.txt',
        '03_climax.txt',
        '99_epilogue.txt',
      ]);

      assert.equal(resolveSafeManuscriptPath(tmpDir, '../outside.txt'), null);
      assert.ok(resolveSafeManuscriptPath(tmpDir, 'chapters/01_opening.txt'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
