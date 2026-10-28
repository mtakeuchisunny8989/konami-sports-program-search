# コナミスポーツクラブ スタジオプログラム横断検索

コナミスポーツクラブ全施設の直近1週間のスタジオプログラムを、「日付」「プログラム名」
「担当インストラクター名」で横断検索できる非公式Webアプリです。

データ元: https://information.konamisportsclub.jp/ksc/search_program/ （公式ページ）

- このアプリは非公式のツールです。KONAMIグループとは無関係です。
- データは参考情報であり、正確性を保証しません。最新・正確な情報は必ず各施設の公式
  タイムテーブルをご確認ください。
- データ元サイトの[利用規約](https://www.konami.com/siteinfo/ja/)には、サイト内容の
  複製・転載・公衆送信等を無断で行うことを禁止する条項があります。このため本アプリは
  **検索エンジンに登録しない・URLを知る人のみがアクセスする前提の限定公開**として運用
  してください（`robots.txt`で全クローラーを拒否し、`<meta name="robots" content="noindex,nofollow">`
  も設定済みです)。リポジトリを完全非公開にしたい場合はGitHub Pagesを使わず、Private
  リポジトリ + ローカルサーバー、またはGitHub Pro/Team以上のPrivate Pages機能をご利用
  ください。

## 構成

```
.
├── scripts/
│   ├── collect.py          # データ収集スクリプト
│   └── requirements.txt
├── .github/workflows/
│   └── collect.yml         # 毎日5:00 JSTに自動収集してprograms.jsonを更新
├── data/
│   └── programs.json       # 収集したプログラムデータ(生成物)
├── index.html / app.js / style.css  # 検索Webアプリ本体(ビルド不要)
├── manifest.json / sw.js / icons/   # PWA対応
└── robots.txt
```

## データ収集スクリプトについて

`scripts/collect.py` は以下を行います。

1. 検索ページのHTMLに埋め込まれた `PREFECTURE_DATA` から都道府県・施設の対応表を取得
2. 都道府県・施設を指定せずに検索することで**全国一括の検索結果**を取得できることを
   利用し、結果ページ(1ページ30件)を1.5〜2.5秒間隔でページ送りしながら全件取得
   (公式UIは都道府県選択が必須に見えますが、検索結果ページ自体は空欄でも全国分を返します)
3. 各行の「施設名」「プログラム名」「スケジュール(日付・曜日・時刻・所要時間)」
   「担当(インストラクター名)」を正規化し、`data/programs.json` に保存
4. 取得に失敗したページはリトライ後にスキップし、`failed_pages` に記録

### ローカルでの実行

```bash
pip install -r scripts/requirements.txt

# 動作確認(数ページ=数施設分のみ取得)
python scripts/collect.py --max-pages 3

# 全件収集
python scripts/collect.py
```

出力は既定で `data/programs.json` です。`--out` で出力先を変更できます。

## GitHub Actionsでの自動更新

`.github/workflows/collect.yml` が毎日 5:00 JST (20:00 UTC) に自動実行され、
`data/programs.json` に変更があればリポジトリへコミット・pushします。

- 手動実行: GitHub の Actions タブから `Collect KONAMI programs` を
  `Run workflow` で手動起動できます（`max_pages` を指定すると件数を絞ってテスト可能）
- 初回のセットアップ時は、まず `max_pages` を小さい値にして手動実行し、正しく動くことを
  確認してから定期実行に任せることを推奨します

## GitHub Pagesでの公開手順

1. このリポジトリをGitHubにpush
2. `Settings > Pages` で `Deploy from a branch` を選択し、ブランチをルート(`/`)で指定
3. 公開後のURLは `https://<ユーザー名>.github.io/<リポジトリ名>/` になります
4. 上記の限定公開の注意事項を踏まえ、URLは必要な人にのみ共有してください
5. iPhoneのSafariでURLを開き、共有ボタン→「ホーム画面に追加」でアプリのように
   利用できます(PWA対応済み)

## Web アプリの仕様概要

- 対象日ボタン（直近1週間 + 全日）、プログラム名・インストラクター名の部分一致検索
  （ひらがな/カタカナ・全角半角・大小文字を区別しない）、都道府県・施設・開始時間帯の
  絞り込みをAND条件・入力中に即時反映
- 結果はカード表示（日付・曜日・時刻・プログラム名・担当・施設名）。施設名タップで
  公式施設ページを別タブで開く
- 並び順は「日付順」「施設順」を切り替え可能
- 検索条件は `localStorage` に保存し、次回アクセス時に復元
- ダークモード（`prefers-color-scheme`）対応、iOSでの自動ズームを防ぐ16px以上のフォント、
  44px以上のタップ領域

## 既知の制約

- 検索結果にはスタジオ名・定員・予約要否は含まれていません(データ元ページに情報なし)
- プログラムの日付には年が含まれないため、収集日を基準に「直近の未来の日付」として
  年を推定しています(年末年始をまたぐ場合のみ影響)
