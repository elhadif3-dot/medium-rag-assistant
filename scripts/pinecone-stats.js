import { Pinecone } from "@pinecone-database/pinecone";
import { getRuntimeConfig } from "../lib/env.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const config = getRuntimeConfig();

if (!config.pineconeApiKey) {
  throw new Error("Missing PINECONE_API_KEY");
}

const pc = new Pinecone({ apiKey: config.pineconeApiKey });
const indexName = config.pineconeIndexName || "medium-rag";
const index = pc.index(indexName);
const stats = await index.describeIndexStats();

console.log(JSON.stringify({
  index: indexName,
  dimension: stats.dimension,
  totalVectorCount: stats.totalRecordCount ?? stats.totalVectorCount ?? 0,
  namespaces: stats.namespaces || {}
}, null, 2));
