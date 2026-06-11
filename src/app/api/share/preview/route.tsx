import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { encode } from "uqr";
import { SITE_ORIGIN } from "@/lib/site-url";

const FALLBACK_QUESTION = `护城河这个概念，你怎么理解？`;
const FALLBACK_ANSWER = `一家真正伟大的企业，必须有一道持久的\u201c护城河\u201d来保护投资资本获得卓越回报。资本主义的本质就是竞争——任何正在赚取高额回报的\u201c城堡\u201d，都会遭到竞争对手反复进攻。

因此，真正难以逾越的屏障，比如成为行业的低成本生产商，或者拥有强大的全球品牌，才是我最看重的东西。我们不会因为今天的护城河够宽就感到满足——我需要它每年都在变得更宽。`;

type Segment = { text: string; bold: boolean };

/**
 * Parse inline markdown (**bold** / __bold__) into segments.
 * Italic is intentionally ignored — satori CJK fonts don't support italic.
 * Bold is rendered as gold accent color instead of font-weight (no CJK bold font loaded).
 */
function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), bold: false });
    segments.push({ text: m[1] ?? m[2], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });
  return segments;
}

/**
 * Render markdown as satori JSX.
 * - Splits on double newline for paragraphs; single \n treated as space within a paragraph.
 * - List items (- / * / +) each become their own row.
 * - Bold shown as gold accent color (font-weight bold not reliable for CJK without font loading).
 */
function renderMarkdown(
  raw: string,
  base: { color: string; fontSize: number; lineHeight: number; letterSpacing: string },
) {
  const BOLD_COLOR = "#B8860B";
  const GAP = base.fontSize * 0.5;

  // Normalise: collapse 3+ newlines, strip leading/trailing whitespace
  const text = raw.replace(/\n{3,}/g, "\n\n").trim();

  // Split into paragraph blocks on blank lines
  const blocks = text.split(/\n\n+/);
  const elements: ReactElement[] = [];

  blocks.forEach((block, bi) => {
    if (bi > 0) {
      // Spacer between paragraphs
      elements.push(<div key={`gap-${bi}`} style={{ display: "flex", height: GAP }} />);
    }

    const lines = block.split("\n");

    lines.forEach((line, li) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Heading
      const hm = trimmed.match(/^#{1,3}\s+(.*)/);
      if (hm) {
        const segs = parseInline(hm[1]);
        elements.push(
          <div key={`${bi}-${li}`} style={{ display: "flex", flexWrap: "wrap", ...base }}>
            {segs.map((s, si) => (
              <span key={si} style={{ color: s.bold ? BOLD_COLOR : base.color }}>{s.text}</span>
            ))}
          </div>,
        );
        return;
      }

      // List item
      const lm = trimmed.match(/^[-*+]\s+(.*)/);
      if (lm) {
        const segs = parseInline(lm[1]);
        elements.push(
          <div key={`${bi}-${li}`} style={{ display: "flex", flexWrap: "wrap", ...base }}>
            <span style={{ color: BOLD_COLOR, marginRight: 10, flexShrink: 0 }}>•</span>
            <div style={{ display: "flex", flexWrap: "wrap", flex: 1 }}>
              {segs.map((s, si) => (
                <span key={si} style={{ color: s.bold ? BOLD_COLOR : base.color }}>{s.text}</span>
              ))}
            </div>
          </div>,
        );
        return;
      }

      // Normal text — strip remaining inline markers (* _ `) and render
      const cleaned = trimmed
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/_(.+?)_/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

      const segs = parseInline(cleaned);
      elements.push(
        <div key={`${bi}-${li}`} style={{ display: "flex", flexWrap: "wrap", ...base }}>
          {segs.map((s, si) => (
            <span key={si} style={{ color: s.bold ? BOLD_COLOR : base.color }}>{s.text}</span>
          ))}
        </div>,
      );
    });
  });

  return elements;
}

// Portrait: 9:16-ish, good for WeChat Moments
const W = 900;
const H = 1400;
const PAD = 56;

