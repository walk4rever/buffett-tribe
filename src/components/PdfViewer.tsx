'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs';

// Predefined CJK CID fonts (common in A-share/HK annual report PDFs) resolve
// glyphs through external CMap files, not the embedded font program — without
// these, pdf.js silently drops the Chinese text while digits/images (which
// don't need a CMap) still render fine.
const PDFJS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38';
const CMAP_URL = `${PDFJS_CDN_BASE}/cmaps/`;
const STANDARD_FONT_DATA_URL = `${PDFJS_CDN_BASE}/standard_fonts/`;

interface PdfViewerProps {
  url: string;
  title?: string;
  backHref?: string;
}

type ViewMode = 'continuous' | 'single';
type FitMode = 'width' | 'height';
type SidebarMode = 'thumbs' | 'outline';

interface PdfOutlineItem {
  title: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  items?: PdfOutlineItem[];
}

interface TextItem {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
  hasEOL: boolean;
}

const VIEW_MODE_STORAGE_KEY = 'pdf-viewer-mode';

function renderTextLayer(
  items: TextItem[],
  viewport: pdfjs.PageViewport,
  container: HTMLDivElement,
) {
  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const item of items) {
    if (!item.str) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[0], tx[1]);
    const fontWidth = Math.hypot(tx[2], tx[3]);
    const scaleX = fontHeight ? fontWidth / fontHeight : 1;

    const span = document.createElement('span');
    span.textContent = item.str;
    span.style.position = 'absolute';
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = item.fontName || 'sans-serif';
    span.style.whiteSpace = 'pre';
    span.style.userSelect = 'text';
    span.style.color = 'transparent';
    span.style.cursor = 'text';
    span.style.transform = `scaleX(${scaleX})`;
    span.style.transformOrigin = '0% 0%';
    span.setAttribute('role', 'presentation');
    frag.appendChild(span);
  }

  container.appendChild(frag);
}

