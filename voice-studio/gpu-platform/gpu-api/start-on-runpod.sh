#!/usr/bin/env bash
# Start inside a Runpod CUDA/PyTorch Pod (not Docker-in-Docker).
set -euo pipefail
if [[ -z "${VOICE_API_TOKEN:-}" || ${#VOICE_API_TOKEN} -lt 32 ]]; then
  echo 'VOICE_API_TOKEN must be set via Runpod environment/secrets (>=32 chars).' >&2
  exit 2
fi
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo 'NVIDIA tools are not available; choose a CUDA GPU Pod image.' >&2
  exit 3
fi
nvidia-smi
export HF_HOME="${HF_HOME:-/workspace/tunagu-voice-models}"
export VOICE_MODEL_VARIANT="${VOICE_MODEL_VARIANT:-custom-1.7b}"
mkdir -p "$HF_HOME"
python -m pip install -r requirements.txt
exec python -m uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log
