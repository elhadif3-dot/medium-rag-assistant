import { NextResponse } from "next/server";
import { answerQuestion } from "../../../lib/rag.js";

export const maxDuration = 60;

export async function POST(request) {
  try {
    const body = await request.json();
    const question = String(body.question || "").trim();

    if (!question) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const result = await answerQuestion(question);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to answer question" },
      { status: 500 }
    );
  }
}
