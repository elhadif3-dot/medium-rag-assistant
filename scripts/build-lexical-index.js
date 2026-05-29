import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { RAG_CONFIG } from "../lib/config.js";
import { chunkArticle } from "../lib/chunking.js";
import { expandLexicalTerms, tokenizeForLexicalSearch } from "../lib/lexical.js";

const csvPath = path.join(process.cwd(), "medium-english-50mb.csv");
const outPath = path.join(process.cwd(), "data", "lexical-index.json");
const maxPostingsPerTerm = 1000;

fs.mkdirSync(path.dirname(outPath), { recursive: true });

const records = parse(fs.readFileSync(csvPath, "utf8"), {
  columns: true,
  skip_empty_lines: true
});

const postings = Object.create(null);
let chunkCount = 0;

for (let articleIndex = 0; articleIndex < records.length; articleIndex++) {
  const articleId = String(articleIndex + 1);
  const chunks = chunkArticle(records[articleIndex], RAG_CONFIG);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const id = `${articleId}-${chunkIndex}`;
    const metadataText = [
      records[articleIndex].title,
      records[articleIndex].tags
    ].filter(Boolean).join(" ");
    const terms = [
      ...expandLexicalTerms(tokenizeForLexicalSearch(chunks[chunkIndex])),
      ...expandLexicalTerms(tokenizeForLexicalSearch(metadataText), { includeMetadataBoost: true })
    ];

    for (const term of terms) {
      postings[term] ||= [];
      if (postings[term].length < maxPostingsPerTerm) {
        postings[term].push(id);
      }
    }

    chunkCount++;
  }
}

fs.writeFileSync(outPath, JSON.stringify({
  version: 1,
  chunk_size: RAG_CONFIG.chunk_size,
  overlap_ratio: RAG_CONFIG.overlap_ratio,
  chunks: chunkCount,
  max_postings_per_term: maxPostingsPerTerm,
  postings
}));

console.log(JSON.stringify({
  outPath,
  chunks: chunkCount,
  terms: Object.keys(postings).length
}, null, 2));
