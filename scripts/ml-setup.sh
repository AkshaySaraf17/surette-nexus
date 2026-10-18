#!/usr/bin/env bash
# One-time setup for the AI service (free, local):  scripts/ml-setup.sh
#   - Python virtual environment in ml/.venv with the pinned packages
#   - Ollama models: the chat model and the embedding model used for RAG and semantic search
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/ml"
command -v python3 >/dev/null || { echo "Install Python 3.12+ first (brew install python)"; exit 1; }
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements-dev.txt
if command -v ollama >/dev/null; then
  ollama pull "${OLLAMA_MODEL:-llama3.2:3b}"
  ollama pull "${OLLAMA_EMBED_MODEL:-mxbai-embed-large}"
else
  echo "Ollama isn't installed: brew install ollama && brew services start ollama, then rerun this script."
fi
echo "AI service ready. scripts/dev.sh starts it on http://localhost:8600"
