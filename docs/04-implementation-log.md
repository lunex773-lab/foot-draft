# 実装記録

## 2026-11-14 Phase 6（課金・運営）

計画：`docs/09-phase6-plan.md`。決定事項：`docs/02-decisions.md` の 52〜58。

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 商品 | GEMS パック6種類（¥300〜¥10,000、決定 53）と Premium Membership（¥500・30日）。管理サイトで名前・おまけ・初回ボーナス・表示順・販売中かを変更（購入分の GEMS は価格と同じ数でなければ保存できない）。変更は操作ログに記録 | `shared/src/economy/shop.ts`, `routes/adminShop.ts`, `admin/src/ShopAdminPages.tsx` |
| 購入とレシート検証 | 「開始 → ストアで支払い → レシート検証 → 付与」をサーバーで行う。レシートは「どのユーザー・どの購入・どの商品か」を確認し、同じストアの取引IDは1回しか使えない（DB の一意制約）。同時に2回検証しても付与は1回。購入分は「有償GEMS（購入）」、おまけ・初回分は「有償GEMS（配布）」として台帳に記録。失敗も記録（購入失敗率） | `lib/purchases.ts`, `routes/purchases.ts` |
| ストアの接続 | Apple・Google は接続口だけ（「未接続」として購入を拒否）。iOS・Android アプリとストアの設定ができてから接続する（決定 52）。ローカルと staging では「模擬ストア」（レシートをサーバーが署名）で通しで確認できる。本番では模擬ストアは使えず、ショップは「現在は購入できません」と表示 | `lib/purchases.ts`, `web/src/pages/ShopPage.tsx` |
| 返金 | 残っている GEMS を回収し、足りない分は「未回収」として記録（決定 57）。残高は0未満にならない。同じ返金の通知が2回来ても回収は1回。未回収は管理サイトの Purchases に表示し、admin がメモを付けて「対応済み」にする。会員の返金は会員をその場で終了。模擬の返金ボタンは staging・ローカルだけ | `lib/purchases.ts`, `routes/adminShop.ts` |
| Premium Membership | 30日ごとの自動更新（決定 55）。会員の間は毎日 無償GEMS 20（ログインボーナスと一緒に受け取る）と会員バッジ（ヘッダー・ルームの席・ランキング）。能力の強化・ランク戦の優遇はなし。自動更新を止めても期間の終わりまでは会員。模擬ストアの更新・解約・期限切れは管理サイトから操作 | `lib/purchases.ts`, `lib/rewards.ts`, `RoomDO` |
| Season Pass | ランク戦と同じ月単位・30段階（決定 54）。リーグを最後まで遊ぶと 100 XP（1位は 150）、1日の対戦報酬と同じ10リーグまで。無料コース：COINS と無償GEMS（合計300）。プレミアムコース（800 GEMS、無償GEMS から先に使う：決定 56）：COINS・交換ポイント・Epic と Legendary のカード（持っていないカードから選ぶ。全部持っている時は Standard の交換ポイント）。報酬は1回だけ（報酬キーの一意制約） | `shared/src/economy/pass.ts`, `routes/pass.ts`, `web/src/pages/PassPage.tsx` |
| ガシャ管理 | 管理サイトで下書き作成 → 公開 → 変更 → 終了。排出率（合計100%）・候補（レアリティと除外する選手）・価格・天井を設定。公開後の変更は変更内容の入力が必須で、新しい版として記録（決定 58）。抽選履歴にどの版で引いたかが残り、版ごとの抽選回数を表示。ゲームのガシャ詳細に変更履歴を表示 | `routes/adminGacha.ts`, `admin/src/GachaAdminPage.tsx`, `web/src/pages/GachaPage.tsx` |
| 売上分析（Revenue） | 期間（日本時間）・日次／週次／月次で、売上（総額・返金・返金後）・課金者数・課金率・ARPU・ARPPU・初回課金率・購入失敗率・未使用の有償GEMS・未回収、商品別・ストア別・ガシャ別の有償GEMS（購入分）消費。模擬ストアの売上は「実際の売上ではない」と表示。Overview の売上も実装済みに変更（ストア未接続の表示つき） | `routes/adminShop.ts`, `admin/src/ShopAdminPages.tsx` |
| 権限 | 商品の変更・返金の対応・ガシャの変更：owner・admin。購入の閲覧：support も可。売上の集計とガシャの閲覧：viewer も可（個人の購入は見られない） | `lib/auth.ts` |
| D1 | マイグレーション `0007_purchases.sql`（purchase_products・purchase_transactions・purchase_receipts・refund_records・subscriptions・season_pass_progress・season_pass_xp・gacha_banner_versions、user_collections を作り直して入手経路に season_pass を追加） | `apps/api/migrations/` |

