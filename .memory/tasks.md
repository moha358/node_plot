# Task Board & Multi-Agent Orchestration Plan (タスク・検証管理)

> 複数のAIエージェント（オーケストレーター／サブエージェント）で分担・並列実装できるよう、ファイル責務（Ownership）と検証基準（Verification Criteria）を定義しています。

## ステータス凡例
* `[x]` 完了 (Completed)
* `[-]` 進行中 (In Progress) — 担当エージェント名を記載すること
* `[ ]` 未着手 (Todo)

---

## Phase 0: 要件定義・仕様策定・永続メモリー構築
* `[x]` **T0-1: 要件定義書・技術仕様書の作成** (`docs/requirements/`, `docs/specs/`)
  * **Verify:** 物語向けマルチソケット（B案）、パラメータ、キャンバス操作、`genkou_sheet` 連携の仕様が網羅されていること。
* `[x]` **T0-2: マルチAI用永続メモリー・ガイドラインの配置** (`AGENTS.md`, `.memory/`)
  * **Verify:** エージェント起動手順、ADR、フェーズ別タスクとVerify基準が明文化されていること。

---

## Phase 1: プロジェクト基盤 & Core ドメインロジック実装
* `[x]` **T1-1: VS Code 拡張機能プロジェクト初期化 & ビルド構成**
  * **担当スコープ:** `package.json`, `tsconfig.json`, `esbuild.js`, `.vscodeignore`, `.gitignore`
  * **Verify:** `npm run compile` および `npm run build` がエラーなく成功し、`dist/extension.js` と `dist/webview.js` が生成されることを確認済み。

* `[x]` **T1-2: Core グラフエンジン・プロット解析・シリアライザ・グローバルテーマ定義**
  * **担当スコープ:**
    * `src/core/types.ts` (ノード・ソケット・エッジ・パラメータ・通信メッセージ型定義)
    * `src/core/theme.ts` (グローバルテーマ定義・ソケット型カラー・設定値サニタイズ)
    * `src/core/graphEngine.ts` (ノード/エッジCRUD、型付きソケット接続検証、サイクル検出、接続トレース抽出)
    * `src/core/plotAnalyzer.ts` (時系列トポロジカルソート、未回収伏線検出、キャラ登場集計、テンション曲線データ算出)
    * `src/core/serializer.ts` (`.nplot` JSON パース・バリデーション・初期テンプレート生成・最小差分計算)
    * `test/core/*.test.ts`
  * **Verify:** 単体テスト（`npm test`）でソケット型不一致の拒否、自己ループ/循環フロー検出、未回収伏線リスト抽出、時系列順ソート、不正JSONからの安全なフォールバックがすべてパスすることを確認済み。

---

## Phase 2: 対象フォルダー限定機構 & VS Code Providers (Host側)
* `[x]` **T2-1: 対象フォルダー管理 & バックアップサービス**
  * **担当スコープ:** `src/services/workspaceService.ts`, `src/services/backupService.ts`
  * **Verify:** 有効化コマンドで `.nplot.json` とサンプル `.nplot` が構成され、解除で元に戻ること。自動バックアップが `globalStorageUri` に世代保存されることを単体テストで確認済み。

* `[x]` **T2-2: CustomEditorProvider・サイドバー構成ツリー・`genkou_sheet` 連携出力サービス**
  * **担当スコープ:**
    * `src/providers/plotEditorProvider.ts` (`CustomTextEditorProvider` 実装・Document双方向同期)
    * `src/providers/plotOutlineTreeProvider.ts` (サイドバーでの時系列シーン一覧・未回収伏線ツリー表示)
    * `src/providers/statusBarProvider.ts` (ノード数・シーン数・未回収伏線数のステータスバー表示)
    * `src/services/exportService.ts` (Markdown構成案出力、シーンからの原稿ファイル生成・オープン、`.genkou.json` 順序同期)
  * **Verify:** 型チェックおよび構成案出力・`.genkou.json` 連携の単体テストがすべてパスすることを確認済み。

---

## Phase 3: ノードキャンバス Webview UI & インタラクション実装
* `[x]` **T3-1: グローバルテーマCSS & 無限キャンバス・エッジ（ベジェ曲線）描画エンジン**
  * **担当スコープ:**
    * `src/webview/styles/globalTheme.css`
    * `src/webview/components/CanvasViewport.ts` (パン・ズーム・グリッド背景・フレーム領域)
    * `src/webview/components/EdgeRenderer.ts` (SVGベジェ曲線描画・ソケット型別カラー・破線/実線・ラベル・ドラッグ中の仮ワイヤー描画)
    * `src/webview/components/Toolbar.ts` (ノード追加・フィルタ・ビュー切替・テーマ切替・構成案出力ボタン)
  * **Verify:** スタイルのハードコードなしでキャンバス移動・拡縮・ベジェ曲線描画が動作することを確認済み。

* `[x]` **T3-2: マルチソケット付箋ノードUI・パラメータインスペクタ・アウトラインビュー統合**
  * **担当スコープ:**
    * `src/webview/components/NodeCard.ts` (付箋ノード描画、名前付き入出力ソケット端子、メモ→シーン等の昇格操作)
    * `src/webview/components/InspectorPanel.ts` (選択ノードのパラメータ編集、カスタムKey-Value追加、カスタムソケット追加、テンション値スライダー、原稿ファイルリンク操作)
    * `src/webview/components/OutlinePanel.ts` (時系列順リスト表示 & テンション曲線グラフ & 未回収伏線チェッカー)
    * `src/webview/components/InteractionController.ts` (ノード選択・ドラッグ移動・ソケット接続ドラッグ・関連ノードハイライト・ショートカット制御)
    * `src/webview/index.ts`, `src/extension.ts`
  * **Verify:** 拡張機能全体のビルドが通り、ノード作成・ソケット接続・パラメータ変更・関連ハイライトが `TextDocument` に同期する実装を完了。

---

## Phase 4: 検証・公開準備（パッケージング・ドキュメント整備）
* `[x]` **T4-1: README / CHANGELOG / LICENSE / アイコン整備 & パッケージ検証**
  * **担当スコープ:** `README.md`, `CHANGELOG.md`, `LICENSE`, `assets/`, `docs/validation/release-check.md`, `test/build/bundle.test.cjs`
  * **Verify:** `npm run build`、`npm test`（13件）、`npm run test:bundle`（2件）がすべてパスし、150ノード規模の長編プロットデータで高速に動作することを確認済み。
