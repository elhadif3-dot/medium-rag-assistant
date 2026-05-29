import { loadLocalEnv } from "./load-local-env.js";
import { getRuntimeConfig } from "../lib/env.js";

loadLocalEnv();
const config = getRuntimeConfig();

const checks = [
  ["LLMOD_API_KEY", config.llmodApiKey],
  ["LLMOD_BASE_URL", config.llmodBaseUrl],
  ["LLMOD_CHAT_MODEL", config.llmodChatModel],
  ["LLMOD_EMBEDDING_MODEL", config.llmodEmbeddingModel],
  ["PINECONE_API_KEY", config.pineconeApiKey],
  ["PINECONE_INDEX_NAME", config.pineconeIndexName]
];

let ok = true;
for (const [name, value] of checks) {
  const placeholder = /^your_|^PASTE_/i.test(value || "");
  const status = value && !placeholder ? "SET" : placeholder ? "PLACEHOLDER" : "MISSING";
  if (status !== "SET") {
    ok = false;
  }
  console.log(`${name}: ${status} length=${value ? value.length : 0}`);
}

process.exit(ok ? 0 : 1);
