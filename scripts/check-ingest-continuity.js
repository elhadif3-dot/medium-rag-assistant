import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const startArg = process.argv.find((arg) => arg.startsWith("--start="));
const endArg = process.argv.find((arg) => arg.startsWith("--end="));
const startArticle = startArg ? Number(startArg.split("=")[1]) : 1;
const endArticle = endArg ? Number(endArg.split("=")[1]) : startArticle + 200;
const batchSize = 100;

const index = createPineconeIndex();
const missing = [];
let presentCount = 0;

for (let articleId = startArticle; articleId <= endArticle; articleId += batchSize) {
  const ids = [];
  const batchEnd = Math.min(endArticle, articleId + batchSize - 1);
  for (let id = articleId; id <= batchEnd; id++) {
    ids.push(`${id}-0`);
  }

  const result = await index.fetch(ids);
  const records = result.records || {};

  for (const id of ids) {
    if (records[id]) {
      presentCount++;
    } else {
      missing.push(id);
    }
  }
}

console.log(JSON.stringify({
  checked_article_ids: `${startArticle}-${endArticle}`,
  present_chunk_zero_count: presentCount,
  missing_chunk_zero_ids: missing,
  first_missing_chunk_zero_id: missing[0] || null
}, null, 2));
