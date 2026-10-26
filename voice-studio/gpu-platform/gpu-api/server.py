"""TUNAGU Voice GPU prototype: self-hosted Japanese TTS.

Security: all synthesis endpoints require a server-side secret; audio/text are
never persisted. Real inference requires CUDA and official qwen-tts packages.
"""
from __future__ import annotations

import asyncio
import hmac
import io
import logging
import os
import subprocess
import threading

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

LOG = logging.getLogger('tunagu-voice')

MODEL_IDS = {
    'custom-1.7b': 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    'custom-0.6b': 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    'design-1.7b': 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign',
}
SPEAKERS = frozenset({'Ono_Anna', 'Serena', 'Vivian', 'Uncle_Fu', 'Ryan', 'Aiden', 'Sohee', 'Dylan', 'Eric'})
MAX_CHARS = 240  # short clips during the metered GPU pilot
MAX_STYLE = 160

app = FastAPI(title='TUNAGU Voice GPU API', version='0.2.0', docs_url=None, redoc_url=None, openapi_url=None)
_gpu_lock = threading.Lock()
_inference_lock = threading.Lock()
_engine = None


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: str = Field(default='Ono_Anna')
    style: str = Field(default='', max_length=MAX_STYLE)
    format: str = Field(default='wav', pattern='^(wav|mp3)$')

    @field_validator('text')
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Please enter text.')
        return value

    @field_validator('voice')
    @classmethod
    def valid_voice(cls, value: str) -> str:
        if value not in SPEAKERS:
            raise ValueError('Unsupported speaker.')
        return value


class QwenEngine:
    def __init__(self, variant: str):
        if variant not in MODEL_IDS:
            raise RuntimeError('Unsupported VOICE_MODEL_VARIANT configuration.')
        self.variant = variant
        self.model = None

    def load(self):
        if self.model is not None:
            return
        import torch
        from qwen_tts import Qwen3TTSModel
        if not torch.cuda.is_available():
            raise RuntimeError('CUDA device not available.')
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        kwargs = {'device_map': 'cuda:0', 'dtype': dtype}
        if os.getenv('USE_FLASH_ATTN', '0') == '1':
            kwargs['attn_implementation'] = 'flash_attention_2'
        LOG.info('Loading approved Qwen model variant %s', self.variant)
        self.model = Qwen3TTSModel.from_pretrained(MODEL_IDS[self.variant], **kwargs)
        LOG.info('Qwen model ready')

    def synthesize(self, req: SynthesisRequest) -> bytes:
        self.load()
        if self.variant.startswith('custom-'):
            wavs, sr = self.model.generate_custom_voice(
                text=req.text, language='Japanese', speaker=req.voice,
                instruct=req.style or None,
            )
        else:
            # VoiceDesign relies on a style description; speaker selection is
            # specific to CustomVoice and is deliberately ignored here.
            wavs, sr = self.model.generate_voice_design(
                text=req.text, language='Japanese',
                instruct=req.style or '自然な日本語の、親しみやすく落ち着いた声で話してください。',
            )
        import soundfile as sf
        result = io.BytesIO()
        sf.write(result, wavs[0], sr, format='WAV', subtype='PCM_16')
        wav = result.getvalue()
        if req.format == 'wav':
            return wav
        try:
            converted = subprocess.run(
                ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                 '-f', 'wav', '-i', 'pipe:0', '-codec:a', 'libmp3lame',
                 '-b:a', '160k', '-f', 'mp3', 'pipe:1'],
                input=wav, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=30, check=True,
            )
        except (subprocess.SubprocessError, OSError):
            raise RuntimeError('Audio conversion failed.') from None
        return converted.stdout


def get_engine() -> QwenEngine:
    global _engine
    if _engine is None:
        with _gpu_lock:
            if _engine is None:
                _engine = QwenEngine(os.getenv('VOICE_MODEL_VARIANT', 'custom-1.7b'))
    return _engine


def require_auth(x_voice_token: str | None = Header(default=None)):
    expected = os.getenv('VOICE_API_TOKEN', '')
    if not expected:
        raise HTTPException(status_code=503, detail='API not configured')
    if not x_voice_token or not hmac.compare_digest(x_voice_token, expected):
        raise HTTPException(status_code=401, detail='Unauthorized')


@app.get('/healthz')
def healthz():
    return {'status': 'running'}


@app.get('/v1/capabilities', dependencies=[Depends(require_auth)])
def capabilities():
    variant = os.getenv('VOICE_MODEL_VARIANT', 'custom-1.7b')
    return {'engine': 'qwen3-tts', 'variant': variant, 'max_chars': MAX_CHARS,
            'formats': ['wav', 'mp3'], 'voices': sorted(SPEAKERS) if variant.startswith('custom-') else [],
            'streaming': False}


@app.post('/v1/tts', dependencies=[Depends(require_auth)])
async def generate_audio(request: SynthesisRequest):
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail='GPU is busy. Try again shortly.')
    try:
        engine = get_engine()
        try:
            data = await asyncio.to_thread(engine.synthesize, request)
        except Exception as ex:
            LOG.exception('Synthesis failed: %s', type(ex).__name__)
            raise HTTPException(status_code=503, detail='Voice engine unavailable.') from None
        content_type = 'audio/mpeg' if request.format == 'mp3' else 'audio/wav'
        return Response(content=data, media_type=content_type,
                        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                 'Content-Disposition': f'attachment; filename="voice.{request.format}"'})
    finally:
        _inference_lock.release()