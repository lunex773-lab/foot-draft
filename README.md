# FOOTBALL DRAFT

サッカー選手のドラフトとチーム編成で戦う、最大4人のオンライン対戦ゲーム。
モード：クイックドラフト・ランク戦（レーティング・月間シーズン・ランキング）・ソロ課題（日替わり）・イベント（期間限定の候補）・プライベートルーム。
設計書：`docs/` 配下（現状分析・開発計画・決定事項・SIM仕様・実装記録）。

![カード](docs/screenshots/cards.png)

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `packages/shared` | 型・選手データベースの取り込み・スネークドラフト・自動指名・編成・ケミストリー・試合SIM・リーグ順位・通信の型 |
| `data/player-db-v1` | 選手データベース（FOOTBALL DRAFT 300 Player Database v1：架空選手300人、SIM用19能力） |
| `assets/` | 配信用のカード画像（`cards/FD-001.png`〜`FD-300.png`：実写の肖像を入れたカード、または元画像にイラストの選手を描き込んだカード）とレアリティ別テンプレート。ゲーム・管理サイトの静的ファイルとして配信 |
| `tools/card-art` | カード画像を作るツール（実写の肖像の生成用の指示文・ダウンロード・カード作成、イラストの描き込み） |
| `packages/ui` | 選手カード（データベースのカード画像を表示）・国旗 |
| `apps/api` | ゲームのバックエンド。Cloudflare Workers（Hono）＋ D1 ＋ Durable Objects（`RoomDO`：ルーム・ドラフト・試合の進行をサーバーで確定） |
| `apps/web` | ゲーム本体（React＋Vite） |
| `apps/admin` | FOOTBALL DRAFT ADMIN（運営管理サイト。管理者専用認証） |

## ローカルで動かす

必要なもの：Node.js 20 以上（22推奨）

```bash
npm install

# 1. APIの準備（初回のみ）
cp apps/api/.dev.vars.example apps/api/.dev.vars   # WS_TICKET_SECRET をランダムな値に変更
npm run db:migrate:local                            # テーブル作成＋選手データベース（300人）を投入

# 2. 起動（それぞれ別のターミナルで）
npm run dev:api     # http://127.0.0.1:8787
npm run dev:web     # http://127.0.0.1:5173  ゲーム
npm run dev:admin   # http://127.0.0.1:5174  管理サイト

# 3. 管理者アカウントの作成（管理サイトを使う場合）
npm run admin:create:local -- --username あなたの管理者名
#   パスワード（12文字以上）を聞かれます。
#   表示される TOTP シークレット / otpauth URI を認証アプリ（Google Authenticator 等）に登録してください。
#   ローカル確認だけなら --no-totp で2段階認証なしのアカウントも作れます（ローカル限定）。
```

ゲームは `http://127.0.0.1:5173` で新規登録 → 「クイックドラフト」または「ルームを作成」。
1人でも開始でき、空席はCPUが埋めます。友だちとは招待コード・招待リンクで同じルームに入れます。

## 選手データの更新

1. `data/player-db-v1/players.json`・`simulation_attributes.json` と元のカード画像 `data/player-db-v1/cards/` を差し替える
   - 選手の外見：`npm run cards:appearance`（新しい選手の分を追加。既存の外見は保持）。個別に変えたい時は `data/player-db-v1/appearance.json` を編集
   - イラストのカード：`npm run cards:render`（Playwright＋Chromium と Python の Pillow・numpy が必要。`assets/cards/` に出力）
   - 実写の肖像：`npx tsx tools/card-art/src/list-prompts.ts` で肖像がまだない選手の指示文を表示 → Figma の画像生成で作成 → `python3 tools/card-art/fetch_portraits.py FD-074=<画像ID>@<ノードID> ...` で `data/player-db-v1/portraits/` に保存（画像URLは7日で切れる）
   - 実写カードの作成：`npm run cards:photo`（肖像がある選手のカードを `assets/cards/` に作り直す。Pillow と numpy が必要）。`npm run cards:render` は全カードをイラストで描いた後、肖像がある選手を実写カードに置き換える
2. `npm test -w @fd/shared`（取り込み検証：レアリティ・OVR帯・特殊能力・ポジション・画像ファイルの有無）
3. `npm run seed:generate` で D1 用のマイグレーションを作り直す（既に適用済みの環境には新しい番号のマイグレーションとして追加する）

## テスト

```bash
npm test -w @fd/shared          # 単体テスト（乱数・選手データ・ドラフト・編成・SIM・順位）
npm run sim:balance -- 150      # SIMのバランス検証（大量の自動試合）
npm run e2e -w @fd/api          # API起動中に実行：4人のWebSocketクライアントでリーグを1回通しで対戦＋Phase 3（ランク・ソロ・イベント・管理）
npm run e2e:phase3 -w @fd/api   # Phase 3 だけ
npm run typecheck
```

## 公開（Cloudflare）

GitHub Actions で Cloudflare に公開します（開発ブランチへのプッシュで staging に自動公開、production は承認制）。
手順・必要なシークレット・ワークフローの内容は `docs/06-deploy.md`。

## ドキュメント

- `docs/00-phase0-report.md` 現状分析
- `docs/01-dev-plan.md` 開発計画
- `docs/02-decisions.md` 決定事項・暫定値・提案中の事項
- `docs/03-sim.md` 試合シミュレーションの仕様とバランス検証結果
- `docs/04-implementation-log.md` 実装記録（実装済み・未実装・検証結果・既知の課題）
- `docs/05-phase3-plan.md` Phase 3（競争機能）の計画
- `docs/06-deploy.md` 公開手順（Cloudflare＋GitHub Actions）