検証：
- 単体テスト：shared 64件（商品・GEMS の内訳・Season Pass の報酬と段階・無償GEMS からの支払い）、API 4件（ストアの接続状態・模擬レシートの署名と改ざん・本番では模擬ストア不可）
- 結合テスト `npm run e2e:phase6` すべて成功：ショップ（7商品・Apple は拒否）、模擬ストアで購入（購入分 300＋初回 150、2回目は初回なし）、同じレシートの再送・別の購入への流用・改ざんを拒否、同時に2回検証しても1回だけ付与、Premium ガシャの支払い（配布分→購入分）、返金（1,000 回収・250 未回収、残高は0未満にならない、2回目の通知で追加の回収なし、support は閲覧のみ、admin が対応済みに）、会員（30日・二重に入れない・毎日20・ルームの席のバッジ・更新・解約・期限切れ・返金で終了）、Season Pass（プレミアムは1シーズン1回・交換ポイント・持っていない Epic と Legendary・報酬は1回だけ）、ガシャ管理（合計100%以外は拒否・viewer は作れない・下書きは選手に見えない・公開で v1・変更内容なしの変更は拒否・v2・選手に新しい排出率と変更履歴・次の抽選は v2・版ごとの回数・終了）、商品（購入分＝価格・support は変更不可）、売上（課金者・ARPPU・失敗率・商品別・ガシャ別・Overview）、viewer は個人の購入を見られない、ユーザー詳細の購入履歴
- Phase 2〜5 の結合テストもすべて成功（Phase 5 は売上・購入履歴が実装済みになったことに合わせてテストを更新）
- ブラウザ：ショップ → 模擬ストアで Starter Pack と会員 → ヘッダーの会員バッジと会員特典の表示 → Season Pass のプレミアムと報酬の受け取り（22個）→ 管理サイト（Overview の売上・Revenue・Purchases の模擬返金と未回収・会員の一覧・商品・ガシャの作成と公開と変更で v2）→ ゲームのガシャ詳細に変更履歴。スマートフォン幅でショップ・パスに横スクロールなし。コンソールエラーなし
- staging に公開（マイグレーション 0007 を適用）し、Staging check が成功（256秒）：Phase 5 までの確認に加え、ショップ（7商品・Apple と Google は未接続）、模擬ストアで Starter Pack を購入（購入分 300＋初回 150）、Season Pass（30段階・0 XP → リーグ後 +100 XP）、管理 API（商品・購入・売上・ガシャ管理）が選手のトークンを拒否すること
- production：決定 59 により、承認待ちだった公開（Phase 5 まで）を取り消し、本番の公開は後でまとめて行う。本番に出した時は模擬ストアが使えないため、ショップは「現在は購入できません」と表示される

未実装（今回の範囲外）：Apple・Google との実際の接続（アプリとストアの設定が必要：決定 52）、ストアからの返金・更新の通知の受信（接続時に作る）、Season Pass の見た目の報酬（決定 54）、ガシャの予約公開（今は開始日時の指定まで）。

## 2026-11-14 Phase 5（運営管理サイト）

計画：`docs/08-phase5-plan.md`。決定事項：`docs/02-decisions.md` の 45〜51。

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 役割と権限 | owner・admin・support・viewer の4種類。権限を細かく分け（分析・ユーザー・残高・フィードバック・配布・管理者など）、API ごとに確認。viewer は集計だけで個人を特定できる情報は見られない。管理サイトのメニューも権限で切り替え | `api/src/lib/auth.ts`, `admin/src/App.tsx` |
| 管理者の管理 | owner が管理者を追加・役割変更・無効化・2段階認証のリセット（自分自身は変更不可、owner が0人にならない）。全員が自分のパスワードを変更できる（他の端末のログインは終了）。すべて操作ログに記録 | `routes/adminAdmins.ts`, `admin/src/AdminsPage.tsx` |
| Overview | 総登録者・新規登録・DAU/WAU/MAU・期間中のアクティブ・平均プレイ時間・平均対戦数・D1/D7 継続率・消費GEMS・未使用GEMS・未対応フィードバック・エラー件数を、前の同じ長さの期間と比較。日別のグラフ4つ。売上・課金率等は「課金は未実装」と表示 | `routes/adminInsights.ts`, `admin/src/InsightsPages.tsx` |
| Analytics・Retention | 期間・プラットフォーム・バージョン・ユーザーグループ（タグ）で絞り込み。起動回数・セッション時間・対戦回数・モード利用率・初回対戦の完了率・ドラフト完了率・試合完了率・離脱率・継続率。登録日ごとのコホート表（D1・D3・D7・D14・D30）と、Friend Tester・Beta Tester・Normal の比較 | `lib/metrics.ts` |
| 集計の仕組み | 日付は日本時間。終わった日は `daily_user_metrics` に一度だけまとめ、今日の分は毎回作り直す。ゲームが開いた・閉じた時に `session_started`／`session_ended` を送る（DAU とプレイ時間のため）。API の予期しないエラーを `server_error` として数える | `lib/metrics.ts`, `routes/sessions.ts`, `web/src/lib/session.ts` |
| Economy | 通貨ごとの発行・消費（理由別）、未使用残高、交換ポイント、ガシャ別の回数・消費・人数、GEMS 消費の多いプレイヤー（個人情報のため users.read が必要）。テスト付与（staging・ローカルのみ）はこのページ | `routes/adminInsights.ts`, `admin/src/EconomyPage.tsx` |
| Users | ID・ユーザー名・表示名で検索、タグ・状態で絞り込み。詳細：登録情報・ログイン履歴・プレイ履歴・成績（勝率）・ドラフト履歴・コレクション・残高・通貨履歴・ガシャ履歴・フィードバック。タグの変更とアカウント停止（停止すると全端末でログアウト）。購入履歴は「未実装」と表示 | `routes/adminUsers.ts`, `admin/src/UsersPage.tsx` |
| フィードバック | ゲームの「設定」から送信（カテゴリ・件名・内容・返信希望。バージョン・OS・端末の種類・直前のモードと試合・直前のエラーコードを自動で記録。1日10件まで）。管理サイトで状態・優先度・内部メモ・返信。原文は変更できない。返信はゲームの「送ったフィードバック」に表示され、未読はメニューに件数を表示 | `routes/feedback.ts`, `web/src/pages/SettingsPage.tsx`, `admin/src/FeedbackPage.tsx` |
| GEMS 配布 | 無償GEMSだけ。対象（指定ユーザー・タグ・登録日・最近遊んだ人・全員）→ 対象人数と合計の確認（上限：1人 1,000、合計 1,000,000、停止中は対象外）→ 準備（対象者を固定、同じ取引IDで二重に作られない）→ 実行（50人ずつ、同時に実行しても1人1回）→ 照合（付与済み＝記録＝台帳）。中止もできる。すべて操作ログに記録 | `routes/adminDistributions.ts`, `admin/src/DistributionsPage.tsx` |
| 操作ログ | 操作・管理者で絞り込み、さらに表示（ページ送り） | `routes/admin.ts`, `admin/src/AuditPage.tsx` |
| D1 | マイグレーション `0006_admin_platform.sql`（admin_users を4種類の役割のため作り直し、feedback・feedback_notes・feedback_replies、gem_distribution_batches・gem_distribution_items、daily_user_metrics・metrics_days） | `apps/api/migrations/` |

