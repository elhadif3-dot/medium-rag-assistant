import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { RAG_CONFIG } from "../lib/config.js";
import { chunkArticle } from "../lib/chunking.js";
import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const csvPath = path.join(process.cwd(), "medium-english-50mb.csv");
const records = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true
});

const ids = [];
for (let articleIndex = 0; articleIndex < records.length; articleIndex++) {
  const articleId = String(articleIndex + 1);
  const chunks = chunkArticle(records[articleIndex], RAG_CONFIG);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    ids.push(`${articleId}-${chunkIndex}`);
  }
}

const index = createPineconeIndex();
const missing = [];
const batchSize = 100;

for (let start = 0; start < ids.length; start += batchSize) {
  const batch = ids.slice(start, start + batchSize);
  const result = await index.fetch(batch);
  const recordsById = result.records || {};
  for (const id of batch) {
    if (!recordsById[id]) {
      missing.push(id);
    }
  }
}

console.log(JSON.stringify({
  expectedVectorCount: ids.length,
  missingCount: missing.length,
  missingIds: missing
}, null, 2));
