"use client";

import { useEffect, useRef, useCallback, useReducer } from "react";
import * as pdfjs from "pdfjs-dist";

// Use bundled worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfReaderProps {
  src: string;
}

type State = {
  pdf: pdfjs.PDFDocumentProxy | null;
  numPages: number;
  page: number;
  scale: number;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; pdf: pdfjs.PDFDocumentProxy }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "SET_PAGE"; page: number }
  | { type: "ZOOM_IN" }
  | { type: "ZOOM_OUT" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, pdf: null, numPages: 0, page: 1, loading: true, error: null };
    case "LOAD_SUCCESS":
      return { ...state, pdf: action.pdf, numPages: action.pdf.numPages, loading: false };
    case "LOAD_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SET_PAGE":
      return { ...state, page: action.page };
    case "ZOOM_IN":
      return { ...state, scale: Math.min(3, +(state.scale + 0.2).toFixed(1)) };
    case "ZOOM_OUT":
      return { ...state, scale: Math.max(0.5, +(state.scale - 0.2).toFixed(1)) };
  }
}

export function PdfReader({ src }: PdfReaderProps) {
  const [state, dispatch] = useReducer(reducer, {
    pdf: null,
    numPages: 0,
    page: 1,
    scale: 1.3,
    loading: false,
    error: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  // Load PDF
  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "LOAD_START" });

    const task = pdfjs.getDocument(src);
    task.promise
      .then((doc) => {
        if (!cancelled) dispatch({ type: "LOAD_SUCCESS", pdf: doc });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("PDF load failed:", err);
          dispatch({ type: "LOAD_ERROR", error: "无法加载 PDF" });
        }
      });

    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [src]);

  // Render page
  useEffect(() => {
    if (!state.pdf || !canvasRef.current || !textLayerRef.current) return;

    const canvas = canvasRef.current;
    const textLayerDiv = textLayerRef.current;
    let cancelled = false;

    const renderPage = async () => {
      const pdfPage = await state.pdf!.getPage(state.page);
      const viewport = pdfPage.getViewport({ scale: state.scale });

      const container = containerRef.current;
      const containerWidth = container?.clientWidth ?? 800;
      const contentWidth = viewport.width;
      const left = Math.max(0, (containerWidth - contentWidth) / 2);
      canvas.style.marginLeft = `${left}px`;

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = contentWidth * pixelRatio;
      canvas.height = viewport.height * pixelRatio;
      canvas.style.width = `${contentWidth}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;

      if (cancelled) return;

      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${contentWidth}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.style.marginLeft = `${left}px`;

      const textContent = await pdfPage.getTextContent();
      const textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
    };

    renderPage().catch((err) => {
      if (!cancelled) console.error("Render failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [state.pdf, state.page, state.scale]);

  const goPage = useCallback(
    (delta: number) => {
      const next = Math.max(1, Math.min(state.numPages, state.page + delta));
      dispatch({ type: "SET_PAGE", page: next });
    },
    [state.numPages, state.page],
  );

  if (state.error) {
    return <div className="pdf-reader-error">{state.error}</div>;
  }

  return (
    <div className="pdf-reader-wrap">
      {/* Toolbar */}
      <div className="pdf-reader-bar">
        <button
          className="pdf-reader-btn"
          onClick={() => goPage(-1)}
          disabled={state.page <= 1 || state.loading}
          aria-label="上一页"
        >
          ←
        </button>
        <span className="pdf-reader-page">
          <input
            className="pdf-reader-input"
            type="number"
            value={state.page}
            min={1}
            max={state.numPages || 1}
            disabled={state.loading}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= state.numPages) dispatch({ type: "SET_PAGE", page: v });
            }}
          />
          <span className="pdf-reader-sep">/</span>
          <span>{state.numPages || "…"}</span>
        </span>
        <button
          className="pdf-reader-btn"
          onClick={() => goPage(1)}
          disabled={state.page >= state.numPages || state.loading}
          aria-label="下一页"
        >
          →
        </button>

        <span className="pdf-reader-gap" />

        <button className="pdf-reader-btn" onClick={() => dispatch({ type: "ZOOM_OUT" })} disabled={state.loading} aria-label="缩小">
          −
        </button>
        <span className="pdf-reader-zoom">{Math.round(state.scale * 100)}%</span>
        <button className="pdf-reader-btn" onClick={() => dispatch({ type: "ZOOM_IN" })} disabled={state.loading} aria-label="放大">
          +
        </button>
      </div>

      {/* Canvas + text layer */}
      {state.loading && <div className="pdf-reader-loading">加载中…</div>}
      <div ref={containerRef} className="pdf-reader-canvas-wrap">
        <div className="pdf-reader-page-area">
          <canvas ref={canvasRef} className="pdf-reader-canvas" />
          <div ref={textLayerRef} className="pdf-reader-text-layer" />
        </div>
      </div>
    </div>
  );
}