検証：
- 結合テスト `npm run e2e:phase5` すべて成功：役割ごとに見られるページ（10の API × 4役割、選手のトークンは拒否）、viewer は個人の情報なし、support は残高を閲覧のみ、管理者の追加・役割変更の制限・パスワード変更・無効化でログアウト、セッション→DAU とプレイ時間、継続率（3日前の登録・翌日に来た人で D1 100%、D3 は集計中）、日別グラフ、フィードバック（自動記録：iOS・mobile・バージョン・エラーコード、他人のものは見えない、原文は変わらない、内部メモは見えない、返信の未読→既読、1日10件）、ユーザー検索・タグ・停止（ログアウト・ログイン不可）、配布（停止中と不明な名前は対象外、上限、同じ取引IDで1件、同時に2回実行しても1回だけ付与、照合、全員への配布を3回に分けて完了、中止）、操作ログの絞り込み
- Phase 2・3・4 の結合テストもすべて成功（Phase 4 は viewer が個人の残高を見られなくなったことに合わせてテストを更新）
- ブラウザ：ゲームの設定画面からフィードバック送信 → 管理サイト（Overview・Analytics・Retention・Economy・Users の検索と詳細・タグ保存・フィードバックの優先度・メモ・返信・GEMS 配布の作成と実行と照合・管理者・操作ログ）→ ゲームで返信と未読の表示、配布された GEMS の履歴。viewer・support のメニュー。管理サイト 820px 幅・ゲームのスマートフォン幅で横スクロールなし。コンソールエラーなし

- staging に公開（マイグレーション 0006 を適用）し、Staging check が成功（256秒）：Phase 4 の確認に加え、セッションの開始と終了、フィードバックの送信と一覧、管理 API（overview・users・feedback・distributions・admins）が選手のトークンを拒否すること、リーグ1回と報酬

未実装（今回の範囲外）：フィードバックの添付ファイル（決定 49）、配布の予約実行（今は準備して手動で実行）、二人承認（決定 46 で不要）、売上・課金の分析（Phase 6）、ベータテスト管理のテストデータのリセット（Phase 7）、通知（返信のプッシュ通知など）。

## 2026-11-14 Phase 4（コレクション・経済）

