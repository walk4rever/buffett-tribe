export function buildArticleListParams(page: number, query: string): URLSearchParams {
  const params = new URLSearchParams({
    type: "posts",
    page: String(page),
  });
  const normalizedQuery = query.trim();

  if (normalizedQuery) params.set("q", normalizedQuery);

  return params;
}
