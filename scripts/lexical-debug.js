import { createPineconeIndex } from "../lib/pinecone.js";
import { getLexicalCandidates, tokenizeForLexicalSearch, expandLexicalTerms } from "../lib/lexical.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const question = process.argv.slice(2).join(" ").trim();
if (!question) {
  throw new Error("Usage: npm run lexical-debug -- \"question\"");
}

const candidates = getLexicalCandidates(question, 12);
const index = createPineconeIndex();
const result = await index.fetch(candidates.map((candidate) => candidate.id));

console.log(JSON.stringify({
  question,
  terms: expandLexicalTerms(tokenizeForLexicalSearch(question)),
  candidates: candidates.map((candidate) => {
    const record = result.records?.[candidate.id];
    return {
      id: candidate.id,
      score: candidate.score,
      article_id: record?.metadata?.article_id,
      title: record?.metadata?.title,
      preview: String(record?.metadata?.chunk || "").slice(0, 220)
    };
  })
}, null, 2));