/** Build a minimal SVG QR code from uqr matrix data */
function buildQrSvg(url: string, size: number): string {
  const result = encode(url, { ecc: "M" });
  const matrix = result.data;
  const n = matrix.length;
  const cell = size / n;
  const rects: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        rects.push(
          `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#2D2A1E"/>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects.join("")}</svg>`;
}

/** Convert SVG string to base64 data URI */
function svgToDataUri(svg: string): string {
  const b64 = Buffer.from(svg).toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

/** Format current date as "YYYY年M月D日" */
function formatTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const QUESTION = (searchParams.get("q") ?? FALLBACK_QUESTION).slice(0, 120);
  const ANSWER = (searchParams.get("a") ?? FALLBACK_ANSWER).slice(0, 600);
  // Fetch avatar (non-blocking fallback)
  const avatarRes = await fetch(`${SITE_ORIGIN}/buffett-avarta.jpg`).catch(() => null);
  const avatarSrc = avatarRes?.ok
    ? `data:image/jpeg;base64,${Buffer.from(await avatarRes.arrayBuffer()).toString("base64")}`
    : null;

  // Build QR code for site URL
  const qrSvg = buildQrSvg(SITE_ORIGIN, 100);
  const qrSrc = svgToDataUri(qrSvg);

  const timestamp = formatTimestamp();

  // Truncate answer to fit portrait card (already capped at 600 chars above)
  const maxLen = 300;
  const truncated = ANSWER.length > maxLen
    ? ANSWER.slice(0, maxLen).trimEnd() + "…"
    : ANSWER;

  const answerStyle = { color: "#2D2A1E", fontSize: 26, lineHeight: 2.1, letterSpacing: "0.03em" };

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFDF8",
          fontFamily: "serif",
          position: "relative",
        }}
      >
        {/* Top gold bar */}
        <div style={{
          width: W,
          height: 6,
          backgroundColor: "#C9A84C",
          display: "flex",
          flexShrink: 0,
        }} />

        {/* Header: avatar + brand name */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: `36px ${PAD}px 28px`,
          gap: 18,
          borderBottom: "1px solid rgba(180,150,60,0.18)",
          flexShrink: 0,
        }}>
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              width={56}
              height={56}
              style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
              alt=""
            />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              backgroundColor: "#C9A84C", flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 26, fontWeight: "bold",
            }}>B</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: "#2D2A1E", fontSize: 28, fontWeight: "bold", letterSpacing: 0.5 }}>
              Text Room
            </span>
            <span style={{ color: "#B8A060", fontSize: 18 }}>
              Talk with Buffett
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: `44px ${PAD}px 40px`,
          gap: 32,
          overflow: "hidden",
        }}>
          {/* Question box */}
          <div style={{
            display: "flex",
            padding: "22px 28px",
            backgroundColor: "rgba(201,168,76,0.09)",
            borderRadius: 12,
            borderLeft: "4px solid #C9A84C",
          }}>
            <span style={{
              color: "#5A4E2E",
              fontSize: 27,
              lineHeight: 2,
              letterSpacing: "0.04em",
              fontStyle: "italic",
            }}>
              {QUESTION}
            </span>
          </div>

          {/* Answer */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}>
            {renderMarkdown(truncated, answerStyle)}
          </div>
        </div>

        {/* Footer: QR + tagline */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `20px ${PAD}px 28px`,
          borderTop: "1px solid rgba(180,150,60,0.18)",
          flexShrink: 0,
        }}>
          {/* Timestamp */}
          <span style={{ color: "#B8A060", fontSize: 20, letterSpacing: "0.05em" }}>
            {timestamp}
          </span>
          {/* QR code */}
          <div style={{
            padding: 8,
            backgroundColor: "#fff",
            borderRadius: 8,
            border: "1px solid rgba(180,150,60,0.25)",
            display: "flex",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} width={100} height={100} alt="QR" />
          </div>
        </div>

        {/* Bottom gold bar */}
        <div style={{
          width: W,
          height: 6,
          backgroundColor: "#C9A84C",
          display: "flex",
          flexShrink: 0,
        }} />
      </div>
    ),
    { width: W, height: H },
  );
}
