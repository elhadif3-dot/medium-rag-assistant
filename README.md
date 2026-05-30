# Medium RAG Assistant

Individual assignment implementation for a Medium article Retrieval-Augmented Generation assistant.

## RAG Configuration

The `/api/stats` endpoint returns:

```json
{
  "chunk_size": 768,
  "overlap_ratio": 0.15,
  "top_k": 8
}
```

These values satisfy the assignment limits:

- Chunk size maximum: 1024 tokens
- Overlap maximum: 0.3
- Top-k maximum: 30

## Endpoints

### `POST /api/prompt`

Input:

```json
{
  "question": "Your natural language question here"
}
```

Output:

```json
{
  "response": "Final natural language answer from the model.",
  "context": [
    {
      "article_id": "1234",
      "title": "Sample article title",
      "chunk": "article chunk retrieved",
      "score": 0.1234
    }
  ],
  "Augmented_prompt": {
    "System": "the system prompt used to query the chat model",
    "User": "the user prompt used to query the chat model"
  }
}
```

### `GET /api/stats`

Returns the RAG hyperparameters in the strict required shape.

## Environment

Create `API.env` locally or configure these variables in Vercel:

```env
LLMOD_API_KEY=your_llmod_key_here
LLMOD_BASE_URL=https://api.llmod.ai/v1
LLMOD_CHAT_MODEL=4UHRUIN-gpt-5-mini
LLMOD_EMBEDDING_MODEL=4UHRUIN-text-embedding-3-small

PINECONE_API_KEY=your_pinecone_key_here
PINECONE_INDEX_NAME=medium-rag
```

Never commit real keys.

## Local Commands

```bash
npm install
npm run estimate-cost
npm run pinecone-stats
npm run build
npm run dev
```

Paid local RAG test:

```bash
npm run ask -- "List exactly 3 articles about writing. Return only the titles."
```

Public teacher-like validation suite:

```bash
npm run teacher-like-test -- https://medium-rag-assistant-theta.vercel.app
```

The suite checks the required API shape and representative questions for precise retrieval, multi-result listing, summary extraction, recommendations, refusal for external knowledge, and a multi-part edge case.

## Ingestion

Place `medium-english-50mb.csv` in the project root before ingestion.

The ingestion script deliberately refuses to run unless `--confirm-paid` is supplied:

```bash
npm run ingest -- --limit=25 --confirm-paid
```

Use a small limit first, validate retrieval quality, and only then ingest the full dataset once.

After a successful tiny subset test, continue ingestion without `--reset`; the script resumes from `data/ingest-state.json` and avoids re-embedding articles already processed.

## Budget Controls

The project follows the assignment instruction to avoid embedding the same data repeatedly. The estimated full embedding cost is about `$0.30`, and a typical query is estimated around `$0.0023`, based on local token approximations and the selected hyperparameters.

## Final Ingestion State

- Articles ingested: 7,682
- Pinecone vectors: 19,349
- Pinecone dimension: 1,536
- Vector coverage check: 0 missing chunk IDs

The runtime uses Pinecone dense retrieval plus a compact generated lexical index exposed as `public/lexical-index.json` for exact-term candidate recall. The lexical candidates are still fetched from Pinecone before being sent to the model.
