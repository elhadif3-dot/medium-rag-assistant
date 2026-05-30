import fs from "node:fs";
import path from "node:path";

const DEFAULT_URL = "https://medium-rag-assistant-theta.vercel.app";
const baseUrl = (process.argv[2] || process.env.PUBLIC_APP_URL || DEFAULT_URL).replace(/\/$/, "");
const testsPath = path.resolve(process.argv[3] || process.env.TESTS_FILE || path.join("tests", "teacher-like-questions.json"));
const resultsDir = path.join(process.cwd(), "test-results");

const tests = JSON.parse(fs.readFileSync(testsPath, "utf8"));

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[-\u2010-\u2015]/g, " ").replace(/\s+/g, " ").trim();
}

function titleMatches(actual, expected) {
  return normalize(actual).includes(normalize(expected));
}

function nonEmptyLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function assertPromptShape(payload) {
  const requiredTopLevelKeys = ["response", "context", "Augmented_prompt"];
  const missingTopLevelKeys = requiredTopLevelKeys.filter((key) => !(key in payload));
  if (missingTopLevelKeys.length > 0) {
    return [`missing top-level keys: ${missingTopLevelKeys.join(", ")}`];
  }

  const failures = [];
  if (typeof payload.response !== "string") {
    failures.push("response must be a string");
  }
  if (!Array.isArray(payload.context)) {
    failures.push("context must be an array");
  } else {
    for (const [index, item] of payload.context.entries()) {
      const missingContextKeys = ["article_id", "title", "chunk", "score"].filter((key) => !(key in item));
      if (missingContextKeys.length > 0) {
        failures.push(`context[${index}] missing keys: ${missingContextKeys.join(", ")}`);
      }
    }
  }
  if (!payload.Augmented_prompt?.System || !payload.Augmented_prompt?.User) {
    failures.push("Augmented_prompt must include System and User");
  }

  return failures;
}

function checkResponse(payload, checks = {}) {
  const failures = [];
  const responseText = payload.response || "";
  const normalizedResponse = normalize(responseText);
  const context = Array.isArray(payload.context) ? payload.context : [];
  const contextTitles = context.map((item) => item.title || "");
  const distinctContextTitles = new Set(contextTitles.filter(Boolean));

  if (checks.responseIncludesAll) {
    for (const expected of checks.responseIncludesAll) {
      if (!normalizedResponse.includes(normalize(expected))) {
        failures.push(`response missing expected text: ${expected}`);
      }
    }
  }

  if (checks.responseIncludesAny) {
    const found = checks.responseIncludesAny.some((expected) => normalizedResponse.includes(normalize(expected)));
    if (!found) {
      failures.push(`response missing all expected alternatives: ${checks.responseIncludesAny.join(" | ")}`);
    }
  }

  if (checks.responseIncludesAnyEvidence) {
    const found = checks.responseIncludesAnyEvidence.some((expected) => normalizedResponse.includes(normalize(expected)));
    if (!found) {
      failures.push(`response missing expected evidence terms: ${checks.responseIncludesAnyEvidence.join(" | ")}`);
    }
  }

  if (checks.contextIncludesTitle) {
    const found = contextTitles.some((title) => titleMatches(title, checks.contextIncludesTitle));
    if (!found) {
      failures.push(`context missing expected title: ${checks.contextIncludesTitle}`);
    }
  }

  if (checks.contextIncludesAllTitles) {
    for (const expectedTitle of checks.contextIncludesAllTitles) {
      const found = contextTitles.some((title) => titleMatches(title, expectedTitle));
      if (!found) {
        failures.push(`context missing expected title: ${expectedTitle}`);
      }
    }
  }

  if (checks.contextIncludesAnyTitle) {
    const found = contextTitles.some((title) => {
      return checks.contextIncludesAnyTitle.some((expected) => titleMatches(title, expected));
    });
    if (!found) {
      failures.push(`context missing expected title alternatives: ${checks.contextIncludesAnyTitle.join(" | ")}`);
    }
  }

  if (Number.isInteger(checks.exactNonEmptyResponseLines)) {
    const lines = nonEmptyLines(responseText);
    if (lines.length !== checks.exactNonEmptyResponseLines) {
      failures.push(`expected ${checks.exactNonEmptyResponseLines} non-empty response lines, got ${lines.length}`);
    }
  }

  if (checks.onlyTitleLines) {
    const lines = nonEmptyLines(responseText);
    const badLine = lines.find((line) => {
      return /\b(because|context|recommended?|recommendation|evidence|here are|the article)\b/i.test(line) ||
        /\b(author|title)\s*:/i.test(line);
    });
    if (badLine) {
      failures.push(`response line does not look title-only: ${badLine}`);
    }
  }

  if (Number.isInteger(checks.distinctContextArticlesAtLeast)) {
    if (distinctContextTitles.size < checks.distinctContextArticlesAtLeast) {
      failures.push(`expected at least ${checks.distinctContextArticlesAtLeast} distinct context articles, got ${distinctContextTitles.size}`);
    }
  }

  if (Number.isInteger(checks.maxContextItems) && context.length > checks.maxContextItems) {
    failures.push(`expected at most ${checks.maxContextItems} context items, got ${context.length}`);
  }

  if (checks.expectUnknown) {
    const hasUnknown = /i don['’]t know based on the provided medium articles data/i.test(responseText);
    if (!hasUnknown) {
      failures.push("expected the required unknown-answer sentence");
    }
  }

  return failures;
}

async function callJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function validateStats() {
  const stats = await callJson(`${baseUrl}/api/stats`);
  const actualKeys = Object.keys(stats).sort();
  const expectedKeys = ["chunk_size", "overlap_ratio", "top_k"].sort();
  const validShape = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);
  const validValues = stats.chunk_size <= 1024 && stats.overlap_ratio <= 0.3 && stats.top_k <= 30;

  return {
    stats,
    failures: [
      ...(!validShape ? [`/api/stats wrong keys: ${actualKeys.join(", ")}`] : []),
      ...(!validValues ? ["/api/stats values violate assignment limits"] : [])
    ]
  };
}

