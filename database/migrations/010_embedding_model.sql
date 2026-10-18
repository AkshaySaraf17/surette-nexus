-- Switch embeddings to mxbai-embed-large (1024 dimensions). On the hand-labelled retrieval
-- evaluation (ml/eval) it ranked listings better than nomic-embed-text (nDCG@5 0.87 vs 0.74 in hybrid
-- search). Existing vectors can't be converted between models, so they're cleared and the ai.index
-- job re-embeds everything on its next run.
DELETE FROM document_chunks;
DELETE FROM property_chunks;
UPDATE transaction_documents SET ai_indexed_at = NULL, ai_index_error = NULL;
UPDATE properties SET ai_content_hash = NULL, ai_indexed_at = NULL;

DROP INDEX document_chunks_embedding_idx;
DROP INDEX property_chunks_embedding_idx;
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);
ALTER TABLE property_chunks ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX property_chunks_embedding_idx ON property_chunks USING hnsw (embedding vector_cosine_ops);
