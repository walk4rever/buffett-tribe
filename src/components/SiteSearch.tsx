"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";

interface SearchItem {
  id?: string;
  slug?: string;
  name?: string;
  title?: string;
  subtitle: string;
  href: string;
}

interface SearchGroups {
  masters: SearchItem[];
  companies: SearchItem[];
  insights: SearchItem[];
}

const EMPTY_GROUPS: SearchGroups = { masters: [], companies: [], insights: [] };

const GROUPS: Array<{ key: keyof SearchGroups; label: string }> = [
  { key: "masters", label: "大师" },
  { key: "companies", label: "公司" },
  { key: "insights", label: "洞见" },
];

export function SiteSearch() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroups>(EMPTY_GROUPS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const previousBodyOverflowRef = useRef("");

  const results = useMemo(
    () => GROUPS.flatMap(({ key }) => groups[key]),
    [groups],
  );

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTyping = target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isShortcut || (event.key === "/" && !isTyping)) {
        event.preventDefault();
        setIsOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) triggerRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    inputRef.current?.focus();
    previousBodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflowRef.current;
    };
  }, [isOpen]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!isOpen || Array.from(normalizedQuery).length < 2) {
      setGroups(EMPTY_GROUPS);
      setIsLoading(false);
      setHasError(false);
      setActiveIndex(-1);
      return;
    }

    setGroups(EMPTY_GROUPS);
    setIsLoading(true);
    setHasError(false);
    setActiveIndex(-1);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/site-search?q=${encodeURIComponent(normalizedQuery)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Search request failed");
        const data = await response.json() as SearchGroups;
        setGroups({
          masters: Array.isArray(data.masters) ? data.masters : [],
          companies: Array.isArray(data.companies) ? data.companies : [],
          insights: Array.isArray(data.insights) ? data.insights : [],
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setGroups(EMPTY_GROUPS);
          setHasError(true);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [isOpen, query]);

  function closeSearch() {
    setIsOpen(false);
    setQuery("");
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    } else if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => index <= 0 ? results.length - 1 : index - 1);
    } else if (event.key === "Enter") {
      const result = results[activeIndex] ?? results[0];
      if (result) {
        event.preventDefault();
        router.push(result.href);
        closeSearch();
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="home-nav-search"
        aria-label="搜索大师、公司或洞见"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
      >
        <Search size={15} aria-hidden="true" />
        <span>搜索</span>
      </button>

      {isOpen ? (
        <div
          className="site-search-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSearch();
          }}
        >
          <section
            className="site-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="全站搜索"
          >
            <div className="site-search-input-wrap">
              <Search className="site-search-input-icon" size={19} aria-hidden="true" />
              <input
                ref={inputRef}
                className="site-search-input"
                type="search"
                role="combobox"
                value={query}
                maxLength={80}
                placeholder="搜索大师、公司或洞见主题"
                aria-label="搜索大师、公司或洞见主题"
                aria-controls="site-search-results"
                aria-expanded={results.length > 0}
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? `site-search-option-${activeIndex}` : undefined}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              {query ? (
                <button
                  type="button"
                  className="site-search-clear"
                  aria-label="清空搜索"
                  onClick={() => setQuery("")}
                >
                  <X size={16} />
                </button>
              ) : null}
              <button
                type="button"
                className="site-search-escape"
                onClick={closeSearch}
                aria-label="关闭搜索"
              >
                Esc
              </button>
            </div>

            <div
              id="site-search-results"
              className="site-search-results"
              role="listbox"
              aria-label="搜索结果"
              aria-live="polite"
            >
              {!query.trim() ? (
                <p className="site-search-hint">输入关键词开始搜索</p>
            ) : Array.from(query.trim()).length < 2 ? (
              <p className="site-search-hint">再输入一个字</p>
              ) : isLoading ? (
                <p className="site-search-hint">搜索中…</p>
            ) : hasError ? (
              <p className="site-search-hint">搜索暂时不可用，请稍后再试</p>
              ) : results.length === 0 ? (
                <p className="site-search-hint">没有找到相关内容</p>
              ) : (
                GROUPS.map(({ key, label }) => {
                  const items = groups[key];
                  if (items.length === 0) return null;

                  return (
                    <section key={key} className="site-search-group" role="group" aria-label={label}>
                      <h2 className="site-search-group-title">{label}</h2>
                      <ul>
                        {items.map((item) => {
                          const currentIndex = results.indexOf(item);
                          const title = item.name ?? item.title ?? "";
                          const id = `site-search-option-${currentIndex}`;

                          return (
                            <li key={item.id ?? item.slug} role="presentation">
                              <Link
                                id={id}
                                href={item.href}
                                role="option"
                                aria-selected={activeIndex === currentIndex}
                                className={`site-search-result${activeIndex === currentIndex ? " site-search-result--active" : ""}`}
                                onMouseEnter={() => setActiveIndex(currentIndex)}
                                onClick={closeSearch}
                              >
                                <span className="site-search-result-copy">
                                  <span className="site-search-result-title">{title}</span>
                                  {item.subtitle ? (
                                    <span className="site-search-result-subtitle">{item.subtitle}</span>
                                  ) : null}
                                </span>
                                <ArrowUpRight size={15} aria-hidden="true" />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
            <footer className="site-search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>↵</kbd> 打开</span>
              <span><kbd>Esc</kbd> 关闭</span>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
