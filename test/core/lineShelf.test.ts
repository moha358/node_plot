import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { removeNodes } from '../../src/core/graphEngine';
import {
  addLineCandidate,
  addLines,
  computeLineStats,
  createLine,
  detachLineFromScene,
  findCharacterByName,
  findSceneByManuscriptFile,
  getLineStatus,
  groupLinesBySpeaker,
  parseLineCaptureText,
  parseSpeakerSwitch,
  placeLine,
  removeLine,
  speakerDisplayName,
  summarizeSceneLines,
  unplaceLine,
  updateLine,
} from '../../src/core/lineShelf';
import {
  createInitialPlotDocument,
  parsePlotDocument,
  serializePlotDocument,
} from '../../src/core/serializer';
import { PlotDocument } from '../../src/core/types';

const HERO = 'node_char_hero';
const S1 = 'node_scene_1';
const S2 = 'node_scene_2';

function docWithLine(): { doc: PlotDocument; id: string } {
  const line = createLine({ id: 'l1', speakerId: HERO, text: '師匠は、まだ生きてる' });
  return { doc: addLines(createInitialPlotDocument(), [line]), id: line.id };
}

describe('セリフ棚（書き溜めセリフ）', () => {
  it('lines を持たない既存ファイルは読み書きしても lines キーを増やさない', () => {
    const base = createInitialPlotDocument();
    const reparsed = parsePlotDocument(serializePlotDocument(base));
    assert.equal(reparsed.lines, undefined);
    assert.equal('lines' in JSON.parse(serializePlotDocument(reparsed)), false);
  });

  it('lines を往復でき、不正な要素・重複 ID・空テキストは除外し、参照先の無い ID は保持する', () => {
    const raw = {
      ...createInitialPlotDocument(),
      lines: [
        { id: 'a', speakerId: HERO, text: 'ひとこと', note: '小声', candidateSceneIds: [S1, S1, S2], placedSceneId: S2 },
        { id: 'a', speakerId: HERO, text: '重複' },
        { id: 'b', text: '   ' },
        'garbage',
        { id: 'c', speakerId: 'gone', text: '迷子', candidateSceneIds: ['missing'] },
      ],
    };
    const doc = parsePlotDocument(JSON.stringify(raw));
    assert.deepEqual(doc.lines, [
      { id: 'a', speakerId: HERO, text: 'ひとこと', note: '小声', candidateSceneIds: [S1], placedSceneId: S2 },
      { id: 'c', speakerId: 'gone', text: '迷子', note: '', candidateSceneIds: ['missing'] },
    ]);
    const again = parsePlotDocument(serializePlotDocument(doc));
    assert.deepEqual(again.lines, doc.lines);
  });

  it('候補追加 → 確定 → 別シーンへ確定 → 取り消しの遷移で状態が導出される', () => {
    let { doc, id } = docWithLine();
    const scenes = new Set([S1, S2]);
    const line = () => doc.lines!.find((l) => l.id === id)!;
    assert.equal(getLineStatus(line(), scenes), 'unplaced');

    doc = addLineCandidate(doc, id, S1);
    doc = addLineCandidate(doc, id, S1);
    assert.deepEqual(line().candidateSceneIds, [S1]);
    assert.equal(getLineStatus(line(), scenes), 'candidate');

    doc = placeLine(doc, id, S1);
    assert.equal(line().placedSceneId, S1);
    assert.deepEqual(line().candidateSceneIds, []);
    assert.equal(getLineStatus(line(), scenes), 'placed');

    // 確定先を移すと元の確定先は候補として残る
    doc = placeLine(doc, id, S2);
    assert.equal(line().placedSceneId, S2);
    assert.deepEqual(line().candidateSceneIds, [S1]);

    // 確定済みシーンは候補に重複追加されない
    doc = addLineCandidate(doc, id, S2);
    assert.deepEqual(line().candidateSceneIds, [S1]);

    doc = unplaceLine(doc, id);
    assert.equal(line().placedSceneId, undefined);
    assert.deepEqual(line().candidateSceneIds, [S1, S2]);

    doc = detachLineFromScene(doc, id, S1);
    doc = detachLineFromScene(doc, id, S2);
    assert.equal(getLineStatus(line(), scenes), 'unplaced');
  });

  it('存在しないシーンへの配置は無効（未配置）として扱う', () => {
    const line = createLine({ text: 'x' });
    line.placedSceneId = 'deleted';
    line.candidateSceneIds = ['deleted2'];
    assert.equal(getLineStatus(line, new Set([S1])), 'unplaced');
  });

  it('ノード削除でシーン配置は外れて棚に戻り、話者削除のセリフは話者未定として残る', () => {
    let { doc, id } = docWithLine();
    doc = placeLine(addLineCandidate(doc, id, S2), id, S1);
    doc = addLineCandidate(doc, id, S2);
    doc = removeNodes(doc, [S1, HERO]);
    const line = doc.lines!.find((l) => l.id === id)!;
    assert.equal(line.speakerId, '');
    assert.equal(line.placedSceneId, undefined);
    assert.deepEqual(line.candidateSceneIds, [S2]);
    assert.equal(line.text, '師匠は、まだ生きてる');
  });

  it('シーン別の集計・話者別の列・全体統計を算出する', () => {
    let doc = addLines(createInitialPlotDocument(), [
      createLine({ id: 'a', speakerId: HERO, text: 'A' }),
      createLine({ id: 'b', speakerId: HERO, text: 'B' }),
      createLine({ id: 'c', text: 'C' }),
    ]);
    doc = placeLine(doc, 'a', S1);
    doc = addLineCandidate(doc, 'b', S1);
    doc = addLineCandidate(doc, 'b', S2);

    const summary = summarizeSceneLines(doc);
    assert.deepEqual(summary.get(S1)!.placed.map((l) => l.id), ['a']);
    assert.deepEqual(summary.get(S1)!.candidates.map((l) => l.id), ['b']);
    assert.deepEqual(summary.get(S2)!.candidates.map((l) => l.id), ['b']);

    const cols = groupLinesBySpeaker(doc);
    assert.equal(cols[0].speaker?.id, HERO);
    assert.deepEqual(cols[0].lines.map((l) => l.id), ['a', 'b']);
    assert.equal(cols[cols.length - 1].speaker, null);
    assert.deepEqual(cols[cols.length - 1].lines.map((l) => l.id), ['c']);

    assert.deepEqual(computeLineStats(doc), { total: 3, placed: 1, candidate: 1, unplaced: 1 });
  });

  it('更新・削除・空テキストの追加無視', () => {
    let { doc, id } = docWithLine();
    doc = updateLine(doc, id, { text: '書き直し', note: '震え声' });
    assert.equal(doc.lines![0].text, '書き直し');
    assert.equal(doc.lines![0].note, '震え声');
    assert.equal(addLines(doc, [createLine({ text: '  ' })]), doc);
    doc = removeLine(doc, id);
    assert.deepEqual(doc.lines, []);
  });

  it('名前表記からキャラクターを探し、表示名から肩書きを除く', () => {
    const doc = createInitialPlotDocument();
    const chars = doc.nodes.filter((n) => n.category === 'character');
    assert.equal(findCharacterByName('アキラ', chars)?.id, HERO);
    assert.equal(findCharacterByName('主人公：アキラ', chars)?.id, HERO);
    assert.equal(findCharacterByName('アキ', chars)?.id, HERO); // 一意な部分一致
    assert.equal(findCharacterByName('ミナト', chars), null);
    assert.equal(speakerDisplayName(chars[0]), 'アキラ');
    assert.equal(speakerDisplayName(null), '話者未定');
  });

  it('まとめ書きテキストを話者付きセリフに分解する', () => {
    const chars = createInitialPlotDocument().nodes.filter((n) => n.category === 'character');
    const parsed = parseLineCaptureText(
      [
        '@アキラ 師匠は、まだ生きてる',
        '',
        'アキラ「針が、逆に回ってる」（独り言）',
        '「続けて話者を引き継ぐ」 // 小声で',
        'アキラ：コロン区切り',
        '@ミナト',
        '未登録の話者のセリフ',
        'そうだ「名前でない語＋鉤括弧」',
      ].join('\n'),
      chars
    );
    assert.deepEqual(
      parsed.map((p) => [p.speakerId, p.text, p.note]),
      [
        [HERO, '師匠は、まだ生きてる', ''],
        [HERO, '針が、逆に回ってる', '独り言'],
        [HERO, '続けて話者を引き継ぐ', '小声で'],
        [HERO, 'コロン区切り', ''],
        // 話者指定・鉤括弧始まりでない行は直前のセリフの続き（セリフ内の改行）
        ['', '未登録の話者のセリフ\nそうだ「名前でない語＋鉤括弧」', '話者: ミナト'],
      ]
    );
  });

  it('話者指定の無い行は既定の話者になる', () => {
    const chars = createInitialPlotDocument().nodes.filter((n) => n.category === 'character');
    const parsed = parseLineCaptureText('ただの一言', chars, HERO);
    assert.deepEqual(parsed, [{ speakerId: HERO, text: 'ただの一言', note: '' }]);
  });

  it('原稿ファイルのパスから対応するシーンを探す', () => {
    const doc = createInitialPlotDocument();
    assert.equal(findSceneByManuscriptFile(doc, '01_opening.txt')?.id, S1);
    assert.equal(findSceneByManuscriptFile(doc, './01_opening.txt')?.id, S1);
    assert.equal(findSceneByManuscriptFile(doc, 'chapters/03_climax.txt')?.id, S2); // ファイル名一致
    assert.equal(findSceneByManuscriptFile(doc, '../01_opening.txt'), null);
    assert.equal(findSceneByManuscriptFile(doc, 'unknown.txt'), null);
  });

  it('@名前 だけの入力を話者切り替えとして解釈する', () => {
    const chars = createInitialPlotDocument().nodes.filter((n) => n.category === 'character');
    assert.equal(parseSpeakerSwitch('@アキラ', chars), HERO);
    assert.equal(parseSpeakerSwitch('＠ミナト', chars), '');
    assert.equal(parseSpeakerSwitch('@アキラ 本文あり', chars), undefined);
  });

  it('Shift+Enter の改行は同じセリフ内に残し、空行・話者指定・鉤括弧始まりでだけ区切る', () => {
    const chars = createInitialPlotDocument().nodes.filter((n) => n.category === 'character');
    const parsed = parseLineCaptureText(
      [
        'あのさ',
        'やっぱり、なんでもない // 言いかけてやめる',
        '',
        '二つ目は空行のあと',
        '「三つ目は鉤括弧始まり',
        '　改行しても続く」（小声）',
        '@アキラ 四つ目',
        'その続き',
      ].join('\n'),
      chars,
      HERO
    );
    assert.deepEqual(
      parsed.map((p) => [p.text, p.note]),
      [
        ['あのさ\nやっぱり、なんでもない', '言いかけてやめる'],
        ['二つ目は空行のあと', ''],
        ['三つ目は鉤括弧始まり\n改行しても続く', '小声'],
        ['四つ目\nその続き', ''],
      ]
    );
  });
});
