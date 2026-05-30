import { RAG_CONFIG, SYSTEM_PROMPT } from "./config.js";
import { embedTexts } from "./llmod.js";
import { createPineconeIndex } from "./pinecone.js";
import { chatWithContext } from "./llmod.js";
import { getLexicalCandidates } from "./lexical.js";

const MIN_RELEVANCE_SCORE = 0.35;

export function buildUserPrompt(question, contexts) {
  const contextText = contexts.map((item, index) => {
    return [
      `[Context ${index + 1}]`,
      `article_id: ${item.article_id}`,
      `title: ${item.title}`,
      item.authors ? `authors: ${item.authors}` : null,
      item.url ? `url: ${item.url}` : null,
      item.tags ? `tags: ${item.tags}` : null,
      item.timestamp ? `timestamp: ${item.timestamp}` : null,
      `score: ${Number(item.score || 0).toFixed(4)}`,
      `chunk: ${item.chunk}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return `Question:
${question}

Retrieved Medium article context:
${contextText || "(no context retrieved)"}

Answer using only the retrieved Medium article context.
If the user asks for an exact number of titles or results, return exactly that number when the context supports it.
For topic-listing questions, article title and tags metadata are valid evidence that an article matches the requested topic.
If the user asks for only titles, do not add explanations.`;
}

export function buildCompoundUserPrompt(question, subQuestions, contexts) {
  const subQuestionList = subQuestions
    .map((subQuestion, index) => `${index + 1}. ${subQuestion}`)
    .join("\n");
  const contextText = contexts.map((item, index) => {
    return [
      `[Context ${index + 1}]`,
      item.source_question ? `subquestion: ${item.source_question}` : null,
      `article_id: ${item.article_id}`,
      `title: ${item.title}`,
      item.authors ? `authors: ${item.authors}` : null,
      item.url ? `url: ${item.url}` : null,
      item.tags ? `tags: ${item.tags}` : null,
      item.timestamp ? `timestamp: ${item.timestamp}` : null,
      `score: ${Number(item.score || 0).toFixed(4)}`,
      `chunk: ${item.chunk}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return `The user asked a multi-part question.

Original question:
${question}

Subquestions:
${subQuestionList}

Retrieved Medium article context:
${contextText || "(no context retrieved)"}

Answer each subquestion in order, using only the retrieved Medium article context.
For each subquestion, prefer the contexts labeled with the matching subquestion number.
If one subquestion asks for only titles, apply that restriction only to that subquestion.
If a subquestion cannot be determined from its retrieved context, respond for that subquestion: "I don\u2019t know based on the provided Medium articles data."`;
}

export async function retrieveContext(question, options = {}) {
  const searchQueries = buildSearchQueries(question);
  const queryEmbeddings = await embedTexts(searchQueries);
  const index = createPineconeIndex();
  const listingQuestion = isMultiResultListing(question);
  const candidateTopK = listingQuestion ? Math.min(30, RAG_CONFIG.top_k * 4) : RAG_CONFIG.top_k;

  const results = await Promise.all(queryEmbeddings.map((queryEmbedding) => {
    return index.query({
      vector: queryEmbedding,
      topK: candidateTopK,
      includeMetadata: true
    });
  }));

  const matchesById = new Map();
  for (const result of results) {
    for (const match of result.matches || []) {
      const existing = matchesById.get(match.id);
      if (!existing || Number(match.score || 0) > Number(existing.score || 0)) {
        matchesById.set(match.id, match);
      }
    }
  }

  const lexicalCandidates = await getLexicalCandidates(question, candidateTopK, {
    allowSingleTerm: listingQuestion,
    siteUrl: options.siteUrl
  });
  if (lexicalCandidates.length > 0) {
    const lexicalResult = await index.fetch(lexicalCandidates.map((candidate) => candidate.id));
    const lexicalScores = new Map(lexicalCandidates.map((candidate) => [candidate.id, candidate.score]));

    for (const [id, record] of Object.entries(lexicalResult.records || {})) {
      const lexicalScore = lexicalScores.get(id) || 0;
      const existing = matchesById.get(id);
      if (!existing || lexicalScore > Number(existing.score || 0)) {
        matchesById.set(id, {
          id,
          score: lexicalScore,
          metadata: record.metadata || {}
        });
      }
    }
  }

  const contexts = [...matchesById.values()]
    .map((match) => ({
      article_id: String(match.metadata?.article_id || ""),
      title: String(match.metadata?.title || ""),
      authors: String(match.metadata?.authors || ""),
      url: String(match.metadata?.url || ""),
      tags: String(match.metadata?.tags || ""),
      timestamp: String(match.metadata?.timestamp || ""),
      chunk: String(match.metadata?.chunk || ""),
      score: Number(match.score || 0)
    }))
    .sort((a, b) => b.score - a.score);

  return selectContextForQuestion(question, contexts);
}

export async function answerQuestion(question, options = {}) {
  const subQuestions = splitCompoundQuestions(question);
  if (subQuestions.length > 1) {
    return answerCompoundQuestion(question, subQuestions, options);
  }

  const context = await retrieveContext(question, options);
  const userPrompt = buildUserPrompt(question, context);
  const response = await chatWithContext([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ]);

  return {
    response,
    context: context.map(toApiContext),
    Augmented_prompt: {
      System: SYSTEM_PROMPT,
      User: userPrompt
    }
  };
}

async function answerCompoundQuestion(question, subQuestions, options = {}) {
  const contextGroups = [];

  for (const [index, subQuestion] of subQuestions.entries()) {
    const contexts = await retrieveContext(subQuestion, options);
    contextGroups.push(contexts.map((context) => ({
      ...context,
      source_question: index + 1
    })));
  }

  const context = roundRobinDistinctContexts(contextGroups, RAG_CONFIG.top_k);
  const userPrompt = buildCompoundUserPrompt(question, subQuestions, context);
  const response = await chatWithContext([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ]);

  return {
    response,
    context: context.map(toApiContext),
    Augmented_prompt: {
      System: SYSTEM_PROMPT,
      User: userPrompt
    }
  };
}

function roundRobinDistinctContexts(contextGroups, limit) {
  const selected = [];
  const seenIds = new Set();
  const maxGroupLength = Math.max(0, ...contextGroups.map((group) => group.length));

  for (let offset = 0; offset < maxGroupLength; offset++) {
    for (const group of contextGroups) {
      const context = group[offset];
      if (!context || seenIds.has(context.id || `${context.article_id}-${context.chunk}`)) {
        continue;
      }

      selected.push(context);
      seenIds.add(context.id || `${context.article_id}-${context.chunk}`);

      if (selected.length >= limit) {
        return selected;
      }
    }
  }

  return selected;
}

function selectContextForQuestion(question, contexts) {
  const listingQuestion = isMultiResultListing(question);
  const preciseQuestion = !listingQuestion && isPreciseRetrieval(question);
  const recommendationQuestion = !listingQuestion && isRecommendationQuestion(question);
  const rankedContexts = listingQuestion ? rankListingContexts(question, contexts) : contexts;
  const requestedCount = listingQuestion ? requestedResultCount(question) : RAG_CONFIG.top_k;
  const maxPerArticle = listingQuestion ? 1 : 2;
  const maxSelected = preciseQuestion ? 4 : recommendationQuestion ? 4 : Math.min(RAG_CONFIG.top_k, requestedCount);
  const topScore = Number(rankedContexts[0]?.score || 0);
  const topArticleKey = rankedContexts[0]?.article_id || rankedContexts[0]?.title || "";
  const preciseMinScore = preciseQuestion && topScore >= 0.6 ? topScore - 0.18 : 0;
  const minScore = Math.max(MIN_RELEVANCE_SCORE, preciseMinScore);
  const lockToTopArticle = preciseQuestion && topScore >= 0.6 && rankedContexts
    .filter((context) => (context.article_id || context.title) === topArticleKey)
    .filter((context) => context.score >= minScore)
    .length >= 2;
  const articleCounts = new Map();
  const selected = [];

  for (const context of rankedContexts) {
    if (context.score < minScore) {
      continue;
    }

    const key = context.article_id || context.title;
    if (lockToTopArticle && key !== topArticleKey) {
      continue;
    }

    const count = articleCounts.get(key) || 0;
    if (count >= maxPerArticle) {
      continue;
    }

    selected.push(context);
    articleCounts.set(key, count + 1);

    if (selected.length >= maxSelected) {
      break;
    }
  }

  return selected;
}

function rankListingContexts(question, contexts) {
  const topic = extractListingTopic(question);
  if (!topic) {
    return contexts;
  }

  const topicTerms = topic.split(/\s+/).filter((term) => term.length > 2);
  if (topicTerms.length === 0) {
    return contexts;
  }

  return [...contexts].sort((a, b) => {
    const aMatch = listingMetadataMatch(a, topicTerms);
    const bMatch = listingMetadataMatch(b, topicTerms);
    if (aMatch !== bMatch) {
      return bMatch - aMatch;
    }
    return b.score - a.score;
  });
}

function listingMetadataMatch(context, topicTerms) {
  const metadataText = `${context.title} ${context.tags}`.toLowerCase();
  return topicTerms.some((term) => metadataText.includes(term)) ? 1 : 0;
}

function toApiContext(context) {
  return {
    article_id: context.article_id,
    title: context.title,
    chunk: context.chunk,
    score: context.score
  };
}

function isMultiResultListing(question) {
  const normalized = question.toLowerCase();
  return (
    /\blist\b/.test(normalized) ||
    /\bexactly\s+[1-3]\b/.test(normalized) ||
    /\breturn\s+only\s+the\s+titles?\b/.test(normalized) ||
    /\bmultiple\b/.test(normalized)
  );
}

function isPreciseRetrieval(question) {
  const normalized = question.toLowerCase();
  return (
    /\bfind\s+(?:an?|the)\s+article\b/.test(normalized) ||
    /\blocate\s+(?:an?|the)\s+article\b/.test(normalized) ||
    /\bsingle\b/.test(normalized) ||
    /\btitle\s+and\s+author\b/.test(normalized)
  );
}

function isRecommendationQuestion(question) {
  const normalized = question.toLowerCase();
  return (
    /\brecommend\b/.test(normalized) ||
    /\bwhich article\b/.test(normalized) ||
    /\bwhy\?\s*$/.test(normalized)
  );
}

function requestedResultCount(question) {
  const normalized = question.toLowerCase();
  const exactMatch = normalized.match(/\b(?:exactly|list|return|show)\s+([1-3])\b/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }
  return 3;
}

function buildSearchQueries(question) {
  const queries = [question];
  const keywordQuery = extractSearchKeywords(question);

  if (keywordQuery && keywordQuery.toLowerCase() !== question.toLowerCase()) {
    queries.push(keywordQuery);
  }

  return queries.slice(0, 2);
}

function extractSearchKeywords(question) {
  const stopwords = new Set([
    "about", "after", "also", "and", "answer", "article", "articles", "based",
    "can", "central", "could", "exactly", "find", "for", "from", "give",
    "that", "the", "their", "this", "title", "titles", "what", "which",
    "with", "would", "your", "summarize", "summarise", "argument", "provide",
    "return", "only", "list", "one", "two", "three", "such", "past"
  ]);

  const terms = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3 && !stopwords.has(term));

  return [...new Set(terms)].join(" ");
}

function extractListingTopic(question) {
  const normalized = question.toLowerCase();
  const match = normalized.match(/\b(?:about|on|related to)\s+(.+?)(?:\.|,|;|$)/);
  if (!match) {
    return "";
  }
  return match[1]
    .replace(/\b(return|only|the|titles?|articles?|exactly|list|show|give|me|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCompoundQuestions(question) {
  const normalized = String(question || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(/(?:,\s*)?\band\s+(?=(?:find|list|show|recommend|who|what|which|give|return)\b)/i)
    .map((part) => part.replace(/^[,;\s]+|[,;\s]+$/g, "").trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return [normalized];
  }

  return parts.slice(0, 4);
}