計画：`docs/07-phase4-plan.md`。決定事項：`docs/02-decisions.md` の 36〜44。

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 通貨・台帳 | COINS・無償GEMS・有償GEMS（購入）・有償GEMS（配布）を別の列で保持（0未満は DB の制約で不可）。すべての増減を台帳に1行ずつ（増減後の残高つき）。交換ポイントは Standard・Premium を別に保持し、同じく台帳あり | `migrations/0005_economy.sql`, `api/src/lib/economy.ts` |
| 二重実行・同時実行の防止 | ガシャ・交換は「ユーザーごとの操作番号」（一意制約）と「クライアントの取引ID」（同じIDの再送は前回の結果を返す）で、同時に来ても二重に引かれない。報酬は「ユーザー×報酬キー」の一意制約で1回だけ支払う | `lib/economy.ts`（`runOperation`, `rewardStmts`） |
| 報酬 | 対戦報酬（参加100＋順位、1日10リーグまで。上限は DB の枠番号の制約でも保証）、ログインボーナス（アプリを開いた時に自動で受け取り、7日連続目は300）、ソロ課題の初回達成200、イベントの1位100・2位50、シーズン報酬（無償GEMS：1位300・2〜10位200・参加者100）。Phase 3 の間に記録だけしていた報酬（シーズン・ソロ・イベント）も残高の表示時に支払う | `lib/rewards.ts`, `RoomDO.applyRewards`, `lib/seasons.ts` |
| ミッション | デイリー3・ウィークリー3・初心者6。リーグ終了・ガシャで進み（日本時間で期間が切り替わる）、達成後に受け取り（まとめて受け取りも可） | `shared/economy/missions.ts`, `routes/economy.ts` |
| ガシャ | Standard（COINS、天井なし）・Premium シリーズ1（有償GEMS、Rare以上の180人）。サーバーで `crypto.getRandomValues` による偏りのない抽選。天井（Epic以上50回・Legendary以上100回、出たら0から）、累計150回ごとにEpic以上確定の1回を無料で自動で追加。重複はポイントに変換。有償GEMSは配布分から先に使う。排出率は版つきで履歴に保存 | `shared/economy/gacha.ts`, `routes/gacha.ts` |
| 交換所 | Standardポイント→Common〜Legendary、Premiumポイント→Rare〜Icon の未所持カード（Common 100・Rare 300・Epic 1,000・Legendary 3,000・Icon 10,000） | `routes/collection.ts` |
| コレクション・Collection Draft | 所持カードの一覧、専用枠（最大3枚）の登録。Collection Draft のマッチング。登録カードは候補に追加され、登録した本人だけが指名できる（CPU・自動指名も守る） | `routes/collection.ts`, `shared/draft.ts`（`reserved`）, `RoomDO.collectionReservations` |
| テスト用の付与 | 管理サイトの「通貨・テスト付与」から、local・staging でだけ付与できる（本番の API は常に拒否）。台帳（理由 test_grant）と管理者操作ログに記録。プレイヤーの残高・台帳の確認（economy.read） | `routes/admin.ts`, `admin/src/EconomyPage.tsx` |
| ゲーム画面 | 上部に残高（COINS・GEMS）とメニュー、ガシャ（排出率・全候補と1人ずつの確率・天井の状態・終了日時（日本時間）・引き継ぎ条件・抽選履歴）、コレクション（専用枠）、交換所、ミッション、残高と履歴（GEMS の内訳）、ホームに Collection Draft と報酬、結果画面に獲得した報酬とミッション達成、ドラフトで「専用」表示 | `apps/web/src/pages/*` |
| 分析イベント | currency_earned・currency_spent・gacha_started・gacha_completed・duplicate_converted・exchange_completed・mission_completed・reward_claimed・collection_player_registered | `lib/analytics.ts` |

検証：
- 単体テスト62件成功（排出率の合計100%、20万回の抽選が排出率どおり、Standard は Icon なし・天井なし、Premium の天井（50回目・100回目）と途中で出た時の数え直し、150回特典の位置と天井への影響なし、3,000回の連続抽選で天井を超えない、重複→ポイント、有償GEMSの消費順、ミッションの日本時間の週の境目、専用枠の指名制限（自動指名も守る）、本番ではテスト付与が無効）
- 結合テスト `npm run e2e:phase4` すべて成功：新規の残高0、ログインボーナス1日1回（同時に2回送っても1回）、残高不足のガシャは何も変わらない、テスト付与（viewer・選手のトークンは拒否、操作ログ）、10連、同じ取引IDの再送で二重に引かれない、単発5回の同時実行、COINSが3回分しかない時の10連5回の同時実行で3回だけ成功・残高が負にならない、台帳の合計＝残高、重複→ポイント、有償GEMSの消費順（配布600→購入400）、天井の残り回数、交換所の規則、専用枠の規則、Collection Draft（専用カードは本人だけ、他人は RESERVED で拒否）、対戦報酬とミッション、受け取りは1回だけ、11リーグ目は対戦報酬なし（ミッションは進む）、シーズン報酬（1位300）
- Phase 1/2・Phase 3 の結合テストもすべて成功
- ブラウザ：ホーム（ログインボーナスの通知）、ガシャ（確認→結果、有償GEMSの内訳）、提供割合の詳細、抽選履歴、コレクションの専用枠、交換所、Collection Draft（ロビー→「専用」表示つきドラフト→結果の報酬）、ミッションの受け取り、残高と履歴、スマートフォン幅（横スクロールなし）、管理サイトの通貨・テスト付与。コンソールエラーなし
- staging に公開（マイグレーション 0005 を適用）し、Staging check（経済の確認を追加）が成功（252秒）：新規の残高0、ログインボーナス1日1回、ガシャ2種の公開、Premium の180人、残高不足のガシャの拒否、ミッション・コレクション・交換所の API、選手のトークンでのテスト付与の拒否、リーグ1回（Workers の無料プラン）の後に対戦報酬（2位 200 COINS）とミッション達成、ミッションの受け取り、残高 400 COINS

