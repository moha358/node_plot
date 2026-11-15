# 検証記録 (Validation & Release Check)

## 1. ビルド・バンドルサイズ検証 (2026-11-15)
* `npm run build` (`tsc --noEmit && node esbuild.js --production`): 成功
* 生成物サイズ:
  * `dist/extension.js`: 34 KB
  * `dist/webview.js`: 55 KB
  * `dist/globalTheme.css`: 13 KB

## 2. 自動テスト検証 (`npm test` / `npm run test:bundle`)
* **Core 単体テスト (4スイート・13テストケース PASS):**
  * `test/core/graphEngine.test.ts`: `note` → `scene` 等のノード昇格、4種ソケット型 (`flow`, `character`, `foreshadow`, `item`) の型安全性・方向検証、カスタムソケット追加、伏線チェーンを含む関連サブグラフ抽出。
  * `test/core/plotAnalyzer.test.ts`: 時系列トポロジカルソート、循環フロー検知時の安全なフォールバック、未回収伏線の自動検出、テンション曲線算出、150ノード規模の長編プロットでの高速解析（約 1.0ms）。
  * `test/core/serializer.test.ts`: `.nplot` JSON の可逆シリアライズ、破損データからのフォールバック、最小差分置換 (`computeMinimalTextEdit`)、設定値サニタイズ。
  * `test/core/services.test.ts`: 対象フォルダー有効化・解除、自動バックアップの世代管理、Markdown構成案出力、`.genkou.json` 原稿順序同期、パストラバーサル防止。
* **バンドル検証テスト (`test/build/bundle.test.cjs` 2テストケース PASS):**
  * `dist/extension.js` のロードおよび `nodePlot.editor` / `nodePlot.outlineTree` / 全コマンド登録を確認。
