import { DEFAULT_ENV } from "./config.js";

export function env(name) {
  return process.env[name] || DEFAULT_ENV[name] || "";
}

export function requireEnv(names) {
  const missing = names.filter((name) => !env(name));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export function getRuntimeConfig() {
  return {
    llmodApiKey: env("LLMOD_API_KEY"),
    llmodBaseUrl: env("LLMOD_BASE_URL"),
    llmodChatModel: env("LLMOD_CHAT_MODEL"),
    llmodEmbeddingModel: env("LLMOD_EMBEDDING_MODEL"),
    pineconeApiKey: env("PINECONE_API_KEY"),
    pineconeIndexName: env("PINECONE_INDEX_NAME")
  };
}
