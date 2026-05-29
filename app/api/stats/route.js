import { NextResponse } from "next/server";
import { RAG_CONFIG } from "../../../lib/config.js";

export function GET() {
  return NextResponse.json({
    chunk_size: RAG_CONFIG.chunk_size,
    overlap_ratio: RAG_CONFIG.overlap_ratio,
    top_k: RAG_CONFIG.top_k
  });
}
