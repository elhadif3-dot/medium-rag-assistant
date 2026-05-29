const MAX_QUERY_TERMS = 10;

let cachedIndex = null;
let cachedIndexPromise = null;

export async function getLexicalCandidates(question, limit, options = {}) {
  const index = await loadLexicalIndex();
  return getLexicalCandidatesFromIndex(index, question, limit, options);
}

export function getLexicalCandidatesFromIndex(index, question, limit, options = {}) {
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
    .sort((a, b) => {
      const termMatchDifference = (termMatches.get(b[0]) || 0) - (termMatches.get(a[0]) || 0);
      if (termMatchDifference !== 0) {
        return termMatchDifference;
      }
      return b[1] - a[1];
    });
  const maxScore = sorted[0]?.[1] || 1;

  return sorted.slice(0, limit).map(([id, score]) => ({
    id,
    score: Math.min(0.62, 0.35 + 0.27 * (score / maxScore))
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

async function loadLexicalIndex() {
  if (cachedIndex) {
    return cachedIndex;
  }
  if (cachedIndexPromise) {
    return cachedIndexPromise;
  }

  cachedIndexPromise = readLexicalIndex();
  cachedIndex = await cachedIndexPromise;
  return cachedIndex;
}

async function readLexicalIndex() {
  const remoteUrl = getRemoteLexicalIndexUrl();
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { cache: "force-cache" });
    if (response.ok) {
      return response.json();
    }
  }

  return null;
}

function getRemoteLexicalIndexUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/lexical-index.json`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/lexical-index.json`;
  }
  return "";
}