設計上の注意：
- Cloudflare の資料をこの環境から読めなかったため、無料プランの「1回の処理あたりの問い合わせ数」の上限を超えないよう、複数行の書き込みは1文にまとめた（10連でも約20文）。リーグ終了時の報酬は staging で動作を確認済み。staging での10連は、管理サイトでテスト付与をしてから確認する（未確認）
- Collection Draft の参加条件・報酬、同じカードを複数人が登録した時の扱いは暫定（`docs/02-decisions.md` の「提案中」）

未実装（今回の範囲外）：GEMS の購入（アプリ内課金、Phase 6）、本格的な GEMS 配布（二人承認など、Phase 5）、交換所のスキン・エンブレム等、ガシャの管理画面での作成・編集、管理画面でのプレイヤー管理。

## 2026-11-14 本番（production）に公開

ユーザーの承認（GitHub の Environments の承認制）を受けて Deploy（production）を実行し、成功。D1（football-draft-production）の作成とマイグレーション、API、署名キー、ゲームと管理サイトの公開、動作確認（API の応答・画面・カード画像・CORS）がすべて通った。

- ゲーム：https://football-draft-production.pages.dev
- 管理サイト：https://football-draft-admin-production.pages.dev
- API：https://football-draft-api.lunex773.workers.dev

管理者 SecondAKIRA（owner）：staging は作成済み。production は Create admin を起動し、承認待ち。

## 2026-11-14 staging に公開

GitHub Actions の Deploy（staging）で Cloudflare に初めて公開した。D1 の作成とマイグレーション 0001〜0004、API（Workers＋Durable Objects）、署名キーの自動作成、ゲームと管理サイト（Pages）の公開、動作確認（API の応答・画面・カード画像・CORS）がすべて成功。

- ゲーム：https://football-draft-staging.pages.dev
- 管理サイト：https://football-draft-admin-staging.pages.dev
- API：https://football-draft-api-staging.lunex773.workers.dev

確認：新しく作ったワークフロー Staging check で、公開した staging を相手に、本番と同じ設定（テスト用の短い時間設定なし）で4人リーグ（自分＋CPU 3）を1回通しで実行し、すべて成功（247秒）。登録・300人のカード・Phase 3 の API・ルーム作成・WebSocket・ドラフト56ピック・3節6試合の試合計算・最終順位・試合履歴。Workers の無料プランで、試合計算が CPU 時間の上限で失敗することはなかった（1ルームでの確認。複数ルームの同時進行は未確認）。

## 2026-11-14 実写の選手カード（2日目：計150人）

クレジットのリセット後に自動で再開し、FD-074〜FD-149（FD-088 は1日目に生成済み）の75人分を生成してカードに組み込んだ。Figma AI のクレジットが今日の上限に達したため停止。合計150人（残り150人はイラストのカード）。単体テスト45件・型チェック成功。次は 2026-11-15 00:05 UTC に自動で再開する。

## 2026-11-14 公開の準備（Cloudflare ＋ GitHub Actions）

決定事項 31〜35。手順は `docs/06-deploy.md`。

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| CI | プッシュのたびに型チェック・単体テスト・ゲームと管理サイトのビルド | `.github/workflows/ci.yml` |
| 公開 | staging はプッシュで自動（Cloudflare のシークレットが未登録なら失敗ではなくスキップ）、production は手動実行＋GitHub の承認。D1 と Pages のプロジェクトがなければ作成し、マイグレーション → API → 署名キー（初回のみ自動生成）→ ゲーム・管理サイトの順に公開し、最後に動作確認 | `.github/workflows/deploy.yml`, `.github/scripts/cf-prepare.sh` |
| 管理者の作成 | Actions から作成。パスワードは GitHub のシークレット。2段階認証は管理サイトへの初回ログイン時に QR コードで登録（キーはログに出ない） | `.github/workflows/admin-create.yml`, `routes/admin.ts`, `admin/src/App.tsx` |

検証：
- `cf-prepare.sh` を Cloudflare API の模擬サーバーで確認（D1・Pages のプロジェクトの新規作成、2回目は既存の再利用で同じ結果、トークンが違う時は原因を表示して停止）。本物の Cloudflare では、シークレットの登録後に初めて動かす
- 初回ログインでの2段階認証の登録をブラウザで確認（QR コードの表示、誤ったコードは拒否、登録後は通常のコード入力、操作ログに開始と完了が残る）
- ビルド・単体テスト45件・結合テスト（Phase 1/2・Phase 3）すべて成功

## 2026-11-14 Phase 3（競争機能）

