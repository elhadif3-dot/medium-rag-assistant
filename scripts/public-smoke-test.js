const DEFAULT_URL = "https://medium-rag-assistant-theta.vercel.app";

const baseUrl = (process.argv[2] || process.env.PUBLIC_APP_URL || DEFAULT_URL).replace(/\/$/, "");

const tests = [
  {
    name: "precise",
    question: "Find an article that reframes marketing as a conversation with readers, aimed at writers who find self-promotion uncomfortable. Provide the title and author."
  },
  {
    name: "listing",
    question: "List exactly 3 articles about education. Return only the titles."
  },
  {
    name: "summary",
    question: "Find an article that argues past pandemics such as the bubonic plague can spur innovation and recovery, and summarise its central argument."
  },
  {
    name: "recommendation",
    question: "I want practical, beginner-friendly advice on building habits that actually stick. Which article would you recommend, and why?"
  }
];

function assertPromptShape(payload) {
  const requiredTopLevelKeys = ["response", "context", "Augmented_prompt"];
  const missing = requiredTopLevelKeys.filter((key) => !(key in payload));

  if (missing.length > 0) {
    throw new Error(`Missing top-level keys: ${missing.join(", ")}`);
  }

  if (!Array.isArray(payload.context)) {
    throw new Error("context must be an array");
  }

  for (const item of payload.context) {
    const missingContextKeys = ["article_id", "title", "chunk", "score"].filter((key) => !(key in item));
    if (missingContextKeys.length > 0) {
      throw new Error(`Context item missing keys: ${missingContextKeys.join(", ")}`);
    }
  }

  if (!payload.Augmented_prompt?.System || !payload.Augmented_prompt?.User) {
    throw new Error("Augmented_prompt must include System and User");
  }
}

async function testStats() {
  const response = await fetch(`${baseUrl}/api/stats`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`/api/stats failed with ${response.status}`);
  }

  const expectedKeys = ["chunk_size", "overlap_ratio", "top_k"];
  const actualKeys = Object.keys(payload);
  const exactShape = expectedKeys.length === actualKeys.length && expectedKeys.every((key) => actualKeys.includes(key));

  if (!exactShape) {
    throw new Error(`/api/stats has wrong keys: ${actualKeys.join(", ")}`);
  }

  console.log("stats", JSON.stringify(payload));
}

async function testPrompt({ name, question }) {
  const response = await fetch(`${baseUrl}/api/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question })
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${name} failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = JSON.parse(text);
  assertPromptShape(payload);

  console.log(`\n--- ${name} ---`);
  console.log("response:", payload.response.replace(/\s+/g, " ").slice(0, 900));
  console.log("contextCount:", payload.context.length);
  console.log("contextTitles:", payload.context
    .map((item) => `${item.article_id}:${item.title}:${Number(item.score || 0).toFixed(4)}`)
    .join(" | "));
}

await testStats();

for (const test of tests) {
  await testPrompt(test);
}
