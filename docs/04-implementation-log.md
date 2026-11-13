# 実装記録

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
