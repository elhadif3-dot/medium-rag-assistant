import OpenAI from "openai";
import { getRuntimeConfig } from "./env.js";

export function createLlmodClient() {
  const config = getRuntimeConfig();
  if (!config.llmodApiKey) {
    throw new Error("Missing LLMOD_API_KEY");
  }

  return new OpenAI({
    apiKey: config.llmodApiKey,
    baseURL: config.llmodBaseUrl
  });
}

export async function embedTexts(texts) {
  const config = getRuntimeConfig();
  const client = createLlmodClient();
  const result = await client.embeddings.create({
    model: config.llmodEmbeddingModel,
    input: texts
  });
  return result.data.map((item) => item.embedding);
}

export async function chatWithContext(messages) {
  const config = getRuntimeConfig();
  const client = createLlmodClient();
  const result = await client.chat.completions.create({
    model: config.llmodChatModel,
    messages
  });
  return result.choices?.[0]?.message?.content?.trim() || "";
}
