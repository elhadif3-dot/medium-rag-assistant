import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { RAG_CONFIG } from "../lib/config.js";
import { approximateTokenCount, chunkArticle } from "../lib/chunking.js";

const csvPath = "medium-english-50mb.csv";
const EMBEDDING_PRICE_PER_M_TOKENS_USD = 0.02;
const CHAT_INPUT_PRICE_PER_M_TOKENS_USD = 0.25;
const CHAT_OUTPUT_PRICE_PER_M_TOKENS_USD = 2.0;

const records = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true
});

let totalTextChars = 0;
let totalEmbeddingTokens = 0;
let totalChunks = 0;
let maxChunks = 0;

for (const record of records) {
  totalTextChars += (record.text || "").length;
  const chunks = chunkArticle(record, RAG_CONFIG);
  totalChunks += chunks.length;
  maxChunks = Math.max(maxChunks, chunks.length);
  totalEmbeddingTokens += chunks.reduce((sum, chunk) => sum + approximateTokenCount(chunk), 0);
}

const embeddingCost = (totalEmbeddingTokens / 1_000_000) * EMBEDDING_PRICE_PER_M_TOKENS_USD;
const estimatedContextTokens = RAG_CONFIG.top_k * RAG_CONFIG.chunk_size;
const estimatedPromptTokens = estimatedContextTokens + 800;
const estimatedOutputTokens = 300;
const estimatedQueryCost =
  (estimatedPromptTokens / 1_000_000) * CHAT_INPUT_PRICE_PER_M_TOKENS_USD +
  (estimatedOutputTokens / 1_000_000) * CHAT_OUTPUT_PRICE_PER_M_TOKENS_USD;

const tinySubsetArticles = 25;
const tinySubsetRatio = tinySubsetArticles / records.length;
const tinySubsetEmbeddingCost = embeddingCost * tinySubsetRatio;
const validationQueries = 12;
const validationQueryCost = estimatedQueryCost * validationQueries;
const fullValidationQueries = 30;
const fullValidationQueryCost = estimatedQueryCost * fullValidationQueries;

console.log(JSON.stringify({
  rows: records.length,
  total_text_chars: totalTextChars,
  rag_config: RAG_CONFIG,
  approx_chunks: totalChunks,
  max_chunks_per_article: maxChunks,
  approx_embedding_tokens: totalEmbeddingTokens,
  approx_embedding_cost_usd: Number(embeddingCost.toFixed(4)),
  approx_cost_per_query_usd: Number(estimatedQueryCost.toFixed(4)),
  staged_budget_plan_usd: {
    tiny_subset_25_articles_embedding: Number(tinySubsetEmbeddingCost.toFixed(4)),
    tiny_subset_12_validation_queries: Number(validationQueryCost.toFixed(4)),
    full_dataset_embedding_once: Number(embeddingCost.toFixed(4)),
    full_dataset_30_validation_queries: Number(fullValidationQueryCost.toFixed(4)),
    planned_total: Number((tinySubsetEmbeddingCost + validationQueryCost + embeddingCost + fullValidationQueryCost).toFixed(4)),
    budget_limit: 5
  },
  note: "Uses 4 chars ~= 1 token and listed public OpenAI prices for a conservative assignment budget estimate."
}, null, 2));