計画：`docs/05-phase3-plan.md`。決定事項：`docs/02-decisions.md` の 24〜30。

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| Ranked | ランク戦のマッチング（4人そろえば即開始、60秒でCPU補充）。招待コードでの参加・手動開始・設定変更は不可。1人が同時に入れるランク戦は1つ | `routes/ranked.ts`, `RoomDO.ts` |
| レーティング | 最終順位から Elo（人間同士のみ、K=32を相手の人数で割る）。D1 に1回のバッチで反映し、`rating_changes(room_id, user_id)` の一意制約で二重反映を防止。ティア6段階（暫定） | `shared/src/ranked.ts`, `RoomDO.applyRanked` |
| シーズン | 日本時間の月単位。シーズンをまたいだ最初のアクセスで前シーズンを締め、最終順位を `season_results` に記録。新シーズンは前のレートを1000へ半分戻す | `api/src/lib/seasons.ts` |
| ランキング | シーズンごとの上位100人と自分の順位、過去のシーズン | `GET /api/ranked/leaderboard`, `/seasons`, `RankedPage.tsx` |
| Solo Challenge | 日替わりの課題を日付から生成（候補の条件5種＋特別ルール4種＋目標5種、難易度★1〜3）。自分＋CPU 3チーム、作成と同時に開始。ルール（フォーメーション固定・指名順4番目・本気のCPU）をサーバーで適用し、目標の達成をサーバーで判定して記録 | `shared/src/challenges.ts`, `routes/solo.ts`, `SoloPage.tsx` |
| Special Events | 管理サイトで作成・編集・公開・終了（管理者操作ログに記録）。期間中だけ参加でき、候補は「対象選手を全員入れ、足りない分は通常の選手」。初期イベント5件を下書きで用意 | `shared/src/pool.ts`, `routes/events.ts`, `admin/EventsPage.tsx` |
| 管理サイト | イベント管理（条件の選択、候補数の確認、公開・終了）、シーズン・ランキング（閲覧のみ）。権限 events.read / events.write / seasons.read を追加（viewer は閲覧のみ） | `admin/src/EventsPage.tsx`, `SeasonsPage.tsx`, `lib/auth.ts` |
| ゲーム画面 | ホームにモード（クイック・ランク・ソロ・イベント・プライベート・参加）、ランク待機画面（CPU補充までの残り秒数）、試合中のモード表示、結果画面にレート増減・課題の達成・イベント名 | `apps/web/src/pages/*` |
| D1 | マイグレーション `0004_phase3.sql`（events, seasons, ranked_ratings, rating_changes, season_results, solo_challenges, solo_attempts。rooms は新しいモードのため作り直し、既存データは保持） | `apps/api/migrations/` |
| 分析イベント | `rating_updated`、`solo_challenge_completed` を追加。mode_selected に ranked / solo / event | `lib/analytics.ts` |

検証：
- 単体テスト45件成功（Elo の増減・格上に勝つと大きく上がる・人間1人は変動なし・ティア・シーズンの日本時間の境目・半分リセット・条件つき候補（純粋な条件／日本の23人／GK20人／23歳以下）・1年分の日替わり課題がすべて成立・目標の判定）
- 結合テスト `npm run e2e:phase3`（43項目）すべて成功：4人のランク戦でレートが変わる（合計がほぼ0、1位が上がり4位が下がる）、ランキング、同じランク戦への再参加、招待コード・手動開始の拒否、1人＋CPU補充でレート変動なし、ソロ課題の開始・ルール・結果の記録、イベントの作成（viewer・選手のトークンは拒否）・公開・参加・候補に日本の23人全員・終了後は参加不可・操作ログ、管理のシーズン
- 既存の結合テスト（Phase 1/2）もすべて成功
- ブラウザ：ホーム、ランク待機→ドラフト→結果（1000→984、−16）、ランキング画面、ソロ課題→結果（課題達成）、イベント一覧→ロビー→ドラフト、管理サイト（イベントの編集・公開・作成、シーズン・ランキング、操作ログ）。コンソールエラーなし。スマートフォン幅も確認

修正：初期イベントの期間の日付を誤っていた（2025年）ため、マイグレーションを修正（まだどの環境にも公開していないため、0004 を直接修正）。

未実装（今回の範囲外）：報酬の配布（通貨は Phase 4）、イベントごとのランキング画面、ランク戦の観戦、シーズン切り替えの定期実行（今はアクセス時に切り替え）。

## 2026-11-13（4回目）実写の選手カード（75人）

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 肖像の生成 | Figma の画像生成（gpt-image-2.5-flare、1024×1024）で架空の選手の実写風の肖像を作成。指示文は選手ごとの外見データから自動で作る | `tools/card-art/src/prompts.ts`, `src/list-prompts.ts` |
| 保存 | 640×640 の JPEG（1枚約55KB）と生成の記録（モデル・Figma のノード・生成日） | `data/player-db-v1/portraits/`, `portraits.json`, `tools/card-art/fetch_portraits.py` |
| カード | 元カードの枠の内側を写真で埋め、OVR・ポジション・名前・6能力・レアリティ名を描き直す（256色、1枚約80KB） | `tools/card-art/photo_cards.py` → `assets/cards/` |
| 表示 | 丸アイコンの切り抜き位置をカードの種類（実写／イラスト）で切り替え | `packages/shared/src/players/cardArt.ts`, `packages/ui/src/Avatar.tsx` |
| 進み具合 | 75人（FD-001〜FD-073、FD-088、FD-173）で Figma AI のクレジットが尽きたため停止。残り225人はイラストのカード | - |

検証：単体テスト28件成功（肖像の一覧とファイルが一致、全員がカタログの選手）、型チェック成功。ブラウザで管理サイトのカード一覧（実写とイラストの混在）・詳細、ゲームの登録→ドラフト→編成→3試合→最終順位→図鑑を確認。

