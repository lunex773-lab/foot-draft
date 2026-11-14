# 開発計画：Phase 5（運営管理サイト）

設計書 22「Phase 5：管理者認証・Overview・Users・Analytics・Retention・Economy・Feedback・GEMS Distribution・Admin Logs」と、設計書 12〜16。
ユーザーに確認して決めた内容は `docs/02-decisions.md` の 45〜51。

## 1. 現状（Phase 4 まで）

| 項目 | 状態 |
| --- | --- |
| 管理者認証 | 実装済み（管理者専用のセッション、2段階認証（staging・本番は必須）、ログイン失敗の回数制限、操作ログ） |
| 役割 | owner・admin・viewer の3種類 → 4種類に変更（決定 45） |
| 管理サイトの画面 | カード一覧・イベント管理・シーズン・通貨（テスト付与）・操作ログ |
| 分析イベント | `analytics_events` に記録中（登録・ログイン・ルーム・ドラフト・試合・経済）。アプリを開いたこと（セッション）は登録時しか記録しておらず、DAU が数えられない → 追加する |
| フィードバック | 未実装 |
| ユーザーのタグ | `user_tags`（founder・beta_tester・friend_tester・developer・normal）はあるが編集画面なし |

## 2. 設計レビュー

| 確認項目 | 設計 |
| --- | --- |
| 権限 | 権限を細かく分け（`users.read`・`users.write`・`analytics.read`・`feedback.read`・`feedback.write`・`distribution.read`・`distribution.write`・`admins.manage` など）、役割ごとに割り当てる。API は1つずつ権限を確認。viewer は集計だけで、個人を特定できる画面（ユーザー詳細・フィードバック本文・個人の通貨履歴）は見られない |
| 配布の安全性 | 「条件を決める → サーバーが対象人数・総数を計算して対象者を固定 → 確認画面 → 実行」。上限（1人 1,000・合計 1,000,000）はサーバーで確認。1人ずつ `reward_claims`（`distribution:<配布ID>`）で一度だけ付与するため、途中で止まっても再開でき、二重に付与しない。実行は小分け（1回の呼び出しで最大50人）で、画面が完了まで続けて呼ぶ。完了後に「付与済みの人数・台帳の合計」と照合 |
| 配布の記録 | 配布ごとに理由・対象条件・1人あたりの数量・対象人数・総数・実行した管理者・日時・成功／失敗件数。対象者ごとの結果。管理者操作ログにも記録 |
| フィードバック | 原文は変更しない（更新 API なし）。状態（New・Reviewing・Investigating・Resolved・Closed）、優先度（Low〜Critical）、内部メモ（プレイヤーに見えない）、返信（ゲームに表示）は別テーブル。送信時に自動でアプリのバージョン・OS・端末の種類・直前のモードと試合ID・直前のエラーコードを記録（User-Agent そのものは保存しない） |
| 分析の定義 | 日付はすべて日本時間。「アクティブ」＝その日に何らかの分析イベント（アプリを開いた・対戦した等）があったユーザー。DAU・WAU（7日）・MAU（30日）。継続率 Dn＝登録日（日本時間）の n 日後にアクティブだった割合（設計書 12-6）。まだ n 日経っていない登録日は「集計中」 |
| 集計の方法 | 終わった日（日本時間）は、管理サイトを開いた時に `daily_user_metrics`（日×ユーザー：起動回数・プレイ時間・リーグ数・試合数・指名数）にまとめる（一度まとめた日は再計算しない）。今日の分はその場で計算 |
| セッション | ゲームを開いた時に `session_started`、閉じた・隠れた時に `session_ended`（プレイ時間つき）を送る。プレイ時間はサーバーで上限（3時間）をかけて記録 |
| エラー件数 | API の予期しないエラー（500）を `server_error` として記録（内容はエラーの種類と場所だけ） |
| 本番・テストの分離 | 環境ごとに別の D1。集計は `environment` が今の環境のイベントだけ。テスト付与は本番で無効のまま |
| 個人情報 | フィードバックにメールアドレス等は保存しない。分析イベントにはユーザーIDだけ。保存期間はベータ中は無期限（決定 50） |
| 未実装の項目の表示 | 売上・課金率・ARPU 等は課金（Phase 6）がないため「課金は未実装」と表示し、0 を実データのように表示しない（設計書 0-4） |

