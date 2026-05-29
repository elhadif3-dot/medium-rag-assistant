# Medium Article RAG Assistant Report

## Assignment Constraints

- Dataset: `medium-english-50mb.csv`, approximately 7,682 English Medium articles.
- Model answers must be grounded only in retrieved dataset context.
- Vector database: Pinecone.
- Deployment target: Vercel.
- Budget: maximum 5 USD for development and testing.

## Chosen RAG Hyperparameters

```json
{
  "chunk_size": 768,
  "overlap_ratio": 0.15,
  "top_k": 8
}
```

Rationale:

- `chunk_size=768` is below the 1024-token maximum and gives enough local passage context for summaries and recommendations.
- `overlap_ratio=0.15` is below the 0.3 maximum and keeps continuity without duplicating too much embedding work.
- `top_k=8` is below the 30 maximum and keeps the final model context focused, reducing both noise and cost.
- The system retrieves vector candidates from Pinecone and augments them with a small local lexical candidate index for rare exact terms. The final context is still filtered before prompting the chat model.

## Required System Prompt

The API uses the assignment-required Medium-only system prompt in `lib/config.js`. It forbids external knowledge and instructs the model to answer with:

`I don’t know based on the provided Medium articles data.`

when the provided context is insufficient.

## Functional Requirement Coverage

The assistant is designed to answer only from the `medium-english-50mb.csv` corpus, using both article metadata and retrieved article passages. The CSV schema used by ingestion is:

```text
title, text, url, authors, timestamp, tags
```

The following local corpus checks identify representative articles for the required question categories, without using external information:

| Requirement | Expected behavior | Representative corpus target |
| --- | --- | --- |
| Precise fact retrieval | Locate one concrete article and return requested fields such as title and author. | `A Marketing Guide for Introverts` by `Shaunta Grimes` for the assignment-style marketing/self-promotion query. |
| Multi-result topic listing | Return up to 3 distinct article titles, not repeated chunks from one article. | Education, writing, health, marketing, and productivity topics exist across multiple distinct articles. |
| Key idea summary extraction | Retrieve a relevant article and summarize only from its passages. | `Rebounding From The Pandemic... with AI` includes the bubonic plague/Renaissance argument used by the assignment-style pandemic innovation query. |
| Recommendation with evidence | Choose one relevant article and justify with retrieved text/metadata. | `The Magic Key to Making Habits Sticky` by `Shaunta Grimes` supports the habit-building recommendation query. |

To avoid relying on the model's background knowledge, the runtime prompt includes retrieved metadata (`article_id`, `title`, `authors`, `url`, `tags`, `timestamp`) and article chunks, while the public API `context` field returns only the assignment-required fields.

## Retrieval Design

- Primary retrieval: Pinecone dense vector search using `4UHRUIN-text-embedding-3-small`.
- Hybrid support: a compact local lexical index maps important terms to Pinecone chunk IDs. This helps exact-phrase questions such as `bubonic plague` without re-embedding the dataset.
- Candidate fetching: lexical candidates are fetched from Pinecone, so final context still comes from the Pinecone-stored dataset chunks.
- Context filtering:
  - Minimum relevance score: `0.35`.
  - List questions return the requested number of distinct article titles, up to 3.
  - Precise article lookups usually keep only 2 high-confidence chunks.
  - Recommendation questions keep at most 4 chunks.

## Budget Estimate

Preliminary dataset analysis:

- Rows: 7,682
- Text characters: about 49.8M
- Approximate raw text tokens: about 12.45M using 4 characters per token.
- With `chunk_size=768` and `overlap_ratio=0.15`, expected chunks: about 19,349.

Using the public price reference for `text-embedding-3-small` at about 0.02 USD per 1M tokens:

- Estimated embedding tokens: about 15.14M.
- Estimated one-time embedding cost: about 0.303 USD.

Using a focused `top_k=8`, each question should send roughly 6K-8K input tokens plus a short answer. Estimated cost per query is about 0.0023 USD. This keeps testing comfortably under the 5 USD assignment budget as long as the full dataset is embedded only once.

## Staged Spending Plan

