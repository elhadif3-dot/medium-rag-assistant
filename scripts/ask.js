import { answerQuestion } from "../lib/rag.js";
import { loadLocalEnv } from "./load-local-env.js";

loadLocalEnv();

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  throw new Error("Usage: npm run ask -- \"Your question\"");
}

const result = await answerQuestion(question);
const requiredKeys = ["response", "context", "Augmented_prompt"];
const missingKeys = requiredKeys.filter((key) => !(key in result));

console.log(JSON.stringify({
  question,
  missingKeys,
  response: result.response,
  contextCount: result.context.length,
  context: result.context.map((item) => ({
    article_id: item.article_id,
    title: item.title,
    score: item.score
  })),
  hasSystemPrompt: Boolean(result.Augmented_prompt?.System),
  hasUserPrompt: Boolean(result.Augmented_prompt?.User)
}, null, 2));
