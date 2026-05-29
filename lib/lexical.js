import fs from "node:fs";

const LEXICAL_INDEX_URL = new URL("../data/lexical-index.json", import.meta.url);
const MAX_QUERY_TERMS = 10;

let cachedIndex = null;

export function getLexicalCandidates(question, limit, options = {}) {
  const index = loadLexicalIndex();
  if (!index) {
    return [];
  }

  const terms = tokenizeForLexicalSearch(question).slice(0, MAX_QUERY_TERMS);
  if (terms.length < 2 && !options.allowSingleTerm) {
    return [];
  }

  const scores = new Map();
  const termMatches = new Map();
  const minMatchedTerms = Math.min(2, terms.length);

  for (const originalTerm of terms) {
    const idsForTerm = new Set();

    for (const term of expandLexicalTerms([originalTerm], { includeMetadataBoost: true })) {
      const postings = index.postings[term] || [];
      if (postings.length === 0) {
        continue;
      }

      const rarityWeight = Math.log(1 + 1000 / postings.length);
      for (const id of postings) {
        scores.set(id, (scores.get(id) || 0) + rarityWeight);
        idsForTerm.add(id);
      }
    }

    for (const id of idsForTerm) {
      termMatches.set(id, (termMatches.get(id) || 0) + 1);
    }
  }

  const sorted = [...scores.entries()]
    .filter(([id]) => (termMatches.get(id) || 0) >= minMatchedTerms)
    .sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] || 1;

  return sorted.slice(0, limit).map(([id, score]) => ({
    id,
    score: Math.min(0.95, 0.35 + 0.6 * (score / maxScore))
  }));
}

export function tokenizeForLexicalSearch(text) {
  const stopwords = new Set([
    "about", "after", "also", "and", "answer", "article", "articles", "based",
    "actually", "advice", "argues", "argument", "because", "been", "beginner",
    "being", "between", "building", "cannot", "central", "could",
    "exactly", "find", "from", "give", "have", "into", "only", "provide",
    "friendly", "past", "practical", "recommend", "return", "should", "spur",
    "such", "summarize", "summarise", "that", "their",
    "there", "these", "this", "three", "title", "titles", "want", "what", "when",
    "where", "which", "with", "world", "would", "your"
  ]);

  const terms = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 3 && !/^\d+$/.test(term) && !stopwords.has(term));

  return [...new Set(terms)];
}

export function expandLexicalTerms(terms, options = {}) {
  const expanded = [];

  for (const term of terms) {
    expanded.push(term);
    if (options.includeMetadataBoost) {
      expanded.push(`^${term}`);
    }

    if (term.length >= 5) {
      const prefixTerm = `~${term.slice(0, 5)}`;
      expanded.push(prefixTerm);
      if (options.includeMetadataBoost) {
        expanded.push(`^${prefixTerm}`);
      }
    }
  }

  return [...new Set(expanded)];
}

function loadLexicalIndex() {
  if (cachedIndex) {
    return cachedIndex;
  }

  if (!fs.existsSync(LEXICAL_INDEX_URL)) {
    return null;
  }

  cachedIndex = JSON.parse(fs.readFileSync(LEXICAL_INDEX_URL, "utf8"));
  return cachedIndex;
}
