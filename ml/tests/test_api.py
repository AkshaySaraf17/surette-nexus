"""API tests: auth, validation and wiring (models replaced with stand-ins)."""

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ML_SERVICE_TOKEN", "test-token")
    from surette_ml import app as app_module

    importlib.reload(app_module)

    class FakeEmbedder:
        def get_text_embedding_batch(self, texts, **_):
            return [[0.1] * 1024 for _ in texts]

    class FakeLLM:
        def complete(self, prompt, **_):
            return "The purchase price is $325,000 [1]."

    monkeypatch.setattr(app_module, "embedder", lambda: FakeEmbedder())
    monkeypatch.setattr(app_module, "llm", lambda: FakeLLM())
    return TestClient(app_module.app)


AUTH = {"Authorization": "Bearer test-token"}


def test_requires_token(client):
    assert client.post("/v1/embed", json={"texts": ["x"]}).status_code == 401
    assert client.post("/v1/embed", json={"texts": ["x"]}, headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_embed_returns_vectors_of_the_configured_size(client):
    r = client.post("/v1/embed", json={"texts": ["lake house", "farmhouse"], "kind": "query"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["dim"] == 1024 and len(body["vectors"]) == 2


def test_chunk_endpoint(client):
    r = client.post("/v1/chunk", json={"pages": [{"page": 3, "text": "Closing is June 30, 2026."}]}, headers=AUTH)
    assert r.json()["chunks"] == [{"page": 3, "ord": 0, "text": "Closing is June 30, 2026."}]


def test_answer_endpoint_checks_and_cites(client):
    r = client.post(
        "/v1/answer",
        json={"question": "What's the price?", "passages": [{"id": "c1", "label": "P&S", "page": 2, "text": "The purchase price is $325,000."}]},
        headers=AUTH,
    )
    body = r.json()
    assert body["grounded"] and body["citations"] == ["c1"]


def test_rejects_oversized_requests(client):
    r = client.post("/v1/answer", json={"question": "x" * 600, "passages": []}, headers=AUTH)
    assert r.status_code == 422


def test_health_is_public(client):
    assert client.get("/health").json()["status"] == "ok"
