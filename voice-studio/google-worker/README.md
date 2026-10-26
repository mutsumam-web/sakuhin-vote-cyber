# TUNAGU Voice Studio：Google Chirp 3 HD統合

**状態：iPhone画面・Google連携Workerのプログラムを作成済み。Google CloudサービスアカウントとCloudflare Workerの認証情報が未設定のため、実際のクラウド音声生成は未接続。**

Google Text-to-Speechの日本語音声（Chirp 3 HD）を既存のVoice Studioに追加する独立構成です。既存のTUNAGU本番、投票システムのAPIを変更しません。

## 必要な設定

1. Google Cloud Console https://console.cloud.google.com で専用プロジェクトを用意し、課金を有効化して **Cloud Text-to-Speech API** を有効化する。
2. Text-to-Speech呼出しに必要な最小限のアクセス権を持つ専用サービスアカウントを作る。サービスアカウントのJSON鍵はパスワード管理のもとで保管する。**鍵をGitHub・ブラウザ画面・チャットに貼り付けない。**
3. Google CloudのAPIクォータ・予算アラートをできるだけ小さな試験値に設定する。**予算アラートだけでは課金停止されない。**
4. このフォルダの `wrangler.jsonc` の `GOOGLE_PROJECT_ID` を専用のGCPプロジェクトIDに更新する。既存のCloudflare Workerを上書きしない。
5. このフォルダで以下を実行する（インストールしたNode.js・Wrangler環境が必要）：

```sh
npm install
npm test
npx wrangler login
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
npx wrangler secret put STUDIO_ACCESS_CODE
npx wrangler deploy
```

`GOOGLE_SERVICE_ACCOUNT_JSON` はサービスアカウントJSON全文、`STUDIO_ACCESS_CODE` は**16文字以上のランダムな試験用コード**を設定。二つともCloudflare Secretsに登録し、ソースファイルに保存しない。

6. iPhoneで https://mutsumam-web.github.io/sakuhin-vote-cyber/voice-studio/ を開き、「Google Chirp 3 HD」を選択し、発行されたWorker URLとアクセスコードを入力して「接続を確認」。音声と話速を選び、テイクA/Bを生成してMP3を再生・保存する。

## APIとセキュリティ

- `GET /config`: 8種類の日本語音声と接続設定状態（秘密情報は含まない）
- `POST /synthesize`: JSON `{"text":"おはよう", "voice":"Kore", "speed":1}` → `audio/mpeg`
- ブラウザのOriginを GitHub Pages の `https://mutsumam-web.github.io` に固定し、それ以外の呼出しを拒否
- アクセスコード必須、声のホワイトリスト、1回500文字まで、Google OAuth2サーバー認証
- Cloudflare Worker Rate Limitingは3回/60秒（**Cloudflare拠点単位の近似値**）。絶対的な月額上限にはならない。Google側クォータを適切に設定する。
- 原稿/音声を永続保存しない。ダウンロード用MP3はiPhone側の一時URL
- Googleへ原稿が送信され、生成にGoogle Cloudの課金が発生し得る。プライベートデータ・施設利用者情報は試験原稿に入れない。

## 費用

Google公式料金表では、Chirp 3 HDは月間100万文字まで無料枠、超過分は100万文字当たり30米ドル。**Google Cloudの課金設定自体は必須**で、超過分は自動で課金される。Google・Cloudflareの料金改定や他の課金対象には注意。

## 留意事項

- このWorkerは**個人試験用**。商用の一般公開時には会員認証、グローバルな厳密予算上限、利用量記録、濫用対策が別途必要。
- APIへの実アクセス、iPhone SafariのMP3再生、Google請求額は実認証情報が未接続のため未検証。
- Google固有の話速変更はサポートされるが、感情の直接指定は音声モデルの仕様と異なるため未実装。句読点や原稿の調整で比較する。

公式仕様：https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd

公式料金：https://cloud.google.com/text-to-speech/pricing