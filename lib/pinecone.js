import { Pinecone } from "@pinecone-database/pinecone";
import { getRuntimeConfig } from "./env.js";

export function createPineconeIndex() {
  const config = getRuntimeConfig();
  if (!config.pineconeApiKey) {
    throw new Error("Missing PINECONE_API_KEY");
  }
  if (!config.pineconeIndexName) {
    throw new Error("Missing PINECONE_INDEX_NAME");
  }

  const pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
  return pinecone.index(config.pineconeIndexName);
}
