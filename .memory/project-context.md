# Project Context & Invariants (永続コンテキスト)

> このファイルは、複数のAIエージェントによるオーケストレーション作業において、全エージェントが共有すべき不変の前提条件・設計原則を定義します。

## 1. プロジェクトの目的
VS Code 拡張機能 **「Node Plot (`node-plot`)」** の開発および VS Code Marketplace / GitHub 公開。
物語（小説・シナリオ）の構想・アイデアを付箋（ノード）として書き溜め、**名前付き・型付きの複数入出力ソケット（時系列フロー・登場人物・伏線提示/回収・前提アイテム）** とパラメータを用いて因果関係や構成を視覚的に構築・検証し、`genkou_sheet`（原稿執筆環境）へシームレスに橋渡しするプロットツールを構築する。

## 2. 絶対遵守の設計制約 (Hard Constraints)

1. **対象フォルダー限定動作・他プロジェクトへの非干渉:**
   * 通常のプログラミングプロジェクト等で `.json` や `.md` を開いた際に、勝手にプロットエディタが起動してはならない。
   * 専用拡張子 `.nplot`（実体は整形済み UTF-8 JSON）を対象とし、`package.json` の `customEditors.priority` は `"option"`（または `.nplot` 限定の関連付け）とし、`Node Plot: このフォルダーをプロットプロジェクトとして有効化` を実行したワークスペースでのみフル機能（サイドバーツリー・`genkou_sheet` 連携）を有効化する。
2. **スタイルのハードコード禁止（Global Theme 一元管理）:**
   * 各UIコンポーネントやCanvas/SVG描画処理内に色・フォント・余白・サイズ・角丸・影・ソケットカラーを直接ハードコードすることを禁じる。
   * 必ず `src/core/theme.ts` および `src/webview/styles/globalTheme.css` のデザイントークン（CSS Variables）を経由してスタイルを適用すること。
3. **Clean Architecture & 純粋ロジックの分離:**
   * グラフ構造検証・ソケット型互換性チェック（`src/core/graphEngine.ts`）、トポロジカルソート・未回収伏線検出・テンション集計（`src/core/plotAnalyzer.ts`）、シリアライズ・マイグレーション（`src/core/serializer.ts`）は VS Code API や DOM に依存しない純粋な TypeScript として実装し、単体テストで100%検証可能にすること。
4. **過度な抽象化の禁止 (Simplicity First):**
   * 外部の重量級UIフレームワークや巨大なグラフライブラリに依存せず、軽量・高速で保守しやすい疎結合コンポーネントとして実装すること。

## 3. ドキュメント参照マップ
* 要件定義: [docs/requirements/requirements.md](../docs/requirements/requirements.md)
* アーキテクチャ仕様: [docs/specs/architecture.md](../docs/specs/architecture.md)
* ノードグラフ・物語プロット仕様: [docs/specs/node-graph-and-plot.md](../docs/specs/node-graph-and-plot.md)
* Marketplace/GitHub公開仕様: [docs/specs/publishing.md](../docs/specs/publishing.md)
* 意思決定記録 (ADR): [.memory/decisions.md](./decisions.md)
* タスク・検証管理ボード: [.memory/tasks.md](./tasks.md)
* 引き継ぎログ: [.memory/handoff.md](./handoff.md)
