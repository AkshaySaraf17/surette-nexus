-- AI search: vector embeddings (pgvector) for deal documents and listings.
--
-- document_chunks  passages of transaction documents, for "Ask the documents" (RAG). Readable only
--                  by staff who can see the deal (same rule as transaction_documents).
-- property_chunks  passages of each listing (title, headline, description, features), for
--                  meaning-based home search. Readable whenever the listing itself is readable.
--
-- Rows are written by the worker (system role); the app role can only read them. Embeddings come
-- from a local model (Ollama nomic-embed-text, 768 dimensions) — see ml/ and lib/server/ai-index.ts.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES transaction_documents(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  page           integer NOT NULL CHECK (page >= 1),
  ord            integer NOT NULL CHECK (ord >= 0),
  content        text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  -- Keyword side of hybrid search; also the fallback when the embedding model is offline.
  tsv            tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding      vector(768),
  model          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, ord)
);
CREATE INDEX document_chunks_txn_idx ON document_chunks (transaction_id);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin (tsv);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE property_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  ord          integer NOT NULL CHECK (ord >= 0),
  content      text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  embedding    vector(768) NOT NULL,
  model        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ord)
);
CREATE INDEX property_chunks_embedding_idx ON property_chunks USING hnsw (embedding vector_cosine_ops);

-- Indexing state: what was embedded, so only changed listings/documents are re-embedded.
ALTER TABLE transaction_documents ADD COLUMN ai_indexed_at timestamptz, ADD COLUMN ai_index_error text;
ALTER TABLE properties ADD COLUMN ai_content_hash text, ADD COLUMN ai_indexed_at timestamptz;

GRANT SELECT ON document_chunks, property_chunks TO surette_app;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_chunks_staff_read ON document_chunks FOR SELECT TO surette_app
  USING (app_can_staff_deal(transaction_id));
CREATE POLICY property_chunks_read ON property_chunks FOR SELECT TO surette_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));
