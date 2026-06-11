"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { encode } from "uqr";
import type { Components } from "react-markdown";
import { SITE_ORIGIN } from "@/lib/site-url";

interface ShareCardProps {
  question: string;
  answer: string;
}

function QRCode({ url, size }: { url: string; size: number }) {
  const result = encode(url, { ecc: "M" });
  const matrix = result.data;
  const n = matrix.length;
  const cellSize = size / n;
  const rects: { x: number; y: number }[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) rects.push({ x: c * cellSize, y: r * cellSize });
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      {rects.map((pos, i) => (
        <rect key={i} x={pos.x} y={pos.y} width={cellSize} height={cellSize} fill="#2D2A1E" />
      ))}
    </svg>
  );
}

const mdComponents: Components = {
  p: ({ children }) => (
    <p style={{ margin: "0 0 10px 0", lineHeight: 1.9, color: "#2D2A1E" }}>{children}</p>
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: "bold", color: "#2D2A1E" }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: "italic", color: "#2D2A1E" }}>{children}</em>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "0 0 10px 0", paddingLeft: 20, color: "#2D2A1E" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0 0 10px 0", paddingLeft: 20, color: "#2D2A1E" }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ marginBottom: 4, lineHeight: 1.8, color: "#2D2A1E" }}>{children}</li>
  ),
  h1: ({ children }) => (
    <h1 style={{ fontSize: 17, fontWeight: "bold", margin: "0 0 8px 0", color: "#2D2A1E" }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: 16, fontWeight: "bold", margin: "0 0 8px 0", color: "#2D2A1E" }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 15, fontWeight: "bold", margin: "0 0 6px 0", color: "#2D2A1E" }}>{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: "3px solid #C9A84C",
      paddingLeft: 12,
      margin: "0 0 10px 0",
      color: "#5A4E2E",
      fontStyle: "italic",
    }}>
      {children}
    </blockquote>
  ),
};

export function ShareCard({ question, answer }: ShareCardProps) {
  const now = new Date();
  const timestamp = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  return (
    <div
      style={{
        width: 375,
        backgroundColor: "#FFFDF8",
        fontFamily: "'Noto Serif SC', 'Source Han Serif CN', '宋体', Georgia, serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top gold bar */}
      <div style={{ height: 5, backgroundColor: "#C9A84C", flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "18px 24px 14px",
        gap: 12,
        borderBottom: "1px solid rgba(180,150,60,0.2)",
        flexShrink: 0,
      }}>
        {/* Use background-image for reliable html2canvas rendering (objectFit not supported) */}
        <div style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          backgroundImage: "url(/buffett-avarta.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          flexShrink: 0,
        }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ color: "#2D2A1E", fontSize: 16, fontWeight: "bold" }}>Text Room</span>
          <span style={{ color: "#B8A060", fontSize: 11 }}>Talk with Buffett</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Question */}
        <div style={{
          padding: "13px 16px",
          backgroundColor: "rgba(201,168,76,0.09)",
          borderRadius: 8,
          borderLeft: "3px solid #C9A84C",
        }}>
          <p style={{
            color: "#5A4E2E",
            fontSize: 14,
            lineHeight: 1.85,
            fontStyle: "italic",
            margin: 0,
          }}>
            {question}
          </p>
        </div>

        {/* Answer */}
        <div style={{ fontSize: 14, lineHeight: 1.9, color: "#2D2A1E" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {answer}
          </ReactMarkdown>
        </div>
      </div>

      {/* Footer — follows body naturally, no marginTop:auto needed */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px 16px",
        borderTop: "1px solid rgba(180,150,60,0.18)",
        flexShrink: 0,
      }}>
        <span style={{ color: "#B8A060", fontSize: 12, letterSpacing: "0.04em" }}>{timestamp}</span>
        <div style={{
          padding: 5,
          backgroundColor: "#fff",
          borderRadius: 6,
          border: "1px solid rgba(180,150,60,0.25)",
          lineHeight: 0,
        }}>
          <QRCode url={SITE_ORIGIN} size={56} />
        </div>
      </div>

      {/* Bottom gold bar */}
      <div style={{ height: 5, backgroundColor: "#C9A84C", flexShrink: 0 }} />
    </div>
  );
}
