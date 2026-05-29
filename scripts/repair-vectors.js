import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { RAG_CONFIG } from "../lib/config.js";
import { approximateTokenCount, chunkArticle, clean } from "../lib/chunking.js";
import { embedTexts } from "../lib/llmod.js";
import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const args = process.argv.slice(2);
const confirmPaid = args.includes("--confirm-paid");
const ids = args.filter((arg) => !arg.startsWith("--"));

if (!confirmPaid) {
  console.error("Refusing repair without --confirm-paid because this calls the embedding model.");
  process.exit(1);
}

if (ids.length === 0) {
  throw new Error("Usage: npm run repair-vectors -- <articleId-chunkIndex> --confirm-paid");
}

const csvPath = path.join(process.cwd(), "medium-english-50mb.csv");
const statePath = path.join(process.cwd(), "data", "ingest-state.json");
const records = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true
});

const texts = [];
const metadata = [];

for (const id of ids) {
  const [articleIdText, chunkIndexText] = id.split("-");
  const articleId = Number(articleIdText);
  const chunkIndex = Number(chunkIndexText);
  const articleIndex = articleId - 1;
  const record = records[articleIndex];

  if (!record) {
    throw new Error(`Article not found for id ${id}`);
  }

  const chunks = chunkArticle(record, RAG_CONFIG);
  const chunk = chunks[chunkIndex];
  if (!chunk) {
    throw new Error(`Chunk not found for id ${id}`);
  }

  texts.push(chunk);
  metadata.push({
    id,
    article_index: articleIndex,
    article_id: String(articleId),
    chunk_index: chunkIndex,
    title: clean(record.title),
    authors: clean(record.authors),
    url: clean(record.url),
    timestamp: clean(record.timestamp),
    tags: clean(record.tags),
    chunk
  });
}

const embeddings = await embedTexts(texts);
const vectors = embeddings.map((values, index) => ({
  id: metadata[index].id,
  values,
  metadata: metadata[index]
}));

const index = createPineconeIndex();
await index.upsert(vectors);

if (fs.existsSync(statePath)) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.vectorsUpserted = Number(state.vectorsUpserted || 0) + vectors.length;
  state.embeddedTokens = Number(state.embeddedTokens || 0) + texts.reduce((sum, text) => sum + approximateTokenCount(text), 0);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

console.log(JSON.stringify({
  repairedIds: ids,
  repairedVectorCount: vectors.length
}, null, 2));