## 2026-11-13（3回目）全カードに別々の選手を描き込み

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 外見データ | 300人分の外見（肌・髪型・髪色・ひげ・顔の形・目の色・表情・顔の向き）を選手IDと国籍から生成し保存。肌・髪型・髪色・ひげの組み合わせは全員異なる。JSONを編集すれば個別に変更できる | `tools/card-art/src/appearance.ts`, `data/player-db-v1/appearance.json` |
| 描き込み | 元のカード画像のシルエット部分に、イラストの選手（顔・首・クラブのユニフォームとエンブレム）を描き、PNGとして出力。枠・OVR・ポジション・リング・名前・能力値・レアリティ名は元画像のまま | `tools/card-art/src/CardArt.tsx`, `Head.tsx`, `kits.ts` |
| 出力 | `npm run cards:render`（Playwright で300枚を描画 → 256色に圧縮。合計 8.6MB、1枚約29KB） | `tools/card-art/src/render.ts`, `optimize.py` |
| 表示 | 編成画面・リストの丸アイコンは、カード画像の顔の部分を切り抜いて表示 | `packages/ui/src/Avatar.tsx` |

検証：単体テスト27件成功（300人の外見がそろい、顔の組み合わせが300通りすべて異なり、配信用カードが元画像と異なることを確認）。ブラウザでドラフト・編成・試合・最終順位、管理サイトのカード一覧・詳細を確認しエラーなし。

## 2026-11-13（2回目）選手データベース v1 への切り替え

ユーザー提供の「FOOTBALL DRAFT 300 Player Database v1」をカードのデータに採用（決定内容は `docs/02-decisions.md` の 15〜19）。

| 区分 | 変更内容 | 主なファイル |
| --- | --- | --- |
| データ | 元データを `data/player-db-v1/` に保存し、そのまま読み込む（変換・検証は `convertPlayerDatabase`）。表示能力・OVR・ポジション・特殊能力・SIM用19能力はデータのとおり | `packages/shared/src/players/import.ts`, `catalog.ts` |
| カード画像 | 添付のPNG 300枚とテンプレート5枚を `assets/` に置き、ゲーム・管理サイトでそのまま表示。リスト・ピッチの丸アイコンはカード画像の人物部分を切り抜いて使う | `packages/ui/src/PlayerCard.tsx`, `Avatar.tsx` |
| ポジション | CF・LWB・RWB を追加（15ポジション）。CF＝ST枠、LWB/RWB＝LB/RB枠で減点なし | `packages/shared/src/data/positions.ts` |
| 特殊能力 | データの12種類に入れ替え、発動条件を明記してSIMに実装 | `data/traits.ts`, `sim/engine.ts` |
| クラブ・リーグ・国籍 | データの10クラブ・6リーグ（Vortex League を追加）・15か国。国旗に韓国・クロアチア・アメリカ・ポルトガルを追加 | `data/clubs.ts`, `data/nations.ts`, `ui/src/Flag.tsx` |
| SIM | v0.2.0。能力の水準をカードのOVRに合わせる補正、カウンターと決定機の確率を再調整（`docs/03-sim.md`） | `sim/engine.ts` |
| D1 | マイグレーション `0003_player_db_v1.sql`：旧240人を無効化、`card_asset` 列を追加、300人を投入 | `apps/api/migrations/` |
| 削除 | 自動生成の240人・最初の参考画像の5人・SVGカード／肖像／紋章／アイコン（git履歴には残っている） | - |

検証：単体テスト26件成功（元データとの一致、全300枚の画像の存在、CF/LWB/RWB、OVRとポジション別評価の一致を含む）、結合テスト（4人オンライン・管理API、300枚・CF絞り込み・FD-001の詳細）すべて成功、ブラウザで登録→ドラフト→3試合→最終順位、管理サイト（TOTPログイン→カード一覧・表・詳細・操作ログ）を確認しエラーなし。スマートフォン幅の表示も確認。


## 2026-11-13（1回目）Phase 1＋Phase 2＋管理画面カード一覧

### 実装済み（ローカル環境で動作確認済み）

