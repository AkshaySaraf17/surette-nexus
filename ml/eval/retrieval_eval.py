"""
Retrieval evaluation for listing search: which ranking finds the homes people mean?

Compares, on the hand-labelled queries in retrieval_queries.json:
  - BM25 keyword search (implemented with NumPy)
  - dense retrieval with each local embedding model (max cosine over a listing's chunks)
  - hybrid: reciprocal-rank fusion of BM25 + the dense ranking (what the site uses)

Metrics: Recall@3, MRR, nDCG@5 (binary relevance). Results → eval/results/retrieval.json.

    cd ml && .venv/bin/python -m eval.retrieval_eval            # needs the local DB + Ollama
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parent
OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")

# Each model's recommended query/document prefixes (from their model cards).
MODELS = {
    "nomic-embed-text": ("search_query: ", "search_document: "),
    "mxbai-embed-large": ("Represent this sentence for searching relevant passages: ", ""),
}


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = (ROOT.parent.parent / "web" / ".env").read_text()
    m = re.search(r'^DATABASE_URL="?([^"\n]+)"?', env, re.M)
    if not m:
        sys.exit("Set DATABASE_URL")
    return m.group(1)


def load_chunks() -> dict[str, list[str]]:
    import psycopg

    with psycopg.connect(database_url()) as conn:
        rows = conn.execute(
            """SELECT p.slug, c.content FROM property_chunks c JOIN properties p ON p.id = c.property_id
               WHERE p.status IN ('active', 'pending') ORDER BY p.slug, c.ord"""
        ).fetchall()
    chunks: dict[str, list[str]] = {}
    for slug, content in rows:
        chunks.setdefault(slug, []).append(content)
    if not chunks:
        sys.exit("No indexed listings: run the ai.index job first (scripts/dev.sh starts the worker).")
    return chunks


# ---------- BM25 (Robertson/Spärck Jones), vectorised with NumPy ----------

TOKEN = re.compile(r"[a-z0-9]+")
STOP = set("a an and the of to in on for with my i me is are be at by from or near over without".split())


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN.findall(text.lower()) if t not in STOP]


class BM25:
    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.tokens = [tokenize(d) for d in docs]
        self.vocab = {t: i for i, t in enumerate(sorted({t for d in self.tokens for t in d}))}
        tf = np.zeros((len(docs), len(self.vocab)))
        for i, d in enumerate(self.tokens):
            for t, c in Counter(d).items():
                tf[i, self.vocab[t]] = c
        lengths = tf.sum(axis=1, keepdims=True)
        df = (tf > 0).sum(axis=0)
        self.idf = np.log(1 + (len(docs) - df + 0.5) / (df + 0.5))
        self.weights = tf * (k1 + 1) / (tf + k1 * (1 - b + b * lengths / lengths.mean()))

    def scores(self, query: str) -> np.ndarray:
        idx = [self.vocab[t] for t in tokenize(query) if t in self.vocab]
        if not idx:
            return np.zeros(self.weights.shape[0])
        return (self.weights[:, idx] * self.idf[idx]).sum(axis=1)


# ---------- dense retrieval ----------


def embed(model: str, texts: list[str]) -> np.ndarray:
    out = []
    for i in range(0, len(texts), 32):
        r = httpx.post(f"{OLLAMA}/api/embed", json={"model": model, "input": texts[i : i + 32]}, timeout=300)
        r.raise_for_status()
        out.extend(r.json()["embeddings"])
    v = np.asarray(out, dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)  # unit vectors: dot product = cosine


def dense_scores(model: str, slugs: list[str], chunks: dict[str, list[str]], queries: list[str]) -> np.ndarray:
    q_prefix, d_prefix = MODELS[model]
    flat = [(s, c) for s in slugs for c in chunks[s]]
    doc_vecs = embed(model, [d_prefix + c for _, c in flat])
    q_vecs = embed(model, [q_prefix + q for q in queries])
    sims = q_vecs @ doc_vecs.T  # (queries, chunks)
    owner = np.array([slugs.index(s) for s, _ in flat])
    # A listing's score is its best-matching chunk.
    return np.stack([np.array([sims[qi, owner == li].max() for li in range(len(slugs))]) for qi in range(len(queries))])


# ---------- metrics ----------


def rank(scores: np.ndarray) -> list[int]:
    return list(np.argsort(-scores, kind="stable"))


def rrf(*rankings: list[int], k: int = 60) -> list[int]:
    total: Counter[int] = Counter()
    for r in rankings:
        for pos, item in enumerate(r):
            total[item] += 1 / (k + pos + 1)
    return [item for item, _ in total.most_common()]


def metrics(ranking: list[int], relevant: set[int]) -> dict[str, float]:
    recall3 = len(set(ranking[:3]) & relevant) / len(relevant)
    mrr = next((1 / (i + 1) for i, item in enumerate(ranking) if item in relevant), 0.0)
    dcg = sum(1 / math.log2(i + 2) for i, item in enumerate(ranking[:5]) if item in relevant)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(relevant), 5)))
    return {"recall@3": recall3, "mrr": mrr, "ndcg@5": dcg / ideal}


def evaluate() -> dict:
    spec = json.loads((ROOT / "retrieval_queries.json").read_text())
    chunks = load_chunks()
    slugs = sorted(chunks)
    queries = [x["q"] for x in spec["queries"]]
    relevant = [{slugs.index(s) for s in x["relevant"] if s in slugs} for x in spec["queries"]]

    bm25 = BM25([" ".join(chunks[s]) for s in slugs])
    systems: dict[str, list[list[int]]] = {"bm25 (keywords)": [rank(bm25.scores(q)) for q in queries]}
    for model in MODELS:
        dense = dense_scores(model, slugs, chunks, queries)
        systems[f"dense: {model}"] = [rank(row) for row in dense]
        systems[f"hybrid: bm25 + {model}"] = [rrf(systems["bm25 (keywords)"][i], systems[f"dense: {model}"][i]) for i in range(len(queries))]

    results = {}
    for name, rankings in systems.items():
        per_query = [metrics(r, rel) for r, rel in zip(rankings, relevant, strict=True)]
        results[name] = {m: round(float(np.mean([p[m] for p in per_query])), 3) for m in per_query[0]}
    out = {"queries": len(queries), "listings": len(slugs), "results": results}
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "retrieval.json").write_text(json.dumps(out, indent=2) + "\n")
    return out


if __name__ == "__main__":
    report = evaluate()
    print(f"{report['queries']} queries over {report['listings']} listings\n")
    print(f"{'system':40} {'recall@3':>9} {'mrr':>6} {'ndcg@5':>7}")
    for name, m in sorted(report["results"].items(), key=lambda kv: -kv[1]["ndcg@5"]):
        print(f"{name:40} {m['recall@3']:>9.3f} {m['mrr']:>6.3f} {m['ndcg@5']:>7.3f}")
