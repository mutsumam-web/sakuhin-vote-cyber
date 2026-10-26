# iPhone SafariからRunpod GPU試験を開始する手順

**現状：GPU環境の構築コード・Web UI・Cloudflare Workerコードは作成済み。ただし有料Runpod Podは未契約・未起動で、実GPU音声生成は未検証。** RunpodのWeb UIから契約・課金を伴う操作は利用者自身の承認が必要です。

## Runpod GPU
1. iPhoneのSafariで https://www.runpod.io/ にアクセスしてログイン。
2. Secure CloudからRTX 4090 24GBなどのGPUを選び、PyTorch/CUDAのPodテンプレートで起動。HTTPポート **8000** を公開し、モデル保存用の30〜50GB程度のストレージを確保する。起動中はGPU料金が発生する。
3. Podの環境変数に `VOICE_API_TOKEN`（推測不能な32文字以上の長い秘密文字列）と `VOICE_MODEL_VARIANT=custom-1.7b` を設定する。秘密文字列を公開ページ・GitHub・チャットに貼らない。
4. RunpodのWeb Terminalで次を実行する。

```bash
cd /workspace
git clone --depth=1 https://github.com/mutsumam-web/sakuhin-vote-cyber.git tunagu-src
cd tunagu-src/voice-studio/gpu-platform/gpu-api
bash start-on-runpod.sh
```

5. `https://POD_ID-8000.proxy.runpod.net/healthz` でAPIプロセスの起動を確認する。これはモデル読み込みや音声生成の成功を保証しない。最初の合成は大きなモデルファイルのダウンロードで時間がかかる。

## Cloudflare Worker
- ソース：`voice-studio/gpu-platform/cloudflare-worker/worker.js`
- Wrangler設定：`wrangler.jsonc`
- Secrets：`GPU_API_TOKEN`（上と同じ値）、`GPU_BASE_URL`（Runpod HTTPS Proxy URL）、`DEMO_ACCESS_CODE`（利用者向けの別の試験用コード）
- Rate Limiting Binding：`TTS_RATE_LIMIT`。近似的なレート制限なので、厳密な課金上限には使えない。
- デプロイ：`npm install && npx wrangler deploy`（Cloudflareアカウントへのログイン・Secretsの事前登録が必要）

## iPhone音声確認
https://mutsumam-web.github.io/sakuhin-vote-cyber/voice-studio/gpu-lab/ をSafariで開き、Cloudflare Worker URLと試験用アクセスコードを入力して生成する。GPU秘密トークンは入力しない。

**重要：** 試験後はPodを停止・削除し、料金の継続発生を避ける。停止してもストレージ料金が残る場合がある。販売用にはさらに会員認証、厳密な利用量制限、決済、データ保護が必要。初期試験には架空の文章を使い、個人情報や施設の利用者情報は入力しない。
