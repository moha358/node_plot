# Changelog

All notable changes to the "node-plot" extension will be documented in this file.

## [0.1.0] - 2026-11-15

### Added
- 物語向けマルチソケット（B案：`flow` / `character` / `foreshadow` / `item`）を備えたカスタムノードエディタ（`.nplot`）の実装。
- 5種のノードテンプレート（メモ付箋・シーン・キャラクター・伏線/謎・設定/アイテム）とワンクリック昇格機能。
- シーン専用パラメータ（章・作中時間・視点・感情テンション `-5〜+5`・原稿ファイルリンク）および自由 `Key: Value` パラメータ追加機能。
- 時系列トポロジカルソート、テンション推移曲線グラフ、未回収伏線チェッカー、関連トレース強調表示機能。
- Markdown 構成案エクスポート、`Genkou Sheet`（`.genkou.json`）への原稿順序同期、原稿ファイル直接オープン機能。
- 対象フォルダー限定有効化機構および `globalStorageUri` への自動世代バックアップ・復元機能。