| Stage | Purpose | Paid calls | Estimated cost |
| --- | --- | --- | --- |
| 1 | Local build, endpoint shape, cost estimation | none | 0 USD |
| 2 | Tiny subset ingestion, 25 articles | embeddings only | about 0.001 USD |
| 3 | Tiny subset validation, 12 queries | query embedding + chat | about 0.028 USD |
| 4 | Full corpus ingestion once | embeddings only | about 0.303 USD |
| 5 | Final validation, 30 queries | query embedding + chat | about 0.069 USD |

Estimated planned total: about 0.401 USD. This leaves more than 4.50 USD of buffer under the 5 USD budget.

The critical rule is not to re-embed the full corpus when changing prompts or `top_k`. If chunk size or overlap changes, only a small subset should be re-embedded for comparison before choosing the final full-corpus configuration.

## Cost Controls

- The ingestion script refuses to run unless called with `--confirm-paid`.
- Local development can run without model calls.
- The full embedding step should be run once after validating the pipeline on a tiny subset.
- Pinecone stats can be checked without calling the LLMod models.
- The retriever applies a minimum relevance score before sending chunks to the chat model, so unrelated low-score chunks are not pushed into the final prompt.
- List-style questions cap the retrieved context to the requested number of distinct articles, up to 3.
- `API.env` is excluded from Git by `.gitignore`.

## Current Validation Results

Full-corpus validation was run after ingesting all 7,682 articles.

- Ingestion result: 19,349 vectors in Pinecone, 1,536 dimensions, about 15.17M embedded tokens tracked locally.
- Vector coverage check: 19,349 expected chunk IDs, 0 missing IDs.
- Multi-result listing test: `"List exactly 3 articles about education. Return only the titles."`
  - Returned exactly 3 titles and no explanation.
- Precise retrieval test: `"Find an article that reframes marketing as a conversation with readers, aimed at writers who find self-promotion uncomfortable. Provide the title and author."`
  - Returned `A Marketing Guide for Introverts` by Shaunta Grimes.
- Summary extraction test: `"Find an article that argues past pandemics such as the bubonic plague can spur innovation and recovery, and summarize its central argument."`
  - Returned `Rebounding From The Pandemic... with AI` by Massimiliano Versace and summarized the Renaissance / AI transformation argument from retrieved context.
- Recommendation test: `"I want practical, beginner-friendly advice on building habits that actually stick. Which article would you recommend, and why?"`
  - Returned `The Magic Key to Making Habits Sticky` by Shaunta Grimes with evidence from the retrieved passage.
- Unknown/out-of-corpus test: `"Who won the 2022 FIFA World Cup?"`
  - Returned the required refusal sentence with 0 context chunks after relevance filtering.

The portal should be used as the source of truth for exact spend. Based on local token accounting and observed usage, the work remains comfortably below the 5 USD assignment limit.

## Validation Plan

1. Validate API shape locally without model calls:
   - `GET /api/stats` must return exactly `chunk_size`, `overlap_ratio`, and `top_k`.
   - `POST /api/prompt` must return `response`, `context`, and `Augmented_prompt`.
2. Run a tiny paid ingestion test on 25 articles only, after explicit approval.
3. Query the four required question types against the tiny index:
   - precise fact retrieval
   - up to 3 distinct titles
   - key idea summary
   - recommendation with evidence-based justification
4. Compare one or two alternate local chunk settings in the report, but avoid repeatedly embedding the full dataset.
5. Ingest the full dataset once only after the small-subset pipeline is correct.

## Efficiency Choices

- The runtime retrieves only `top_k=8` chunks, far below the maximum of 30.
- List-style questions prefer one chunk per article so the answer can return distinct article titles instead of repeated chunks from the same article.
- Non-list questions allow at most two chunks per article, preserving useful local context while avoiding unnecessary repetition.
- Precise article lookups dynamically keep only high-confidence chunks near the top match when the top score is strong.
- Very low-score retrieval matches are discarded before the augmented prompt is built.
- Hybrid lexical candidates are only used when enough meaningful query terms match, avoiding noisy context for unrelated questions.
