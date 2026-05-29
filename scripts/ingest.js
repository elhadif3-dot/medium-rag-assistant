import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { RAG_CONFIG } from "../lib/config.js";
import { chunkArticle, approximateTokenCount, clean } from "../lib/chunking.js";
import { embedTexts } from "../lib/llmod.js";
import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const args = new Set(process.argv.slice(2));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const confirmPaid = args.has("--confirm-paid");
const reset = args.has("--reset");

if (!confirmPaid) {
  console.error("Refusing to run ingestion without --confirm-paid.");
  console.error("This script calls the embedding model and consumes assignment budget.");
  console.error("Run a cost estimate first with: npm run estimate-cost");
  process.exit(1);
}

const csvPath = path.join(process.cwd(), "medium-english-50mb.csv");
const statePath = path.join(process.cwd(), "data", "ingest-state.json");
const embedBatchSize = 32;
const upsertBatchSize = 96;

fs.mkdirSync(path.dirname(statePath), { recursive: true });

let state = { lastArticleIndex: -1, vectorsUpserted: 0, embeddedTokens: 0 };
if (!reset && fs.existsSync(statePath)) {
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
}
if (reset) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const records = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true
});

const index = createPineconeIndex();
let vectors = [];
let pendingTexts = [];
let pendingMetadata = [];
let processedThisRun = 0;

for (let articleIndex = 0; articleIndex < records.length; articleIndex++) {
  if (articleIndex <= state.lastArticleIndex) {
    continue;
  }
  if (processedThisRun >= limit) {
    break;
  }

  const record = records[articleIndex];
  const articleId = String(articleIndex + 1);
  const chunks = chunkArticle(record, RAG_CONFIG);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    pendingTexts.push(chunks[chunkIndex]);
    pendingMetadata.push({
      id: `${articleId}-${chunkIndex}`,
      article_index: articleIndex,
      article_id: articleId,
      chunk_index: chunkIndex,
      title: clean(record.title),
      authors: clean(record.authors),
      url: clean(record.url),
      timestamp: clean(record.timestamp),
      tags: clean(record.tags),
      chunk: chunks[chunkIndex]
    });
  }

  if (pendingTexts.length >= embedBatchSize) {
    await embedAndQueue();
  }
  if (vectors.length >= upsertBatchSize) {
    await flushVectors();
  }

  processedThisRun++;
}

if (pendingTexts.length > 0) {
  await embedAndQueue();
}
if (vectors.length > 0) {
  await flushVectors();
}

writeState();
console.log("Ingestion complete.");
console.log(JSON.stringify(state, null, 2));

async function embedAndQueue() {
  const texts = pendingTexts;
  const metadata = pendingMetadata;
  pendingTexts = [];
  pendingMetadata = [];

  const embeddings = await embedTexts(texts);
  for (let i = 0; i < embeddings.length; i++) {
    vectors.push({
      id: metadata[i].id,
      values: embeddings[i],
      metadata: metadata[i]
    });
  }
  state.embeddedTokens += texts.reduce((sum, text) => sum + approximateTokenCount(text), 0);
}

async function flushVectors() {
  const batch = vectors;
  vectors = [];
  await index.upsert(batch);
  state.vectorsUpserted += batch.length;
  state.lastArticleIndex = Math.max(
    state.lastArticleIndex,
    ...batch.map((vector) => Number(vector.metadata.article_index))
  );
  writeState();
  console.log(`Upserted ${state.vectorsUpserted} vectors through article ${state.lastArticleIndex + 1}; embedded approx ${state.embeddedTokens} tokens.`);
}

function writeState() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
