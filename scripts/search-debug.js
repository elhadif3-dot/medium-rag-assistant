import { embedTexts } from "../lib/llmod.js";
import { createPineconeIndex } from "../lib/pinecone.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const targetArticleIdArg = process.argv.find((arg) => arg.startsWith("--target="));
const topKArg = process.argv.find((arg) => arg.startsWith("--topK="));
const targetArticleId = targetArticleIdArg ? targetArticleIdArg.split("=")[1] : "";
const topK = topKArg ? Number(topKArg.split("=")[1]) : 30;
const question = process.argv.filter((arg) => !arg.startsWith("--")).slice(2).join(" ").trim();

if (!question) {
  throw new Error("Usage: node scripts/search-debug.js --target=6300 --topK=30 \"question\"");
}

const [embedding] = await embedTexts([question]);
const index = createPineconeIndex();
const result = await index.query({
  vector: embedding,
  topK,
  includeMetadata: true
});

const rows = (result.matches || []).map((match, index) => ({
  rank: index + 1,
  id: match.id,
  article_id: String(match.metadata?.article_id || ""),
  title: match.metadata?.title,
  score: match.score
}));

console.log(JSON.stringify({
  question,
  topK,
  targetArticleId,
  targetRanks: rows.filter((row) => row.article_id === targetArticleId),
  rows
}, null, 2));
