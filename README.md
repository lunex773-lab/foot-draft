# FOOTBALL DRAFT

サッカー選手のドラフトとチーム編成で戦う、最大4人のオンライン対戦ゲーム。
設計書：`docs/` 配下（現状分析・開発計画・決定事項・SIM仕様・実装記録）。

![カード](docs/screenshots/cards.png)

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `packages/shared` | 型・選手データベースの取り込み・スネークドラフト・自動指名・編成・ケミストリー・試合SIM・リーグ順位・通信の型 |
| `data/player-db-v1` | 選手データベース（FOOTBALL DRAFT 300 Player Database v1：架空選手300人、SIM用19能力） |
| `assets/` | 配信用のカード画像（`cards/FD-001.png`〜`FD-300.png`：元画像に選手を描き込んだもの）とレアリティ別テンプレート。ゲーム・管理サイトの静的ファイルとして配信 |
| `tools/card-art` | カード画像に選手のイラスト（顔・ユニフォーム・エンブレム）を描き込むツール |
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
   - カード画像の描き込み：`npm run cards:render`（Playwright＋Chromium と Python の Pillow が必要。`assets/cards/` に出力）
2. `npm test -w @fd/shared`（取り込み検証：レアリティ・OVR帯・特殊能力・ポジション・画像ファイルの有無）
3. `npm run seed:generate` で D1 用のマイグレーションを作り直す（既に適用済みの環境には新しい番号のマイグレーションとして追加する）

## テスト

```bash
npm test -w @fd/shared          # 単体テスト（乱数・選手データ・ドラフト・編成・SIM・順位）
npm run sim:balance -- 150      # SIMのバランス検証（大量の自動試合）
npm run e2e -w @fd/api          # API起動中に実行：4人のWebSocketクライアントでリーグを1回通しで対戦
npm run typecheck
```

## デプロイ（未実施）

`apps/api/wrangler.toml` に dev / staging / production の環境を定義済み。デプロイ前に次が必要です。

1. 環境ごとに D1 データベースを作成し、`database_id` を設定（`wrangler d1 create football-draft-production` など）
2. `wrangler d1 migrations apply DB --remote --env <env>`
3. `wrangler secret put WS_TICKET_SECRET --env <env>`
4. `ALLOWED_ORIGINS` にゲーム・管理サイトの公開URLを設定し、`apps/web` / `apps/admin` をビルドして配信（`VITE_API_URL` にAPIのURL）
5. カード画像は各アプリの静的ファイルとして配信される。CDN / R2 に置く場合は `VITE_CARD_BASE_URL` にそのURLを設定
6. 試合SIMとCPUの自動指名はCPU時間を使うため、Workers は有料プランを推奨

## ドキュメント

- `docs/00-phase0-report.md` 現状分析
- `docs/01-dev-plan.md` 開発計画
- `docs/02-decisions.md` 決定事項・暫定値・提案中の事項
- `docs/03-sim.md` 試合シミュレーションの仕様とバランス検証結果
- `docs/04-implementation-log.md` 実装記録（実装済み・未実装・検証結果・既知の課題）
