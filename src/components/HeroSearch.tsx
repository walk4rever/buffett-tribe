"use client";

const EXAMPLE_QUESTIONS = [
  "巴菲特为什么持有BAC这么久？",
  "李录重仓中国的逻辑是什么？",
  "段永平如何定义企业文化？",
  "护城河和定价权的关系？",
];

export function HeroSearch() {
  return (
    <div className="hero-search">
      <div className="hero-input-wrap">
        <input
          className="hero-input"
          type="text"
          placeholder="研究一家公司，或向大师提问"
          readOnly
          tabIndex={-1}
        />
        <span className="hero-input-btn" aria-hidden="true">
          <span className="hero-input-enter">↵</span>
        </span>
      </div>
      <div className="hero-examples">
        {EXAMPLE_QUESTIONS.map((q) => (
          <span key={q} className="hero-example">{q}</span>
        ))}
      </div>
    </div>
  );
}
