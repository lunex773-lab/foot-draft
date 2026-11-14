# 公開手順（Cloudflare ＋ GitHub Actions）

決定事項 31〜35（`docs/02-decisions.md`）にもとづく構成です。

| 部分 | Cloudflare のサービス | staging（テスト用） | production（本番用） |
| --- | --- | --- | --- |
| API | Workers＋D1＋Durable Objects | `football-draft-api-staging`（D1：`football-draft-staging`） | `football-draft-api`（D1：`football-draft-production`） |
| ゲーム | Pages | `football-draft-staging` | `football-draft-production` |
| 管理サイト | Pages | `football-draft-admin-staging` | `football-draft-admin-production` |

URL は `https://<Pages のプロジェクト名>.pages.dev` と `https://<Worker 名>.<アカウントのサブドメイン>.workers.dev`。ほかのアカウントが同じ名前を使っている場合、Pages の URL には自動で文字が足されます。実際の URL は、公開のたびに GitHub Actions の Summary に表示されます。

## 仕組み

- Cloudflare の APIトークンは GitHub のシークレットにだけ置きます。コード・ログ・チャットには出しません。
- Claude はコードをプッシュし、GitHub Actions のワークフローを起動して、その結果（ログ）を確認します。Cloudflare を直接操作することはありません。
- 開発ブランチへのプッシュ → staging へ自動で公開。
- production への公開は、Actions の「Deploy」を production で実行し、あなたが GitHub で承認した時だけ行われます。

| ワークフロー | いつ動くか | 内容 |
| --- | --- | --- |
| `CI`（`.github/workflows/ci.yml`） | プッシュのたび | 型チェック・単体テスト・ゲームと管理サイトのビルド |
| `Deploy`（`deploy.yml`） | 開発ブランチへのプッシュ（staging）／手動（staging か production） | ① D1・Pages のプロジェクトがなければ作成 ② D1 のマイグレーション ③ API の公開（`ALLOWED_ORIGINS` にゲームと管理サイトの URL を設定）④ WebSocket 用の署名キーを初回だけ自動で作成 ⑤ ゲームと管理サイトのビルドと公開 ⑥ 動作確認（API の応答・画面・カード画像・CORS） |
| `Create admin`（`admin-create.yml`） | 手動 | 管理者アカウントを作成。パスワードはシークレット `ADMIN_INITIAL_PASSWORD`。2段階認証は管理サイトへの初回ログイン時にその場で登録するため、キーはログに出ません |

## あなたの作業（最初の1回）

### 1. Cloudflare

1. **APIトークン**（My Profile → API Tokens → Create Token → Custom token）
   - Account：**Workers Scripts：Edit**、**D1：Edit**、**Cloudflare Pages：Edit**、**Account Settings：Read**
   - User：**User Details：Read**、**Memberships：Read**
   - Account Resources：ご自分のアカウントだけ
   - 「Global API Key」は使わないでください（権限が広すぎるため）
2. **アカウントID**：Workers & Pages の概要ページの右側に表示されています。
3. **workers.dev のサブドメイン**：Workers & Pages を一度開くと設定を求められます。未設定のままだと Deploy は止まり、その旨をログに表示します。
4. **プラン**：まず無料プランで試します（決定事項 34）。試合の計算で CPU 時間の上限を超えるエラーが出たら、Workers Paid（月5ドル〜）を検討します。

### 2. GitHub（リポジトリ `lunex773-lab/foot-draft`）

1. **Settings → Secrets and variables → Actions → New repository secret** で次の3つを登録します。
   - `CLOUDFLARE_API_TOKEN`：上のトークン
   - `CLOUDFLARE_ACCOUNT_ID`：アカウントID
   - `ADMIN_INITIAL_PASSWORD`：最初の管理者のパスワード（12文字以上。パスワード管理アプリで作ったものを推奨）
2. **Settings → Environments** で `staging` と `production` を作ります。`production` は **Required reviewers** にご自分を設定します（本番への公開は承認制）。
3. **Settings → Actions → General** で Actions が有効になっていることを確認します（初期設定のままで可）。

## 公開と管理者の作成

1. 登録が終わったら Claude に伝えてください。Claude が Deploy（staging）を起動して結果を確認し、URL を報告します。
2. 管理者の作成：Actions → **Create admin** → Run workflow（environment・ユーザー名・権限を選択）。Claude から起動することもできます。
3. 管理サイトの URL を開き、ユーザー名と `ADMIN_INITIAL_PASSWORD` でログインします。初回は QR コードが表示されるので、認証アプリ（Google Authenticator など）で読み取り、6桁のコードを入力すると2段階認証が有効になります。
4. 本番：Actions → **Deploy** → environment に production を選んで実行 → GitHub で承認 → 公開。

## 注意

- 公開したデータベース（D1）は環境ごとに別です。友人テストのデータは production にだけたまります。
- マイグレーションは公開のたびに自動で適用されます。一度公開したマイグレーションのファイルは書き換えず、変更は新しい番号のファイルで追加します。
- 独自ドメインは、あとで Cloudflare の画面から Pages と Workers に追加できます（追加した時は `ALLOWED_ORIGINS` の設定を合わせて変更します）。
