# 開発計画：Phase 4（コレクション・経済）

設計書 22「Phase 4：Collection・COINS・FREE GEMS・PAID GEMS・Standard Gacha・Premium Gacha・重複交換・交換所・Collection Draft」。
ユーザーに確認して決めた内容は `docs/02-decisions.md` の 36〜44。

## 1. 設計レビュー（設計書 25 STEP 4）

| 確認項目 | 設計 |
| --- | --- |
| 通貨の分離 | 残高は COINS・GEMS_FREE・GEMS_PAID_PURCHASED・GEMS_PAID_GRANTED を別の列で持つ（画面では GEMS をまとめて表示してよいが、内訳も見られる）。交換ポイントは Standard・Premium を別に持つ |
| 通貨台帳 | すべての増減を `currency_transactions`（ポイントは `exchange_transactions`）に1行ずつ記録（通貨・増減・増減後の残高・理由・参照先・取引ID）。残高は台帳の合計と一致する（テストで照合） |
| 原子性・二重実行防止 | 1回の操作（ガシャ・交換・報酬）は D1 の1回のバッチ（トランザクション）で書く。残高の列は 0 以上（CHECK 制約）なので、足りない時はバッチ全体が失敗し何も変わらない。クライアントが送る取引ID（idempotency key）は一意制約付きで、同じ要求をもう一度送っても二重に引かれず、前回の結果を返す。同じユーザーの操作が同時に来た時は、ユーザーごとの操作番号（一意制約）で片方だけを通す |
| ガシャの抽選 | サーバーで抽選（`crypto.getRandomValues` を使った偏りのない整数）。排出率は ppm（100万分率）で持ち、合計100%をテストで確認。排出率は版（rates_version）つきで保存し、抽選履歴に版を残す |
| 天井の状態 | ユーザー×シリーズごとにサーバーで保持（Epic以上が出ていない回数・Legendary以上が出ていない回数・150回特典までの累計）。画面には「あと何回で保証か」を表示 |
| 重複カード | 所持済みのカードが出たら、出たガシャの種類（Standard／Premium）のポイントに変換（Common 10・Rare 30・Epic 100・Legendary 300・Icon 1,000） |
| Collection Draft と Ranked の分離 | 所持カードを使えるのは Collection Draft のルームだけ。Ranked・クイック・イベント・ソロは従来どおり全員共通の候補 |
| 報酬の二重付与防止 | 報酬は `reward_claims`（ユーザー×報酬キーの一意制約。例：`match:<ルームID>`、`login:<日付>`、`mission:<ID>:<期間>`、`season:<シーズン>`）に記録してから付与 |
| 1日10リーグの上限 | `daily_match_rewards`（ユーザー×日付×枠番号、枠番号は1〜10の CHECK 制約）に枠を取ってから付与。同時に終わったリーグでも上限を超えない |
| テスト用の付与 | `ENVIRONMENT` が local / development / staging の時だけ有効（本番の API では常に拒否）。owner／admin のみ。操作ログに記録 |
| 分析イベント | currency_earned・currency_spent・gacha_started・gacha_completed・duplicate_converted・exchange_completed・mission_completed・reward_claimed・collection_player_registered を追加 |
| 個人情報 | 新しいテーブル・イベントにはユーザーIDだけを保存（名前・メール等は持たない） |
| 本番・テストの分離 | 環境ごとに別の D1。テスト付与は本番で無効。購入（アプリ内課金）は Phase 6 |

## 2. 暫定値（ベータテストで調整。`packages/shared/src/economy/config.ts` に集約）

