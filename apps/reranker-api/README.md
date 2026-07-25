# reranker-api

Internal Jina-compatible facade for LibreChat web search reranking.

LibreChat calls:

```text
POST /v1/rerank
```

The service validates the Jina-style request, truncates candidate passages to the configured local limits, calls TEI `/rerank`, and returns Jina-style `results` with original document indexes and relevance scores.

Required runtime env:

- `RERANKER_API_KEY` - bearer token expected from LibreChat's `JINA_API_KEY`.
- `TEI_RERANK_URL` - TEI endpoint, default `http://reranker-tei:80/rerank`.

Optional limits:

- `RERANKER_MODEL` - response model label, default `BAAI/bge-reranker-v2-m3`.
- `RERANKER_MAX_CANDIDATES` - default `24`, hard max `40`.
- `RERANKER_MAX_DOCUMENT_CHARS` - default `4800`, hard max `6000`.
- `RERANKER_TIMEOUT_MS` - default `2500`, hard max `5000`.
