export function classifyOnboardError(message: string | null | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (!text) return "阶段执行失败";
  if (text.includes("invalid canvas") || text.includes("business_overview")) {
    return "内容画布校验失败";
  }
  if (
    text.includes("filingsection text is empty") ||
    text.includes("cannot resolve currency")
  ) {
    return "年报切片/币种解析失败";
  }
  if (
    text.includes("created 0 extsource") ||
    text.includes("no annual filings found")
  ) {
    return "未找到年报";
  }
  if (text.includes("companyfacts") && text.includes("404")) {
    return "SEC 财务事实 404";
  }
  if (text.includes("503") || text.includes("socket disconnected")) {
    return "SEC 网络错误";
  }
  if (
    text.includes("statement timeout") ||
    text.includes("57014") ||
    text.includes("authentication did not complete")
  ) {
    return "数据库超时/连接失败";
  }
  if (text.includes("stock-prices") || text.includes("import-stock-prices")) {
    return "股价导入失败";
  }
  if (text.includes("prospectus") || text.includes("招股书")) {
    return "招股书导入失败";
  }
  if (text.includes("edgartools") || text.includes("html() failed")) {
    return "10-K 文本解析失败";
  }
  if (text.includes("timed out") || text.includes("timeout") || text.includes("超时")) {
    return "执行超时";
  }
  return "阶段执行失败";
}
