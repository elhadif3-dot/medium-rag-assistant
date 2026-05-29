import { Pinecone } from "@pinecone-database/pinecone";
import { getRuntimeConfig } from "../lib/env.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const args = new Set(process.argv.slice(2));
const create = args.has("--create");
const config = getRuntimeConfig();

if (!config.pineconeApiKey) {
  throw new Error("Missing PINECONE_API_KEY");
}

const pc = new Pinecone({ apiKey: config.pineconeApiKey });
const indexName = config.pineconeIndexName || "medium-rag";
const indexes = await pc.listIndexes();
const existing = (indexes.indexes || []).find((index) => index.name === indexName);

if (existing) {
  const description = await pc.describeIndex(indexName);
  console.log(JSON.stringify({
    status: "exists",
    name: description.name,
    dimension: description.dimension,
    metric: description.metric,
    deletionProtection: description.deletionProtection,
    spec: description.spec,
    ready: description.status?.ready ?? false
  }, null, 2));
  process.exit(0);
}

if (!create) {
  console.log(JSON.stringify({
    status: "missing",
    name: indexName,
    next_step: "Run npm run setup-pinecone -- --create to create it."
  }, null, 2));
  process.exit(0);
}

await pc.createIndex({
  name: indexName,
  dimension: 1536,
  metric: "cosine",
  deletionProtection: "disabled",
  spec: {
    serverless: {
      cloud: "aws",
      region: "us-east-1"
    }
  },
  waitUntilReady: true
});

const description = await pc.describeIndex(indexName);
console.log(JSON.stringify({
  status: "created",
  name: description.name,
  dimension: description.dimension,
  metric: description.metric,
  deletionProtection: description.deletionProtection,
  spec: description.spec,
  ready: description.status?.ready ?? false
}, null, 2));
