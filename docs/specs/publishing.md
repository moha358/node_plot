# Marketplace・GitHub 公開仕様書 (Publishing & Release Specification)

## 1. 公開ターゲット
1. **Visual Studio Code Marketplace**（および Open VSX Registry 対応構成）
2. **GitHub Public Repository**（OSSとして公開）

---

## 2. `package.json` 必須メタデータ仕様

Marketplace 公開審査および検索性（SEO）を満たすため、`package.json` に以下のフィールドを完備する。

```json
{
  "name": "node-plot",
  "displayName": "Node Plot - 物語プロット＆アイデア構築ノードエディタ",
  "description": "小説・シナリオの構想やアイデアを付箋ノードとして書き溜め、時系列・登場人物・伏線の提示と回収をマルチソケットで視覚的に繋いで構成できるVS Code拡張機能。Genkou Sheet（原稿用紙エディタ）連携対応。",
  "version": "0.1.2",
  "publisher": "moha358",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "activationEvents": [
    "workspaceContains:.nplot.json",
    "workspaceContains:.genkou.json"
  ],
  "categories": [
    "Other"
  ],
  "keywords": [
    "novel",
    "plot",
    "story",
    "node-editor",
    "writing",
    "小説",
    "プロット",
    "シナリオ",
    "執筆"
  ],
  "icon": "assets/icon.png",
  "repository": {
    "type": "git",
    "url": "https://github.com/moha358/node_plot.git"
  }
}
```

---

## 3. パッケージング・バンドル戦略

* **バンドラ:** `esbuild` を使用し、Extension Host 用スクリプト（`dist/extension.js`）と Webview 用スクリプト（`dist/webview.js`）を単一バンドル化する。
* **ランタイム依存ゼロ:** `node_modules` を `.vsix` に同梱せず、インストールサイズを 500KB 未満に抑える。
* **型定義の固定:** `@types/vscode` は `engines.vscode` と同じ下限（`~1.85.0`）に固定する。
* **`.vscodeignore` 設計:**
  * `.memory/`、`docs/`、`src/`、`test/`、設定ファイル群を `.vsix` パッケージから除外し、`dist/`、`assets/`、`README.md`、`CHANGELOG.md`、`LICENSE` のみをパッケージに含める。

---

## 4. セキュリティおよび品質要件

1. **厳格な Content Security Policy (CSP):**
   Webview HTML では `nonce` ベースのスクリプト実行のみを許可し、外部ネットワーク接続を完全に遮断する。
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
   ```
2. **他プロジェクトへの非干渉保証:**
   カスタムエディタの対象は専用拡張子 `*.nplot` のみとし、既存の `.json` や `.md` のエディタ関連付けには一切触れない。
3. **データの安全性とサニタイズ:**
   `.nplot` ファイルおよびワークスペース設定値は信頼できない入力として扱い、`src/core/serializer.ts` と `src/core/theme.ts` で正規化・型検証を通過したデータのみを扱う。
