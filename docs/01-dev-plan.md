# 開発計画（今回の範囲：Phase 1＋Phase 2＋管理画面カード一覧）

## 1. 構成

```
foot-draft/
├─ packages/
│  ├─ shared/   # 型・定数・乱数・選手生成・ドラフト・編成・ケミストリー・SIM・リーグ（クライアントとサーバーで共用）
│  └─ ui/       # React 部品：選手カード（データベースのカード画像）・国旗
├─ apps/
│  ├─ api/      # Cloudflare Workers（Hono）＋ D1 ＋ Durable Objects（RoomDO：ルーム・ドラフト・試合進行）
│  ├─ web/      # ゲーム本体（React＋Vite）
│  └─ admin/    # FOOTBALL DRAFT ADMIN（React＋Vite、管理者専用認証）
└─ docs/
```

- 3領域の分離（設計書 19-2）：Game Client＝`apps/web`、Game Backend＝`apps/api`、Admin Platform＝`apps/admin`。
  管理サイトは必ず `apps/api` の `/api/admin/*` を通してデータを扱い、データベースに直接書き込まない。
- サーバー権威：ドラフトの指名判定・自動指名・試合のシミュレーション・順位は、すべて `RoomDO`（サーバー）で確定する。
  クライアントは表示と入力だけを担当する。
- 環境（設計書 19-3）：`wrangler.toml` に local / dev / staging / production を分けて定義し、D1・Secrets を環境ごとに分ける。

## 2. 機能ごとの計画

| 機能 | 新規ファイル | DB | API | UI | テスト | 完了条件 |
| --- | --- | --- | --- | --- | --- | --- |
| 乱数・シード | shared/rng.ts | - | - | - | 同一シードで同一数列 | テスト合格 |
| 選手DB（データベースv1・300人） | data/player-db-v1, shared/players/* | player_cards, player_attributes, player_positions, player_traits | GET /api/players | カード一覧 | 人数・レアリティ帯・元データとの一致 | D1に投入され管理画面に表示 |
| 選手カード | ui/PlayerCard（データベースのPNG） | - | - | 全画面 | スクリーンショット確認 | 全カード画像が表示される |
| アカウント | api/auth.ts | users, user_sessions | /api/auth/register・login・logout, /api/users/me | ログイン画面 | 登録・ログイン・不正パスワード | 結合テスト合格 |
| ルーム | api/rooms.ts, RoomDO | rooms, room_members | /api/rooms, /api/rooms/join, /api/rooms/quick, /api/rooms/:id | ロビー | 4人参加・満員拒否 | 4人で同じルームに入れる |
| Snake Draft | shared/draft.ts, RoomDO | drafts, draft_picks | WebSocket, POST /api/drafts/:id/pick, GET /api/drafts/:id/state | ドラフト画面 | 56回・重複なし・GK上限・時間切れ自動指名 | 結合テスト合格 |
| 編成・戦術 | shared/lineup.ts, chemistry.ts | match_teams | WebSocket | 編成画面 | 自動編成・入力検証 | 編成が試合に反映される |
| SIM | shared/sim/* | matches, match_events, match_statistics, match_results | GET /api/matches/:id | 試合画面（2D戦術盤） | 同一シード再現・統計の妥当性・大量試合 | 再現テスト合格・平均得点が現実的 |
| リーグ・順位 | shared/league.ts | room_members.final_rank | - | 順位表・結果画面 | 勝点・得失点差・総得点 | テスト合格 |
| 再接続 | RoomDO | - | WebSocket | 自動再接続 | 切断→再接続で状態復元 | 結合テスト合格 |
| 対戦履歴 | api/matches.ts | 上記 | GET /api/matches/history, /api/users/me/history | 履歴画面 | 試合後に履歴が増える | 結合テスト合格 |
| 管理者認証 | api/admin/* | admin_users, admin_sessions, admin_audit_logs | /api/admin/auth/* | 管理ログイン | 一般ユーザーのトークンで403 | テスト合格 |
| 管理：カード一覧 | admin/* | player_* | GET /api/admin/cards, /api/admin/cards/:id | カード一覧・詳細 | 300枚・絞り込み | 画面で確認 |
| 分析イベント | api/analytics.ts | analytics_events | - | - | 主要イベントが記録される | 結合テスト合格 |

## 3. 実装順序

1. モノレポの土台・ドキュメント
2. `shared`：乱数 → 選手生成 → ドラフト → 編成・ケミストリー → SIM → リーグ（単体テスト・バランス検証）
3. `ui`：カード・肖像
4. `api`：マイグレーション → 認証 → 選手 → ルーム → RoomDO（ドラフト・編成・試合） → 履歴 → 管理API
5. `web`：認証 → ホーム → ロビー → ドラフト → 編成 → 試合 → 結果 → 履歴
6. `admin`：認証 → カード一覧・詳細
7. 結合テスト（4人オンライン・再接続・管理者権限）・ブラウザでの確認

## 4. 今回の範囲外（後のフェーズ）

Ranked・レーティング（Phase 3）、Collection・通貨・ガシャ・交換所（Phase 4）、管理サイトのカード一覧以外のページ（Phase 5）、課金（Phase 6）、iOS/Android アプリ化（Expo）。
データモデルは、これらを後から追加できる形にしておく。
