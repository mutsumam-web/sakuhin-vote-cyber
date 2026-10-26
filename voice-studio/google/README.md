# TUNAGU Voice Studio — Google Chirp 3 HD Lab

iPhone SEでGoogleの日本語高品質音声を聞き比べ、Google Cloud Text-to-Speech APIを接続後は任意の文章からMP3を生成する試験版。既存TUNAGU、本番Worker、投票システムのルートには変更を加えず、`voice-studio/google/`に試験ページ、`voice-studio/google-worker/`にCloudflare Workerのソースを配置する。

## 現在の稼働状況

- GitHub Pagesのブラウザ画面：公開可。公式日本語音声サンプルはGoogle公式サイトで直接聴ける。
- Google TTS生成機能：**Cloudflare WorkerとGoogle Cloudサービスアカウントのセットアップが必要**。APIキーや秘密鍵をGitHub/HTMLに置かない。
- 認証トークン取得・日本語音声合成の通信テスト：モックサーバーに対するNodeのテスト13件成功。**Google Cloudへ実際の合成リクエストは実行していない**ため音質と料金の実績は未検証。

## Webアプリ

`https://mutsumam-web.github.io/sakuhin-vote-cyber/voice-studio/google/`

- 日本語の原稿入力（最大500文字）、Google公式音声サンプルへのリンク。
- A/Bで日本語の2種類の声を選択し、Cloudflare Worker経由の生成・再生・MP3ダウンロード。
- APIの接続前は「未接続」を明示し、生成ボタンを無効化。
- 接続先Worker URLだけをブラウザのlocalStorageに保存。試験用アクセスコードは保存しない。

## 有料APIを接続するまでの順序

1. Google Cloud Consoleで新規**試験専用**プロジェクトを作成し、請求先を設定する。Cloud Text-to-Speech APIを有効にする。予算通知・割当上限を必ず設定。予算通知は課金停止の保証にはならない。
2. この用途専用サービスアカウントのJSON秘密鍵を作る場合、不要な権限は与えず、Secretに登録後は元ファイルを安全に管理する。長期運用はキーレス方式を検討。秘密鍵はGitHub、HTML、会話、原稿には貼らない。
3. Cloudflare Workersに`worker/index.mjs`を新しい独立Workerとして追加。`GOOGLE_SERVICE_ACCOUNT_JSON`（JSON全文）と`DEMO_ACCESS_CODE`（24文字以上のランダムな試験コード）を **Secrets** として設定する。`wrangler.jsonc`にRate Limitingの定義を含む。試験コードとGoogle秘密鍵は別物。
4. 公開URLの `/health` から`configured: true`を確認する。iPhoneの試験ページで接続先URLと試験コードを入力し、500文字以内で生成する。
5. 最初は架空の短文のみを使用。試験後はCloudflare Workerを停止するか秘密情報を無効化する。販売用途にそのまま使わない。

ローカル環境でWranglerを使う場合：

```bash
cd worker
npm install
npx wrangler deploy
```

秘密情報は `wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` および `wrangler secret put DEMO_ACCESS_CODE` で設定できる。ローカル開発用`.dev.vars`はGit管理しない。

## API仕様

`GET /health`：状態確認。`POST /api/tts`：`Authorization: Bearer <DEMO_ACCESS_CODE>`、`Content-Type: application/json`、本文 `{ "text": "こんにちは", "voice": "Aoede" }`。合成成功で `audio/mpeg` を返す。入力可能なvoice: Aoede / Kore / Leda / Zephyr / Charon / Puck / Orus / Achird。

エンドポイントはGoogle公式REST `https://texttospeech.googleapis.com/v1/text:synthesize`、voiceは`ja-JP-Chirp3-HD-<name>`、音声はMP3。Googleのサービスアカウントが署名したJWTでOAuthアクセストークンを取得する。

## セキュリティと費用の注意

- 現状は試験用の共有コード認証。販売時は会員別認証、生成上限の原子的管理、利用量計測、監査、失効・ローテーション、個人情報の保護、管理者操作が必要。
- Workerで許可するブラウザOriginは `https://mutsumam-web.github.io` のみ。別originから使う場合、コード更新が必要。
- Cloudflare Rate Limitingは近似的な制限。Google Cloud側のAPI Quotasを別に制限すること。**予算アラートはハード上限ではない**。
- Google Chirp 3 HDの公開単価は月100万文字まで無料枠、超過分$30/100万文字。適用条件と請求先登録をGoogleの公式料金表で確認。
- 生成文章はGoogle Cloud Text-to-Speechへ送信される。試験で実在の利用者名、障害・健康情報、声の複製に関わる資料は扱わない。

## テスト

```bash
node --test tests/worker.test.mjs
```

この試験ページで生成されるMP3にはGoogleモデルへの入力テキストと声名が反映される。声の自然さ、正確なイントネーション、知的障害のある人の聞き取りやすさは、実際の日本語の音声を生成し聴いて初めて評価できる。

## 参考（公式）

- https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types?hl=ja
- https://cloud.google.com/text-to-speech/pricing
- https://docs.cloud.google.com/text-to-speech/docs/get-started
- https://developers.cloudflare.com/workers/configuration/secrets/