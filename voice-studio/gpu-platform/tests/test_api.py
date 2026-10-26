import os
import sys
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'gpu-api'))
import server

class FakeEngine:
    def synthesize(self, req):
        return b'RIFFFAKEWAV' if req.format == 'wav' else b'ID3FAKEMP3'

@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setenv('VOICE_API_TOKEN', 'temporary-test-token')
    server.app.dependency_overrides[server.get_engine] = lambda: FakeEngine()
    monkeypatch.setattr(server, 'get_engine', lambda: FakeEngine())
    yield
    server.app.dependency_overrides.clear()

client = TestClient(server.app)
TOKEN = {'X-Voice-Token': 'temporary-test-token'}

def test_health_without_secret():
    assert client.get('/healthz').json()['status'] == 'running'

def test_reject_missing_auth():
    assert client.post('/v1/tts',json={'text':'おはよう'}).status_code == 401

def test_reject_wrong_auth():
    assert client.post('/v1/tts',headers={'X-Voice-Token':'wrong'},json={'text':'おはよう'}).status_code == 401

def test_reject_unconfigured_token(monkeypatch):
    monkeypatch.delenv('VOICE_API_TOKEN')
    assert client.post('/v1/tts',headers=TOKEN,json={'text':'おはよう'}).status_code == 503

def test_synthesize_wav():
    r=client.post('/v1/tts',headers=TOKEN,json={'text':'おはよう','voice':'Ono_Anna','style':'優しく','format':'wav'})
    assert r.status_code==200
    assert r.content.startswith(b'RIFF')
    assert r.headers['content-type']=='audio/wav'
    assert r.headers['cache-control']=='no-store'

def test_synthesize_mp3():
    r=client.post('/v1/tts',headers=TOKEN,json={'text':'おはよう','format':'mp3'})
    assert r.status_code==200 and r.content.startswith(b'ID3')

def test_reject_empty_text():
    assert client.post('/v1/tts',headers=TOKEN,json={'text':'  '}).status_code == 422

def test_reject_overlong_text():
    assert client.post('/v1/tts',headers=TOKEN,json={'text':'あ'*241}).status_code == 422

def test_reject_invalid_voice():
    assert client.post('/v1/tts',headers=TOKEN,json={'text':'こんにちは','voice':'unknown'}).status_code == 422

def test_reject_invalid_format():
    assert client.post('/v1/tts',headers=TOKEN,json={'text':'こんにちは','format':'aac'}).status_code == 422

def test_capabilities_protected():
    assert client.get('/v1/capabilities').status_code == 401
    assert client.get('/v1/capabilities',headers=TOKEN).status_code == 200

def test_gpu_engine_allowlist():
    with pytest.raises(RuntimeError):
        server.QwenEngine('any-remote-model')