## 3. 機能ごとの計画

| 機能 | API | 画面 | DB | テスト |
| --- | --- | --- | --- | --- |
| 役割と管理者 | `GET/POST /api/admin/admins`, `PATCH /api/admin/admins/:id`, `POST /api/admin/auth/password` | 管理者（owner のみ）、設定（自分のパスワード変更） | admin_users（role に support を追加） | 役割ごとに見られる API・見られない API |
| Overview | `GET /api/admin/overview?from&to` | 数値カード・日別グラフ・前の期間との比較 | daily_user_metrics, metrics_days | 集計値の照合 |
| Users | `GET /api/admin/users`, `GET /api/admin/users/:id`, `PATCH /api/admin/users/:id`（タグ・停止） | 検索・一覧・詳細（登録情報・ログイン履歴・プレイ履歴・勝率・ドラフト・コレクション・残高・通貨履歴・ガシャ履歴・フィードバック・タグ） | user_tags, users.status | viewer は見られない、停止でログイン不可 |
| Analytics | `GET /api/admin/analytics?from&to&platform&version&tag` | DAU/WAU/MAU・起動回数・プレイ時間・対戦回数・モード利用率・初回対戦完了率・ドラフト完了率・試合完了率・離脱率 | 同上 | 定義どおりの値 |
| Retention | `GET /api/admin/retention?from&to&tag` | 登録日ごとのコホート表（D1・D3・D7・D14・D30）、タグで比較 | 同上 | 日数のずれ・タイムゾーン |
| Economy | `GET /api/admin/economy?from&to` | 通貨ごとの発行量・消費量（理由別）・未使用残高・交換ポイント・ガシャ | currency_transactions 等（Phase 4） | 台帳との一致 |
| Feedback（ゲーム） | `POST /api/feedback`, `GET /api/feedback`, `GET /api/feedback/:id` | 設定画面の「フィードバックを送信」、送ったフィードバックと返信 | feedback, feedback_notes, feedback_replies | 自分のものだけ見える、回数制限 |
| Feedback（管理） | `GET /api/admin/feedback`, `GET/PATCH /api/admin/feedback/:id`, `POST .../notes`, `POST .../replies` | 一覧（状態・優先度・カテゴリで絞り込み）・詳細 | 同上 | 原文が変わらない、操作ログ |
| GEMS 配布 | `POST /api/admin/distributions/preview`, `POST /api/admin/distributions`, `POST /api/admin/distributions/:id/run`, `POST .../cancel`, `GET /api/admin/distributions(/:id)` | 条件（全員・指定ユーザー・タグ・登録日・最終ログイン）→ 確認 → 実行（進み具合）→ 結果と照合 | gem_distribution_batches, gem_distribution_items | 上限、二重実行、途中再開、照合 |
| Admin Logs | `GET /api/admin/audit-logs?action&admin&from&to&before` | 絞り込みとページ送り | admin_audit_logs | — |
| セッション・エラー | `POST /api/sessions/start`, `POST /api/sessions/end` | ゲームを開いた・閉じた時に自動送信 | analytics_events | DAU に反映 |

## 4. 実装順序

1. マイグレーション 0006（役割、フィードバック、配布、日別集計）
2. API：権限 → セッション記録 → 集計（日別まとめ・Overview・Analytics・Retention・Economy）→ Users → Feedback → 配布 → 管理者 → 操作ログの絞り込み
3. 結合テスト `e2e:phase5`
4. 管理サイトの画面、ゲームの設定画面（フィードバック）
5. ブラウザでの確認、staging への公開と確認、ドキュメント、コミット
