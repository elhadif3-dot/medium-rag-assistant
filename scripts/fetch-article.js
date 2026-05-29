import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const articleId = process.argv[2];
if (!articleId) {
  throw new Error("Usage: node scripts/fetch-article.js <article_id>");
}

const ids = Array.from({ length: 40 }, (_, index) => `${articleId}-${index}`);
const index = createPineconeIndex();
const result = await index.fetch(ids);
const records = Object.values(result.records || {}).sort((a, b) => {
  return Number(a.metadata?.chunk_index || 0) - Number(b.metadata?.chunk_index || 0);
});

console.log(JSON.stringify({
  article_id: articleId,
  chunk_count_found: records.length,
  chunks: records.map((record) => ({
    id: record.id,
    title: record.metadata?.title,
    authors: record.metadata?.authors,
    chunk_index: record.metadata?.chunk_index,
    chunk_preview: String(record.metadata?.chunk || "").slice(0, 500)
  }))
}, null, 2));
