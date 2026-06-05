"use client";

import { useState } from "react";

const examples = [
  "List exactly 3 articles about education. Return only the titles.",
  "Find an article that argues past pandemics such as the bubonic plague can spur innovation and recovery, and summarise its central argument.",
  "I want practical, beginner-friendly advice on building habits that actually stick. Which article would you recommend, and why?",
  "Find an article that reframes marketing as a conversation with readers, aimed at writers who find self-promotion uncomfortable. Provide the title and author."
];

function groupContextByArticle(items) {
  const groups = new Map();

  for (const item of items) {
    const key = `${item.article_id || ""}:${item.title || ""}`;
    const score = Number(item.score || 0);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        article_id: item.article_id,
        title: item.title,
        chunk: item.chunk,
        score,
        chunkCount: 1
      });
      continue;
    }

    existing.chunkCount += 1;
    if (score > existing.score) {
      existing.score = score;
      existing.chunk = item.chunk;
    }
  }

  return [...groups.values()];
}

export default function Home() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");
  const [context, setContext] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const groupedContext = groupContextByArticle(context);

  async function submitQuestion(event) {
    event.preventDefault();
    setLoading(true);
    setStatus("Querying RAG pipeline...");
    setResponse("");
    setContext([]);

    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      setResponse(data.response || "");
      setContext(data.context || []);
      setStatus("Done");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>Medium RAG Assistant</h1>
          <p className="subtitle">Assignment API tester for the Medium articles dataset.</p>
        </div>
        <div className="stats" aria-label="RAG configuration">
          <span className="pill">chunk_size 768</span>
          <span className="pill">overlap 0.15</span>
          <span className="pill">top_k 8</span>
        </div>
      </div>

      <div className="shell">
        <section className="panel">
          <form onSubmit={submitQuestion}>
            <label htmlFor="question">Question</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about the Medium article dataset"
            />
            <div className="actions">
              <button disabled={loading || !question.trim()} type="submit">
                {loading ? "Running..." : "Ask"}
              </button>
              <span className="status">{status}</span>
            </div>
          </form>

          {response ? <div className="answer">{response}</div> : null}
        </section>

        <aside className="side">
          <div className="card">
            <h2>Examples</h2>
            <div className="context-list">
              {examples.map((example) => (
                <button key={example} type="button" onClick={() => setQuestion(example)}>
                  Use example
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Retrieved Context</h2>
            {context.length === 0 ? (
              <p className="subtitle">Context chunks will appear after a query.</p>
            ) : (
              <div className="context-list">
                {groupedContext.map((item) => (
                  <div className="context-item" key={`${item.article_id}-${item.title}`}>
                    <div className="context-title">{item.title}</div>
                    <div className="context-meta">
                      article_id {item.article_id} · score {Number(item.score || 0).toFixed(4)}
                      {item.chunkCount > 1 ? ` | ${item.chunkCount} chunks` : ""}
                    </div>
                    <div className="context-chunk">{item.chunk}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