async function runTest(test) {
  const startedAt = Date.now();
  const payload = await callJson(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: test.question })
  });
  const shapeFailures = assertPromptShape(payload);
  const behaviorFailures = checkResponse(payload, test.checks);
  const failures = [...shapeFailures, ...behaviorFailures];

  return {
    id: test.id,
    category: test.category,
    question: test.question,
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - startedAt,
    response: payload.response,
    context: (payload.context || []).map((item) => ({
      article_id: item.article_id,
      title: item.title,
      score: item.score
    }))
  };
}

const results = {
  baseUrl,
  ranAt: new Date().toISOString(),
  stats: null,
  tests: []
};

const statsResult = await validateStats();
results.stats = statsResult.stats;

if (statsResult.failures.length > 0) {
  console.error("Stats validation failed:");
  for (const failure of statsResult.failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}

for (const test of tests) {
  process.stdout.write(`running ${test.id}... `);
  try {
    const result = await runTest(test);
    results.tests.push(result);
    console.log(result.passed ? "PASS" : "FAIL");
    if (!result.passed) {
      for (const failure of result.failures) {
        console.log(`  - ${failure}`);
      }
      console.log(`  response: ${String(result.response || "").replace(/\s+/g, " ").slice(0, 400)}`);
      console.log(`  context: ${result.context.map((item) => `${item.article_id}:${item.title}`).join(" | ")}`);
    }
  } catch (error) {
    const result = {
      id: test.id,
      category: test.category,
      question: test.question,
      passed: false,
      failures: [error.message],
      response: "",
      context: []
    };
    results.tests.push(result);
    console.log("ERROR");
    console.log(`  - ${error.message}`);
  }
}

fs.mkdirSync(resultsDir, { recursive: true });
const resultsPath = path.join(resultsDir, `teacher-like-results-${Date.now()}.json`);
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

const passed = results.tests.filter((test) => test.passed).length;
const failed = results.tests.length - passed;
console.log(`\nsummary: ${passed}/${results.tests.length} passed`);
console.log(`results: ${resultsPath}`);

if (failed > 0 || statsResult.failures.length > 0) {
  process.exitCode = 1;
}
