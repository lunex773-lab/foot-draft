# 開発計画：Phase 3（競争機能）

設計書 22「Phase 3：Ranked・レーティング・ランキング・Private Room・Solo Challenge・Special Events」。
Private Room は Phase 1/2 で実装済み。ユーザーに確認して決めた内容は `docs/02-decisions.md` の 24〜30。

## 1. 方針

- 既存の仕組み（RoomDO のドラフト→編成→総当たりリーグ）をそのまま使い、モードごとの違いは「ルームの種類（variant）」として RoomDO に持たせる。新しい試合の仕組みは作らない。
- 勝敗・順位・レーティング・課題の達成判定はすべてサーバー（RoomDO / API）で確定する（設計書 0-4）。
- Ranked は全員共通の候補プール（設計書 2-2）。所持カードの差は持ち込まない（Collection は Phase 4）。
- 報酬（シーズン報酬・課題報酬・イベント報酬）は通貨（Phase 4）ができるまで「記録だけ」。報酬が配られたように見せない（設計書 0-4）。

## 2. 機能ごとの計画

| 機能 | 新規・変更ファイル | DB | API | UI | テスト | 完了条件 |
| --- | --- | --- | --- | --- | --- | --- |
| レーティング | shared/ranked.ts（Elo・ティア・シーズン） | ranked_ratings, rating_changes | - | - | 同じレート4人の増減、格上に勝つと大きく上がる、人間1人なら変動なし | 単体テスト合格 |
| シーズン | shared/ranked.ts, api/lib/seasons.ts | seasons, season_results | GET /api/ranked/seasons | ランキング画面 | 日本時間の月境界、半分リセット、シーズン終了の記録 | 単体・結合テスト合格 |
| Ranked | RoomDO（ranked）, routes/ranked.ts | rooms（mode=ranked, season_id） | POST /api/ranked/queue, GET /api/ranked/me | ホーム・ランク画面・ロビー（60秒でCPU）・結果（レート増減） | 4人でレート更新、二重反映なし、1人＋CPUは変動なし、待機中の再参加 | 結合テスト合格 |
| ランキング | routes/ranked.ts | - | GET /api/ranked/leaderboard | ランキング表 | 並び順・自分の順位 | 結合テスト合格 |
| Solo Challenge | shared/challenges.ts, RoomDO（solo）, routes/solo.ts | solo_challenges, solo_attempts, rooms（challenge_id） | GET /api/solo/today, POST /api/solo/start, GET /api/solo/history | 課題画面・結果（達成/未達成） | 日替わりの再現性、1年分の課題がすべて成立、目標の判定、結果の記録 | 単体・結合テスト合格 |
| Special Events | shared/pool.ts（候補の条件）, RoomDO（event）, routes/events.ts | events, rooms（event_id） | GET /api/events, GET /api/events/:id, POST /api/events/:id/join | イベント一覧・詳細・ロビー | 条件の選手が全員候補に入る、期間外は参加不可 | 単体・結合テスト合格 |
| 管理：イベント | routes/admin.ts, admin/EventsPage | events, admin_audit_logs | GET/POST/PATCH /api/admin/events, /preview, /:id/publish, /:id/archive | 一覧・作成・編集・候補数の確認・公開・終了 | viewer は作成不可、操作ログ | 結合テスト合格 |
| 管理：シーズン | routes/admin.ts, admin/SeasonsPage | - | GET /api/admin/seasons, /:id/leaderboard | シーズン一覧・ランキング（閲覧のみ） | - | 画面で確認 |

## 3. ルームの種類（RoomDO）

| 種類 | 参加方法 | 開始 | 候補プール | 特別なルール | 終了時 |
| --- | --- | --- | --- | --- | --- |
| quick / private | 既存どおり | 既存どおり | 通常 | なし | 既存どおり |
| ranked | `POST /api/ranked/queue` のみ（招待コード不可） | 人間4人で即開始。そろわなければ待機開始から60秒でCPU補充して開始。手動開始・設定変更なし | 通常（全員共通） | なし | 人間同士の順位で Elo を計算し D1 に反映（同じルームの二重反映は一意制約で防ぐ） |
| solo | `POST /api/solo/start` のみ（1人＋CPU 3） | 作成と同時に開始 | 課題の条件 | フォーメーション固定・指名順が最後・CPUが強い（課題による） | 目標を判定して solo_attempts に記録 |
| event | `POST /api/events/:id/join`（開催中のみ。招待コード不可） | クイックと同じ | イベントの条件（対象選手を全員入れ、足りない分は通常の選手） | なし | 順位を記録（rooms.event_id で集計） |

## 4. 候補プールの作り方（条件つき）

1. 条件に合う選手を「対象選手」とする。
2. ポジション別の枠（GK12・DF24・MF24・FW12）を、まず対象選手から（多ければランダムに）埋め、足りない分を対象外の選手で埋める。
3. 自由枠12は、残っている対象選手（GK も可）を先に入れ、残りを対象外のフィールドプレーヤーで埋める。
4. 対象選手だけで全部の枠が埋まる時は対象選手だけの候補になる（例：23歳以下で GK が足りない時は GK だけ対象外から補う）。

## 5. 実装順序

1. shared：レーティング・シーズン・ティア → 候補の条件 → 日替わり課題・目標判定（単体テスト）
2. api：マイグレーション 0004 → RoomDO の種類 → ranked → solo → events → 管理API（結合テスト）
3. web：ホーム・ランク・ソロ・イベント・ルーム画面の対応
4. admin：イベント管理・シーズン
5. ブラウザでの確認、ドキュメント、コミット
