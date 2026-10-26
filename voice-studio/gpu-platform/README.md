# TUNAGU Voice Studio — self-hosted Japanese GPU TTS (v0.2 research build)

**Status as of 2026-10-26:** CPU tests run locally; actual Qwen inference on CUDA / paid Runpod Pod / Cloudflare Worker are **NOT yet provisioned or verified**. This is deployable infrastructure code, **not an activated GPU service**. Does not modify TUNAGU production.

## Components

- `gpu-api/server.py` — FastAPI, Qwen3-TTS, authenticated `/v1/tts` WAV/MP3 and `/v1/capabilities`; only approved model variants.
- `gpu-api/Dockerfile`, `compose.yaml` — CUDA container and persistent Hugging Face cache.
- `cloudflare-worker/worker.js`, `wrangler.jsonc` — browser-to-GPU secured gateway, CORS, approximate rate limiting, secret-based access.
- `web/index.html` — iPhone-friendly script, Japanese voice, style instruction, A/B preview, audio download.
- `tests/test_api.py` — CPU-only API tests with mocked GPU inference. GPU-quality tests are a separate step.

## 1. Select a paid NVIDIA GPU (operator action)

Recommended **Runpod Secure Cloud RTX 4090 24GB** for the initial 1.7B model; alternative L4/A5000 24GB if cost is the priority, with possible performance tradeoffs. Prices and available regions can change: https://www.runpod.io/pricing . **The GPU rental costs money while running.** No credit card, Runpod billing, GPU rental or API keys are set up by this code.

### GPU setup

Use a Runpod PyTorch/CUDA Pod, SSH in or open a terminal, and install Docker with NVIDIA Container Toolkit if needed (Runpod templates usually include NVIDIA drivers and appropriate runtime). Clone this project or upload the `gpu-api` directory and run:

```bash
cd gpu-api
cp .env.example .env
# Edit .env on the GPU machine, generate a strong unique VOICE_API_TOKEN.
# Do not use REPLACE_WITH_A_LONG_RANDOM_SECRET.
docker compose up -d --build
```

**Important:** `compose.yaml` binds port 8000 to `127.0.0.1`, appropriate for local-only access. To expose the API through the **Runpod HTTP Proxy**, bind `0.0.0.0:8000:8000` or deploy the Docker image directly as a Runpod Pod with exposed HTTP port `8000`. Ensure the required API token is configured in Pod secrets/environment. Proxy URL is `https://POD_ID-8000.proxy.runpod.net`. Do not expose FastAPI without a real API token. First inference downloads model weights and can take substantial time; configure persistent storage and an adequate disk allowance (e.g., 30–50GB). Run a single inference worker per GPU and check `nvidia-smi`, Pod logs, health and CUDA model inference. `GET /healthz` indicates process only, **not** that the model generated audio successfully.

This project is **not a one-click Runpod template**; deploying a custom image requires building and publishing the image to a registry or using the GPU Pod's shell. The local Dockerfile might need adjustment for provider runtime and future `qwen-tts` dependency changes. FlashAttention installation is optional (more optimization later).

### GPU smoke tests (after actual deployment)

```bash
curl -sS https://POD_ID-8000.proxy.runpod.net/healthz
curl -fS https://POD_ID-8000.proxy.runpod.net/v1/tts \
  -H 'Content-Type: application/json' \
  -H 'X-Voice-Token: YOUR_PRIVATE_TOKEN' \
  --data '{"text":"あ、おかえり。今日もお疲れさま。","voice":"Ono_Anna","style":"やさしく自然な口調で","format":"wav"}' \
  --output output.wav
```

The GPU API doesn't persist speech text, voice references or output files. Remote providers may still log metadata; review contracts and privacy before real client data.

## 2. Cloudflare Worker (operator action)

Install Node.js and Wrangler, sign in to your Cloudflare account **outside** ChatGPT:

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put GPU_API_TOKEN
npx wrangler secret put GPU_BASE_URL
npx wrangler secret put DEMO_ACCESS_CODE
npx wrangler deploy
```

The value of `GPU_API_TOKEN` **must equal** the token on the GPU machine. `GPU_BASE_URL` is the full HTTPS Runpod proxy origin. `DEMO_ACCESS_CODE` is a separate shared tester password. Secrets must never be added to git. Cloudflare Worker allows only `https://mutsumam-web.github.io` as browser origin; edit `ALLOWED_ORIGIN` for a new frontend host. `TTS_RATE_LIMIT` is approximate (5 requests/IP/minute), **not a hard spending cap**. Turn off/terminate the Pod when not using it.

The Worker authenticates generation and forwards the call server-to-server with the GPU token. `GET /api/health` reports only gateway availability. The trial code is **not** per-user authentication, so do not use for commercial release or public unlimited access.

## 3. iPhone frontend

Deploy `web/index.html` on a static HTTPS host, e.g. GitHub Pages in a separate `voice-studio/gpu-lab/` path. In iPhone Safari enter the deployed Worker HTTPS URL and the **demo** passcode. Choose `Ono_Anna` for Japanese voice, use A/B with different style instructions, save WAV/MP3. Frontend saves **no token, text, or audio** to persistent storage.

## 4. GPU cost control / production work

- Pod billing starts on launch; terminate/stall it when not testing. Storage may incur ongoing fees.
- Time-box a 10–15-minute first listening test; test short Japanese phrases and compare quality/latency.
- No strict global budget cap, sign-in, database, payments, billing, audit, queue, multi-GPU load balancing or streaming first-audio latency SLA is implemented.
- For production, implement user accounts, strict **server-side** global quota and spending cap, job queue, model readiness/health, retries, observability without logging private content, and proper privacy/consent.
- Voice cloning from human samples is intentionally not included. Never imitate a real person's voice without documented permission.

## Local tests (without GPU)

```bash
python -m pytest -q tests/test_api.py
```

These tests patch the GPU inference engine; passing them does **not** show natural-sounding synthesized speech or a running GPU instance.

## References

- Official model and API: https://github.com/QwenLM/Qwen3-TTS
- Runpod HTTP proxy and Pods: https://docs.runpod.io/pods/connect-to-a-pod
- Cloudflare Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare rate limits: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/