function ThumbImg({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" />;
}

function ContinuousPage({
  doc,
  pageNum,
  scale,
  active,
}: {
  doc: pdfjs.PDFDocumentProxy;
  pageNum: number;
  scale: number;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    let cancelled = false;

    const render = async () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }

      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (textLayerRef.current) {
          const textContent = await page.getTextContent();
          if (!cancelled) {
            renderTextLayer(
              textContent.items as TextItem[],
              page.getViewport({ scale }),
              textLayerRef.current,
            );
          }
        }
      } catch (err) {
        const maybe = err as { name?: string };
        if (maybe.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [active, doc, pageNum, scale]);

  return (
    <div className="pdf-page-wrap" data-page-wrap={pageNum}>
      {!active && <div className="pdf-page-skeleton" />}
      <canvas ref={canvasRef} style={{ display: active ? 'block' : 'none' }} />
      <div
        ref={textLayerRef}
        className="pdf-text-layer"
        style={{ display: active ? 'block' : 'none' }}
      />
    </div>
  );
}

export default function PdfViewer({ url, title, backHref }: PdfViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const singleCanvasRef = useRef<HTMLCanvasElement>(null);
  const singleTextLayerRef = useRef<HTMLDivElement>(null);
  const singleRenderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const thumbsObsRef = useRef<IntersectionObserver | null>(null);
  const pendingThumbsRef = useRef<Set<number>>(new Set());
  const thumbsContainerRef = useRef<HTMLDivElement>(null);
  const visiblePagesRef = useRef<Map<number, number>>(new Map());
  const pageElementsRef = useRef<Record<number, HTMLDivElement | null>>({});
  const pageObserverRef = useRef<IntersectionObserver | null>(null);

  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [outlineItems, setOutlineItems] = useState<PdfOutlineItem[]>([]);
  const [outlinePageByKey, setOutlinePageByKey] = useState<Record<string, number>>({});
  const [activeOutlineKey, setActiveOutlineKey] = useState<string | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('thumbs');
  const [viewMode, setViewMode] = useState<ViewMode>('continuous');
  const [fitMode, setFitMode] = useState<FitMode>('width');
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInput, setPageInput] = useState('1');
  const [renderedPages, setRenderedPages] = useState<Record<number, boolean>>({});

  const pageNumRef = useRef(pageNum);
  pageNumRef.current = pageNum;

  const getFitTargetPage = useCallback(() => {
    return viewMode === 'single' ? pageNum : 1;
  }, [pageNum, viewMode]);

  // 客户端挂载后读取 localStorage，避免 hydration mismatch
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === 'single' || saved === 'continuous') {
      setViewMode(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!isEditingPage) {
      setPageInput(String(pageNum));
    }
  }, [isEditingPage, pageNum]);

  useEffect(() => {
    let nextKey: string | null = null;
    let nextPage = 0;

    Object.entries(outlinePageByKey).forEach(([key, page]) => {
      if (page <= pageNum && page >= nextPage) {
        nextKey = key;
        nextPage = page;
      }
    });

    setActiveOutlineKey(nextKey);
  }, [outlinePageByKey, pageNum]);

  useEffect(() => {
    if (sidebarMode !== 'outline' || !activeOutlineKey) return;

    const activeItem = thumbsContainerRef.current?.querySelector<HTMLElement>(
      `.pdf-outline-item[data-outline-key="${activeOutlineKey}"]`,
    );
    activeItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeOutlineKey, sidebarMode]);

  const updateFitWidthScale = useCallback(
    (targetPageNum: number) => {
      const stage = stageRef.current;
      if (!stage || !doc) return;

      doc.getPage(targetPageNum).then((page) => {
        const style = window.getComputedStyle(stage);
        const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const sidebarW = window.innerWidth <= 640 ? 0 : 170;
        const availW = stage.clientWidth - padX - sidebarW;
        const vw = page.getViewport({ scale: 1 }).width;
        const fitScale = Math.max(0.5, Math.min(availW / vw, 3));
        setScale((prev) => (Math.abs(prev - fitScale) > 0.01 ? fitScale : prev));
      });
    },
    [doc],
  );

  useEffect(() => {
    let cancelled = false;
    pendingThumbsRef.current = new Set();
    visiblePagesRef.current = new Map();
    pageElementsRef.current = {};
    setOutlineItems([]);
    setOutlinePageByKey({});
    setActiveOutlineKey(null);
    setSidebarMode('thumbs');

    pdfjs
      .getDocument({
        url,
        cMapUrl: CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
      })
      .promise.then(async (loadedDoc) => {
        if (cancelled) {
          loadedDoc.destroy();
          return;
        }
        setDoc(loadedDoc);
        setNumPages(loadedDoc.numPages);
        setRenderedPages({});
        loadedDoc.getOutline().then(async (outline) => {
          if (cancelled) return;

          const items = (outline || []) as PdfOutlineItem[];
          const pageByKey: Record<string, number> = {};

          const collectOutlinePages = async (nodes: PdfOutlineItem[], parentKey = '') => {
            for (let index = 0; index < nodes.length; index += 1) {
              const item = nodes[index];
              const key = `${parentKey}${index}`;

              try {
                const dest = typeof item.dest === 'string' ? await loadedDoc.getDestination(item.dest) : item.dest;
                if (Array.isArray(dest) && dest[0]) {
                  const pageIndex = await loadedDoc.getPageIndex(dest[0] as { num: number; gen: number });
                  pageByKey[key] = pageIndex + 1;
                }
              } catch {
                /* ignore invalid outline destination */
              }

              if (item.items && item.items.length > 0) {
                await collectOutlinePages(item.items, `${key}.`);
              }
            }
          };

          await collectOutlinePages(items);

          if (!cancelled) {
            setOutlineItems(items);
            setOutlinePageByKey(pageByKey);
          }
        });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('PDF load failed:', err);
        setFallback(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      setDoc((current) => {
        current?.destroy();
        return null;
      });
      if (thumbsObsRef.current) {
        thumbsObsRef.current.disconnect();
        thumbsObsRef.current = null;
      }
    };
  }, [url]);

  const updateFitHeightScale = useCallback(
    (targetPageNum: number) => {
      const stage = stageRef.current;
      if (!stage || !doc) return;

      doc.getPage(targetPageNum).then((page) => {
        const style = window.getComputedStyle(stage);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const vh = page.getViewport({ scale: 1 }).height;
        const fitScale = Math.max(0.2, Math.min((stage.clientHeight - padY) / vh, 3));
        setScale((prev) => (Math.abs(prev - fitScale) > 0.01 ? fitScale : prev));
      });
    },
    [doc],
  );

  useEffect(() => {
    if (!doc || fallback) return;
    if (fitMode === 'height') {
      updateFitHeightScale(getFitTargetPage());
    } else {
      updateFitWidthScale(getFitTargetPage());
    }
  }, [doc, fallback, fitMode, getFitTargetPage, updateFitHeightScale, updateFitWidthScale]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || fallback) return;
    let lastWidth = stage.clientWidth;
    let lastHeight = stage.clientHeight;

    const observer = new ResizeObserver(() => {
      if (!doc) return;
      const newWidth = stage.clientWidth;
      const newHeight = stage.clientHeight;
      const widthChanged = newWidth !== lastWidth;
      const heightChanged = newHeight !== lastHeight;

      lastWidth = newWidth;
      lastHeight = newHeight;

      if (fitMode === 'height' && heightChanged) {
        updateFitHeightScale(getFitTargetPage());
      } else if (fitMode === 'width' && widthChanged) {
        updateFitWidthScale(getFitTargetPage());
      }
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, [doc, fallback, fitMode, getFitTargetPage, updateFitHeightScale, updateFitWidthScale]);

  useEffect(() => {
    if (!doc || !singleCanvasRef.current || fallback || viewMode !== 'single') return;
    let cancelled = false;

    const render = async () => {
      if (singleRenderTaskRef.current) {
        try {
          singleRenderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }

      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;

        const canvas = singleCanvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        const task = page.render({ canvasContext: ctx, viewport });
        singleRenderTaskRef.current = task;
        await task.promise;

        if (singleTextLayerRef.current) {
          const textContent = await page.getTextContent();
          if (!cancelled) {
            renderTextLayer(
              textContent.items as TextItem[],
              page.getViewport({ scale }),
              singleTextLayerRef.current,
            );
          }
        }
      } catch (err) {
        const maybe = err as { name?: string };
        if (maybe.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      }
    };

    render();

    return () => {
      cancelled = true;
      if (singleRenderTaskRef.current) {
        try {
          singleRenderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [doc, fallback, pageNum, scale, viewMode]);

  useEffect(() => {
    if (fallback || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const p = Number((entry.target as HTMLElement).dataset.page);
          if (!p || pendingThumbsRef.current.has(p) || !doc) return;
          pendingThumbsRef.current.add(p);

          (async () => {
            try {
              const page = await doc.getPage(p);
              const thumbScale = 120 / page.getViewport({ scale: 1 }).width;
              const vp = page.getViewport({ scale: thumbScale });
              const c = document.createElement('canvas');
              c.width = vp.width;
              c.height = vp.height;
              await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
              setThumbs((prev) => ({ ...prev, [p]: c.toDataURL('image/png') }));
            } catch {
              /* ignore */
            }
          })();
        });
      },
      { root: thumbsContainerRef.current, threshold: 0.1 },
    );

    thumbsObsRef.current = observer;
    const placeholders = thumbsContainerRef.current?.querySelectorAll('.pdf-thumb-item');
    placeholders?.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [doc, numPages, fallback]);

  useEffect(() => {
    if (thumbsObsRef.current && numPages > 0) {
      const placeholders = thumbsContainerRef.current?.querySelectorAll('.pdf-thumb-item');
      placeholders?.forEach((el) => thumbsObsRef.current!.observe(el));
    }
  }, [numPages]);

  useEffect(() => {
    const sidebar = thumbsContainerRef.current;
    if (!sidebar || numPages === 0) return;

    const activeThumb = sidebar.querySelector<HTMLElement>(
      `.pdf-thumb-item[data-page="${pageNum}"]`,
    );
    activeThumb?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [numPages, pageNum]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || fallback || !doc || viewMode !== 'continuous') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const nextVisible = new Map(visiblePagesRef.current);
        let didChangeRenderSet = false;

        entries.forEach((entry) => {
          const page = Number((entry.target as HTMLElement).dataset.pageWrap);
          if (!page) return;

          if (entry.isIntersecting) {
            nextVisible.set(page, entry.intersectionRatio);
            setRenderedPages((prev) => {
              if (prev[page]) return prev;
              didChangeRenderSet = true;
              return { ...prev, [page]: true };
            });
          } else {
            nextVisible.delete(page);
          }
        });

        visiblePagesRef.current = nextVisible;
        if (didChangeRenderSet) return;
      },
      {
        root: stage,
        rootMargin: '800px 0px 800px 0px',
        threshold: [0, 0.1, 0.3, 0.5, 0.75, 1],
      },
    );

    pageObserverRef.current = observer;

    const elements = Object.values(pageElementsRef.current).filter(Boolean) as HTMLDivElement[];
    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      pageObserverRef.current = null;
      visiblePagesRef.current = new Map();
    };
  }, [doc, fallback, viewMode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || fallback || !doc || viewMode !== 'continuous') return;

    let raf = 0;
    const updateCurrentPage = () => {
      raf = 0;
      const centerY = stage.scrollTop + stage.clientHeight / 2;
      let closestPage = pageNumRef.current;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (let p = 1; p <= numPages; p += 1) {
        const el = pageElementsRef.current[p];
        if (!el) continue;

        const top = el.offsetTop;
        const bottom = top + el.offsetHeight;
        if (centerY >= top && centerY <= bottom) {
          closestPage = p;
          break;
        }

        const pageCenter = top + el.offsetHeight / 2;
        const distance = Math.abs(centerY - pageCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = p;
        }
      }

      if (closestPage !== pageNumRef.current) {
        setPageNum(closestPage);
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(updateCurrentPage);
    };

    updateCurrentPage();
    stage.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      stage.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [doc, fallback, numPages, viewMode]);

  useEffect(() => {
    if (fallback) return;
    const onKey = (e: KeyboardEvent) => {
      if (viewMode === 'continuous') return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        setPageNum((p) => Math.min(p + 1, numPages || 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPageNum((p) => Math.max(p - 1, 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, fallback, viewMode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || fallback || viewMode !== 'single') return;

    let lastDelta = 0;
    const onWheel = (e: WheelEvent) => {
      const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
      const atTop = stage.scrollTop <= 4;

      if (e.deltaY > 0 && atBottom) {
        e.preventDefault();
        lastDelta += e.deltaY;
        if (lastDelta > 60) {
          lastDelta = 0;
          setPageNum((p) => Math.min(p + 1, numPages || 1));
        }
      } else if (e.deltaY < 0 && atTop) {
        e.preventDefault();
        lastDelta += e.deltaY;
        if (lastDelta < -60) {
          lastDelta = 0;
          setPageNum((p) => Math.max(p - 1, 1));
        }
      } else {
        lastDelta = 0;
      }
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [numPages, fallback, viewMode]);

  useEffect(() => {
    if (viewMode !== 'single') return;
    stageRef.current?.scrollTo({ top: 0 });
  }, [pageNum, viewMode]);

  // 从单页模式切换到连续模式时，滚动到当前 pageNum
  useEffect(() => {
    if (viewMode !== 'continuous') return;

    const raf = requestAnimationFrame(() => {
      const el = pageElementsRef.current[pageNum];
      if (el && stageRef.current) {
        stageRef.current.scrollTop = el.offsetTop;
      }
    });

    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const goPrev = useCallback(() => {
    if (viewMode === 'continuous') {
      const target = Math.max(pageNum - 1, 1);
      pageElementsRef.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPageNum(target);
      return;
    }
    setPageNum((p) => Math.max(p - 1, 1));
  }, [pageNum, viewMode]);

  const goNext = useCallback(() => {
    if (viewMode === 'continuous') {
      const target = Math.min(pageNum + 1, numPages || 1);
      pageElementsRef.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPageNum(target);
      return;
    }
    setPageNum((p) => Math.min(p + 1, numPages || 1));
  }, [numPages, pageNum, viewMode]);

  const fitWidth = useCallback(() => {
    setFitMode('width');
    updateFitWidthScale(pageNum);
  }, [pageNum, updateFitWidthScale]);

  const fitPage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !doc) return;
    setFitMode('height');
    updateFitHeightScale(pageNum);
    if (viewMode === 'single') {
      stage.scrollTop = 0;
    } else {
      pageElementsRef.current[pageNum]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [doc, pageNum, updateFitHeightScale, viewMode]);



  const jumpToPage = useCallback(
    (p: number) => {
      setPageNum(p);
      if (viewMode === 'continuous') {
        pageElementsRef.current[p]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [viewMode],
  );

  const commitPageInput = useCallback(() => {
    const target = Math.min(Math.max(Number.parseInt(pageInput, 10) || pageNum, 1), numPages || 1);
    setIsEditingPage(false);
    setPageInput(String(target));
    jumpToPage(target);
  }, [jumpToPage, numPages, pageInput, pageNum]);

  const jumpToOutlineItem = useCallback(
    async (item: PdfOutlineItem) => {
      if (!doc) return;

      if (item.url) {
        window.open(item.url, '_blank', 'noopener,noreferrer');
        return;
      }

      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      if (!Array.isArray(dest) || !dest[0]) return;

      const pageIndex = await doc.getPageIndex(dest[0] as { num: number; gen: number });
      jumpToPage(pageIndex + 1);
    },
    [doc, jumpToPage],
  );

  const renderOutlineItems = useCallback(
    (items: PdfOutlineItem[], depth = 0, parentKey = '') =>
      items.map((item, index) => {
        const key = `${parentKey}${index}`;
        return (
          <div key={`${item.title}-${key}`} className="pdf-outline-row">
            <button
              className={activeOutlineKey === key ? 'pdf-outline-item pdf-outline-item--active' : 'pdf-outline-item'}
              data-outline-key={key}
              style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
              onClick={() => {
                setActiveOutlineKey(key);
                jumpToOutlineItem(item);
              }}
              title={item.title}
            >
              {item.title}
            </button>
            {item.items && item.items.length > 0 && renderOutlineItems(item.items, depth + 1, `${key}.`)}
          </div>
        );
      }),
    [activeOutlineKey, jumpToOutlineItem],
  );

  if (fallback) {
    return (
      <iframe className="pdf-reader-frame pdf-reader-frame--full" src={url} title={title || 'PDF'} />
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer-toolbar">
        <div className="pdf-viewer-heading">
          {backHref && (
            <Link href={backHref} className="pdf-viewer-back" title="返回资料库" aria-label="返回资料库">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
          )}
          {title && <span className="pdf-viewer-title">{title}</span>}
        </div>
        <div className="pdf-viewer-controls">
          <div className="pdf-viewer-mode-group" aria-label="阅读模式">
            <button
              className={viewMode === 'continuous' ? 'pdf-viewer-mode-btn pdf-viewer-mode-btn--active' : 'pdf-viewer-mode-btn'}
              onClick={() => setViewMode('continuous')}
              aria-pressed={viewMode === 'continuous'}
              aria-label="连续滚动"
              title="连续滚动"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 6h10" />
                <path d="M7 12h10" />
                <path d="M7 18h10" />
              </svg>
            </button>
            <button
              className={viewMode === 'single' ? 'pdf-viewer-mode-btn pdf-viewer-mode-btn--active' : 'pdf-viewer-mode-btn'}
              onClick={() => setViewMode('single')}
              aria-pressed={viewMode === 'single'}
              aria-label="单页模式"
              title="单页模式"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="12" height="16" rx="1" />
              </svg>
            </button>
          </div>
          <span className="pdf-viewer-divider" />
          <button onClick={goPrev} disabled={pageNum <= 1} aria-label="上一页" title="上一页">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span
            className="pdf-viewer-page"
            role="button"
            tabIndex={0}
            title="点击输入页码跳转"
            onClick={() => setIsEditingPage(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsEditingPage(true);
              }
            }}
          >
            {isEditingPage ? (
              <input
                className="pdf-viewer-page-input"
                value={pageInput}
                inputMode="numeric"
                autoFocus
                onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
                onBlur={commitPageInput}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPageInput();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsEditingPage(false);
                    setPageInput(String(pageNum));
                  }
                }}
              />
            ) : (
              `${pageNum} / ${numPages}`
            )}
          </span>
          <button onClick={goNext} disabled={pageNum >= numPages} aria-label="下一页" title="下一页">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <span className="pdf-viewer-divider" />
          <button
            className={fitMode === 'width' ? 'pdf-viewer-fit-btn--active' : undefined}
            onClick={fitWidth}
            aria-pressed={fitMode === 'width'}
            aria-label="适应宽度"
            title="适应宽度：页面宽度铺满阅读区"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          <button
            className={fitMode === 'height' ? 'pdf-viewer-fit-btn--active' : undefined}
            onClick={fitPage}
            aria-pressed={fitMode === 'height'}
            aria-label="适应页面高度"
            title="适应页面高度：整页高度放进阅读区"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="3" width="14" height="18" rx="1" />
              <line x1="9" y1="7" x2="15" y2="7" />
              <line x1="9" y1="11" x2="15" y2="11" />
              <line x1="9" y1="15" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="pdf-viewer-body">
        {numPages > 0 && (
          <div className="pdf-thumb-sidebar" ref={thumbsContainerRef}>
            <div className="pdf-sidebar-tabs" aria-label="侧边栏视图">
              <button
                className={sidebarMode === 'thumbs' ? 'pdf-sidebar-tab pdf-sidebar-tab--active' : 'pdf-sidebar-tab'}
                onClick={() => setSidebarMode('thumbs')}
              >
                缩略图
              </button>
              <button
                className={sidebarMode === 'outline' ? 'pdf-sidebar-tab pdf-sidebar-tab--active' : 'pdf-sidebar-tab'}
                onClick={() => setSidebarMode('outline')}
                disabled={outlineItems.length === 0}
                title={outlineItems.length === 0 ? '这个 PDF 没有目录书签' : '目录书签'}
              >
                目录
              </button>
            </div>

            {sidebarMode === 'outline' ? (
              <div className="pdf-outline-list">
                {outlineItems.length > 0 ? renderOutlineItems(outlineItems) : (
                  <div className="pdf-outline-empty">这个 PDF 没有目录书签</div>
                )}
              </div>
            ) : (
              Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={`pdf-thumb-item${p === pageNum ? ' pdf-thumb-item--active' : ''}`}
                  data-page={p}
                  onClick={() => jumpToPage(p)}
                  title={`第 ${p} 页`}
                >
                  <span className="pdf-thumb-num">{p}</span>
                  <div className="pdf-thumb-imgwrap">
                    {thumbs[p] ? (
                      <ThumbImg src={thumbs[p]} alt={`第 ${p} 页`} />
                    ) : (
                      <div className="pdf-thumb-placeholder" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        <div className="pdf-viewer-stage" ref={stageRef}>
          {loading && <div className="pdf-viewer-loading">加载中…</div>}

          {viewMode === 'continuous' && doc ? (
            <div className="pdf-pages-stack">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <div
                  key={p}
                  ref={(el) => {
                    pageElementsRef.current[p] = el;
                    if (el && pageObserverRef.current) {
                      pageObserverRef.current.observe(el);
                    }
                  }}
                  data-page-wrap={p}
                  className="pdf-page-anchor"
                >
                  <ContinuousPage
                    doc={doc}
                    pageNum={p}
                    scale={scale}
                    active={Boolean(renderedPages[p] || Math.abs(p - pageNum) <= 1)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="pdf-page-wrap">
              <canvas ref={singleCanvasRef} />
              <div ref={singleTextLayerRef} className="pdf-text-layer" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