| 区分 | 内容 | 主なファイル |
| --- | --- | --- |
| 選手データ | 架空選手240人（Common 96・Rare 72・Epic 42・Legendary 22・Icon 8）。内部能力19項目 → 表示6能力・ポジション別評価を計算。参考画像の5枚（Elias Voss / Mateo Silva / Adrian Volkov / Luca Moretti / Orion Vale）は画像と同じ能力値で収録 | `packages/shared/src/players/*` |
| カード | 参考画像のデザインを再現（盾形の枠・レアリティ別配色・王冠・OVRとポジション・特性バッジ3つ・6能力・国旗/リーグ/クラブ紋章・レアリティ名） | `packages/ui/src/PlayerCard.tsx` |
| 肖像 | 選手ごとに異なるSVGイラスト（肌・髪型・髪色・ひげ・表情・顔の向き・クラブのユニフォーム）。写真や実在の人物・ロゴは使っていない | `packages/ui/src/Portrait.tsx` |
| アカウント | 登録・ログイン・ログアウト（PBKDF2、トークンはハッシュで保存、ログイン失敗の回数制限） | `apps/api/src/routes/auth.ts` |
| ルーム | クイックドラフト（自動マッチング、4人で自動開始）、プライベートルーム（招待コード・招待リンク、ホスト設定）、空席のCPU補充 | `apps/api/src/routes/rooms.ts`, `RoomDO.ts` |
| ドラフト | 84人プール、スネーク順（指名位置はランダム）、56ピック、重複禁止（DBの一意制約も）、GK3人まで、時間切れのサーバー自動指名（不足ポジション・フォーメーション・適性・相性・控えを考慮） | `packages/shared/src/draft.ts`, `RoomDO.ts` |
| 編成・戦術 | 8フォーメーション、攻撃/守備戦術＋5項目の詳細設定＋終盤の方針、スタメン/控えの入れ替え、ケミストリー表示、サーバー側の入力検証 | `lineup.ts`, `chemistry.ts`, `apps/web/src/pages/room/Lineup.tsx` |
| 試合 | サーバーでSIM v0.1を実行（シード保存・再現可能）、2D戦術盤＋実況で約60秒の同時再生、統計（支配率・シュート・枠内・xG・パス成功率など）、選手評価・MVP・戦術効果 | `packages/shared/src/sim/*`, `apps/web/src/components/MatchBoard.tsx` |
| リーグ | 総当たり3節、勝点→得失点差→総得点→直接対決→抽選。各節の前に編成変更（直後60秒・合間30秒） | `league.ts`, `RoomDO.ts` |
| オンライン | Durable Objects＋WebSocket（ハイバネーション対応）、署名付きチケット認証、切断表示、自動再接続で状態を復元 | `RoomDO.ts`, `apps/web/src/lib/useRoom.ts` |
| 履歴 | リーグ履歴・試合履歴・試合詳細・リプレイ | `routes/matches.ts`, `HistoryPage.tsx`, `MatchReplayPage.tsx` |
| 分析イベント | account_registered / login_* / session_started / mode_selected / room_* / draft_* / match_* を `analytics_events` に記録 | `lib/analytics.ts` |
| 管理サイト | 管理者専用ログイン（選手のトークンは不可）、TOTP 2段階認証、権限（owner/admin/viewer）、カード一覧（カード表示/表表示・検索・レアリティ/ポジション/リーグ/クラブ/国籍/特殊能力/プレースタイル/OVRで絞り込み・並び替え）、カード詳細（内部能力19項目・ポジション別評価・特殊能力の発動条件・ドラフト実績）、管理者操作ログ | `apps/admin/*`, `routes/admin.ts` |
| 環境分離 | local / dev / staging / production を `wrangler.toml` で分離。Secrets は `.dev.vars`（git管理外）/ `wrangler secret` | `apps/api/wrangler.toml` |

### 検証結果

- 単体テスト：25件すべて成功（`npm test -w @fd/shared`）
- 結合テスト（`npm run e2e -w @fd/api`、4人の実WebSocketクライアント）：すべて成功
  - 登録・重複拒否・誤パスワード拒否・未ログイン拒否
  - 招待コード参加・満員拒否・非メンバーのチケット拒否・偽造チケット拒否・ホスト以外の開始拒否
  - 56ピック完了・重複なし・各14人・GK 1〜3人・放置したプレイヤーは全ピック自動指名
  - 手番外の指名拒否・切断の表示・再接続で最新状態を受信
  - 不正な編成の拒否・提出した戦術が試合に反映・3節6試合・順位と勝点の整合
  - 保存されたシードとチームで試合を再計算すると完全に一致（設計書 6-4）
  - クイックマッチで同じルームに入る・CPU補充
  - 選手トークンで管理APIに入れない・管理トークンで選手APIに入れない・viewer は操作ログを見られない
- ブラウザ確認（Playwright）：登録→ルーム作成→ドラフト（カードをクリックして指名）→戦術変更→3試合観戦→最終順位→履歴→リプレイ→図鑑、管理サイト（TOTPログイン→カード一覧→表→詳細→操作ログ）。コンソールエラーなし。スマートフォン幅（iPhone 13）でも表示を確認
- SIMバランス：`docs/03-sim-v0.1.md` 参照

### 未実装（今回の範囲外）

Ranked・レーティング・シーズン（Phase 3）、Solo Challenge・Special Events、Collection・通貨・ガシャ・交換所（Phase 4）、管理サイトのカード一覧以外のページ（Overview・Users・Analytics・Retention・Economy・Feedback・GEMS配布など、Phase 5）、課金（Phase 6）、iOS/Android アプリ（Expo）、ゲーム内フィードバック送信、ルーム観戦、本番環境へのデプロイ。
設計書 18 の API のうち `/api/users/me/collection`・`/api/matches/:id/start`・通貨・ガシャ・交換所・フィードバックは未作成（試合はサーバーが自動で開始するため `/api/matches/:id/start` は不要）。

### 既知の課題

- SIM：「カウンター＋ローブロック」がやや強い。退場がやや多い（ベータテストで調整）
- 本番では SIM・自動指名の CPU 時間のため Workers 有料プランが前提
- 進行中のルームの Durable Object の古いデータを掃除する仕組みは未作成
- ルームを途中で抜けたプレイヤーは席が残り、サーバーが自動で操作する（再参加は可能）
