export function approximateTokenCount(text) {
  return Math.ceil((text || "").length / 4);
}

function splitWords(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function chunkArticle(article, config) {
  const title = clean(article.title);
  const authors = clean(article.authors);
  const tags = clean(article.tags);
  const url = clean(article.url);
  const text = clean(article.text);
  const metadataPrefix = [
    `Title: ${title}`,
    authors ? `Authors: ${authors}` : "",
    tags ? `Tags: ${tags}` : "",
    url ? `URL: ${url}` : ""
  ].filter(Boolean).join("\n");

  const bodyWords = splitWords(text);
  const wordsPerChunk = Math.max(80, Math.floor(config.chunk_size * 0.75));
  const overlapWords = Math.floor(wordsPerChunk * config.overlap_ratio);
  const step = Math.max(1, wordsPerChunk - overlapWords);
  const chunks = [];

  for (let start = 0; start < bodyWords.length; start += step) {
    const words = bodyWords.slice(start, start + wordsPerChunk);
    if (words.length === 0) {
      break;
    }

    chunks.push(`${metadataPrefix}\n\n${words.join(" ")}`);
    if (start + wordsPerChunk >= bodyWords.length) {
      break;
    }
  }

  return chunks.length > 0 ? chunks : [metadataPrefix];
}

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