| 項目 | 値 |
| --- | --- |
| Standard ガシャ | 1回 1,000 COINS／10連 10,000 COINS。Common 60%・Rare 28%・Epic 10%・Legendary 2%・Icon 0%。天井なし（設計書 9-1） |
| Premium ガシャ（シリーズ1） | 1回 100 PAID GEMS／10連 1,000。Rare 65%・Epic 25%・Legendary 9%・Icon 1%（設計書 9-2）。期間は2027年1月31日まで（暫定） |
| 150回特典の扱い | 特典の1回は天井の数え方に影響しない（追加の無料の1回） |
| 対戦報酬 | 参加 100 COINS、順位ボーナス 1位 +150・2位 +100・3位 +50・4位 +25（設計書 10-1） |
| ログインボーナス | 1日 100 COINS、7日連続目は 300 COINS（設計書 10-1 の 100〜300） |
| デイリーミッション（計300 COINS） | リーグを1回完走 100／試合で2勝 100／自分で10回指名 100 |
| ウィークリーミッション（計1,500 COINS） | リーグを10回完走 500／リーグで1位を3回 500／ランク戦かイベントに5回参加 500 |
| 初心者ミッション（計300 FREE GEMS） | 初めてのリーグ完走・初めての1位・ランク戦に参加・ソロ課題に挑戦・ガシャを引く・Collection Draft で遊ぶ（各50） |
| Ranked シーズン報酬（FREE GEMS） | 1位 300／2〜10位 200／それ以外の参加者 100（設計書 10-2 の 100〜300）。シーズンを締めた時に配布 |
| ソロ課題の達成報酬 | その日の課題を初めて達成した時 200 COINS |
| イベントの順位報酬 | イベントのリーグで1位 +100・2位 +50 COINS（対戦報酬とは別。上限の対象外） |
| Collection Draft | 自分専用枠は最大3枚。参加条件はなし（所持0枚でも参加可）、報酬は他のモードと同じ（設計書 24-6 の暫定案） |
| 初期残高 | 0（新規登録時の配布なし） |

## 3. 機能ごとの計画

| 機能 | 主なファイル | DB | API | UI | テスト |
| --- | --- | --- | --- | --- | --- |
| 通貨・台帳 | shared/economy/*, api/lib/economy.ts | currency_wallets, currency_transactions, exchange_wallets, exchange_transactions, economy_ops | GET /api/currency/balance, /history | ホームの残高、残高の履歴 | 台帳と残高の一致、不足時に何も変わらない、取引IDの再送 |
| 報酬 | api/lib/rewards.ts, RoomDO | reward_claims, daily_match_rewards | GET /api/rewards/login（受け取り） | 結果画面の獲得表示、ログインボーナス | 二重付与なし、1日10リーグ |
| ミッション | shared/economy/missions.ts | missions, mission_progress | GET /api/missions, POST /api/missions/:id/claim | ミッション画面 | 期間の切り替え（日本時間）、進み・受け取り |
| コレクション | api/routes/collection.ts | user_collections, collection_draft_rosters | GET /api/users/me/collection, PUT /api/users/me/collection/roster | コレクション画面・専用枠の登録 | 所持していないカードは登録不可 |
| ガシャ | shared/economy/gacha.ts, api/routes/gacha.ts | gacha_banners, gacha_probabilities, gacha_pool_items, gacha_pity, gacha_history | GET /api/gacha/banners, /:id/details, POST /:id/draw, GET /history, /pity | ガシャ画面（排出率・全候補・天井・終了日時・引き継ぎ条件・履歴） | 排出率の合計100%、大量抽選で排出率に近い、天井（50/100）、150回特典、重複→ポイント |
| 交換所 | api/routes/exchange.ts | exchange_catalog | GET /api/exchange/catalog, POST /redeem, GET /history | 交換所画面 | ポイント不足・所持済み・対象外レアリティの拒否 |
| Collection Draft | shared/draft.ts（専用枠）, RoomDO | rooms（mode=collection） | POST /api/collection-draft/quick | ホームのモード、ドラフト画面の「専用」表示 | 他人の専用カードは指名不可、自動指名も守る |
| テスト付与 | api/routes/admin.ts, admin/TestGrantPage | admin_audit_logs | POST /api/admin/test-grants | 管理サイト（本番では非表示） | 本番設定で拒否 |

## 4. 実装順序

1. shared：経済の設定・ガシャの抽選と天井・ミッションの期間・専用枠つきドラフト（単体テスト）
2. api：マイグレーション 0005 → 台帳 → 報酬・ミッション → コレクション・ガシャ → 交換所 → Collection Draft → テスト付与（結合テスト）
3. web：残高・ガシャ・コレクション・交換所・ミッション・結果画面の報酬
4. admin：テスト付与
5. ブラウザでの確認、staging への公開と確認、ドキュメント、コミット
