# MATCH / DRAFT MATCH 計画（仕様書 v2.0）

仕様書「FOOTBALL DRAFT — MATCH / DRAFT MATCH SYSTEM UPDATE v2.0」を新しい正式基準とする。
決定事項は `docs/02-decisions.md` の 68〜74。

## 1. 進め方

| 段階 | 内容 | 状態 |
| --- | --- | --- |
| 1 | 既存コード・DB・通信の調査、影響範囲と移行計画（本書） | 完了 |
| 2 | MATCH（所持カードのチーム・初期選手・育成・チーム画面・報酬） | 完了（2026-11-17） |
| 3 | DRAFT MATCH：チンチロ、スネークドラフト（11人・15秒）、共通カードプール、状態管理、ランキング | 次に行う |
| 4 | マルチプレイ・通信切断のテスト、演出（チンチロのアニメーション）、最終確認 | DRAFT MATCH と一緒に |

## 2. 既存の仕組みとの関係

| 既存 | MATCH での扱い |
| --- | --- |
| ルーム（RoomDO）・4人の総当たり・SIM・戦術・ケミストリー | そのまま使う。MATCH はドラフトを飛ばして「編成 → 3試合 → 結果」 |
| ドラフト（指名・自動指名・CPU） | MATCH では使わない。DRAFT MATCH の作り直しに使う |
| 旧モード（クイック・プライベート・ランク戦・ソロ課題・イベント・Collection Draft） | 画面から外す。API・記録は残す（決定 68） |
| ガシャ・交換所・コレクション | 重複カードは強化（+1〜+5）、+5 の後は交換ポイント（決定 70）。交換所はガシャのタブへ |
| 対戦報酬・ミッション・Season Pass | MATCH でも同じ。順位に応じた Standard 交換ポイントを追加（決定 71）。ドラフト専用のミッションは停止し、MATCH 用を追加 |
| ランク戦のレート | MATCH では変わらない。ランキングは DRAFT MATCH 専用（仕様書 8） |

## 3. MATCH の流れ

1. ホーム／モード選択で「MATCH を探す」（`POST /api/match/quick`）または「ルームを作る」（`POST /api/match/private`、招待コードのみ）
2. 待機：ホストはいつでも開始、4人そろうと自動で開始。空席は CPU チーム
3. 開始時にサーバーが各自の「使用中」のチームと強化レベルを D1 から読み込む。CPU チームは人間の先発平均 OVR の近くの選手で作る（人間のカードとは重ならない）
4. 編成（各試合の前、チームの選手の中でスタメン・フォーメーション・戦術を変更）→ 3試合 → 最終順位・報酬

強化されたカードは席ごとの能力で試合に出る（`enhancePlayer`）。試合の記録（`match_teams.players_json`）には強化後の能力が残る。

## 4. データ（マイグレーション `0009_match.sql`）

| 変更 | 内容 |
| --- | --- |
| `user_collections` | `level`（0〜5）・`favorite`・入手経路 `starter` を追加（表を作り直し） |
| `gacha_history.enhanced_to` | 重複で何段階まで強化したか |
| `rooms.mode` | `match`・`draft_match` を追加 |
| `user_squads` | 保存したチーム（1人3つ：名前・編成） |
| `user_squad_active` | MATCH で使うチーム |
| `missions` | ドラフト専用を停止、MATCH 用を追加 |

DRAFT MATCH のテーブル（draft_rooms・draft_participants・draft_dice_results・draft_card_pools・draft_picks・draft_teams・draft_match_results・draft_rankings）は DRAFT MATCH の段階で作る。

## 5. API

| API | 内容 |
| --- | --- |
| `GET /api/team` | 所持カード（強化レベル・お気に入り）、保存したチーム、使用中のチーム。初回は初期選手11人を配る |
| `PUT /api/team/squads/:slot` | チームを保存（所持カードだけ・先発11＋控え最大3をサーバーで確認） |
| `POST /api/team/active` | MATCH で使うチームを選ぶ |
| `POST /api/team/favorite` | お気に入り |
| `POST /api/match/quick`・`/private` | MATCH のルーム |
| `GET /api/collection` | 強化レベル・お気に入りを追加 |

## 6. 確認

- 単体テスト（shared）：強化の計算、初期選手（GK1・DF4・MF3・FW3・すべて COMMON）、CPU チーム、ガシャの重複で強化（+5 の後はポイント）、保存したチームの控えの補充
- 結合テスト `npm run e2e:match`：初期選手（1回だけ・同時に開いても1回・持っていたカードは強化）、ガシャの強化と履歴、チームの保存・検証・使用中・お気に入り、MATCH のルーム（マッチング・プライベートは混ざらない・ホストだけ開始・ドラフトなし・強化後の能力で試合・CPU は人間のカードを使わない）、報酬（COINS と順位の交換ポイント・ミッション）、テストデータのリセット後の再配布
