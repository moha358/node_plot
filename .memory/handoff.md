# Multi-Agent Handoff & Session State (引き継ぎ・最新状態ログ)

> 各エージェントは作業開始時にこのファイルを読み、作業終了時（またはフェーズ完了時）に必ず最新状態を更新してください。

## 現在のステータス
* **現在フェーズ:** Phase 0〜Phase 4 実装・単体テスト・バンドル検証 完了
* **最終更新:** 2026-11-15
* **ビルド状態:** `npm run build` 成功（`dist/extension.js` 34KB, `dist/webview.js` 55KB, `dist/globalTheme.css` 13KB）
* **テスト状態:** `npm test`（4スイート・13テスト PASS）、`npm run test:bundle`（2テスト PASS）

## 実装完了モジュール一覧
1. **Core 領域 (`src/core/`):**
   * `types.ts`: ノード種別（`note`, `scene`, `character`, `foreshadow`, `world_item`）、4種ソケット型（`flow`, `character`, `foreshadow`, `item`）、パラメータ、通信プロトコル型定義。
   * `theme.ts`: グローバルテーマ定義、ソケット型・ノード種別メタデータ、設定値サニタイザ。
   * `graphEngine.ts`: 付箋から構造化ノードへの昇格（`promoteNodeCategory`）、型安全なソケット接続検証（`canConnectSockets` / `connectSockets`）、カスタムソケット追加、関連トレースサブグラフ抽出。
   * `plotAnalyzer.ts`: 時系列トポロジカルソート（`computeSceneOrder`）、未回収伏線チェッカー（`detectUnresolvedForeshadows`）、テンション推移曲線算出（`computeTensionCurve`）。
   * `serializer.ts`: `.nplot` JSON パース・正規化、サンプル初期プロット生成、最小テキスト差分算出（`computeMinimalTextEdit`）。
2. **Services & Providers 領域 (`src/services/`, `src/providers/`, `src/extension.ts`):**
   * `workspaceService.ts`: 対象フォルダー有効化・解除（`.nplot.json` 管理、サンプル `story.nplot` 自動生成）。
   * `backupService.ts`: `globalStorageUri/backups/` への自動世代バックアップ。
   * `exportService.ts`: 時系列順の構成案（Markdown）出力、`.genkou.json` への原稿順序同期、パストラバーサル防止付きの原稿ファイル解決。
   * `plotEditorProvider.ts`: `CustomTextEditorProvider` 実装、CSP (`nonce`) 適用、`TextDocument` 双方向同期、`genkou_sheet` との原稿オープン連携。
   * `plotOutlineTreeProvider.ts` / `statusBarProvider.ts`: サイドバーでの時系列シーン・未回収伏線・登場人物ツリー表示、ステータスバー集計。
3. **Webview UI 領域 (`src/webview/`):**
   * `styles/globalTheme.css`: CSS Variables による一元管理スタイル（Dark / Light / Sepia テーマ、セマンティックズーム、関連トレース減光）。
   * `components/Toolbar.ts`, `CanvasViewport.ts`, `EdgeRenderer.ts`, `NodeCard.ts`, `InspectorPanel.ts`, `OutlinePanel.ts`, `InteractionController.ts`, `index.ts`.

## 次のステップ
* VS Code の Extension Development Host（F5）または VSIX パッケージ化による実機確認、および必要に応じた UI 微調整。
