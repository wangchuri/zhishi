"""文本向量化测试：确定性 fallback 向量与 embed_texts 降级路径。"""
import math
from unittest.mock import patch

from app.services import embedding_service


def test_fallback_embed_dim():
    vec = embedding_service._fallback_embed("hello")
    assert len(vec) == embedding_service.EMBEDDING_DIM


def test_fallback_embed_deterministic():
    v1 = embedding_service._fallback_embed("同一句话")
    v2 = embedding_service._fallback_embed("同一句话")
    assert v1 == v2


def test_fallback_embed_unit_norm():
    vec = embedding_service._fallback_embed("向量")
    norm = math.sqrt(sum(x * x for x in vec))
    assert abs(norm - 1.0) < 1e-6


def test_fallback_embed_different_texts_differ():
    v1 = embedding_service._fallback_embed("北京")
    v2 = embedding_service._fallback_embed("上海")
    assert v1 != v2


def test_embed_texts_empty():
    assert embedding_service.embed_texts([]) == []


def test_embed_texts_falls_back_on_model_failure():
    with patch.object(embedding_service, "_load_model", return_value=None):
        vecs = embedding_service.embed_texts(["a", "b"])
    assert len(vecs) == 2
    assert all(len(v) == embedding_service.EMBEDDING_DIM for v in vecs)


def test_embed_texts_uses_model_when_available():
    import numpy as np

    class FakeModel:
        def encode(self, texts, normalize_embeddings=True):
            return [np.array([1.0, 0.0]) for _ in texts]

    with patch.object(embedding_service, "_load_model", return_value=FakeModel()):
        vecs = embedding_service.embed_texts(["a", "b"])
    assert vecs == [[1.0, 0.0], [1.0, 0.0]]
