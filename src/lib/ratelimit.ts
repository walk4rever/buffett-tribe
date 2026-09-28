import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// For development, if REDIS_URL is not configured, use a mock that doesn't limit
const createRatelimit = (limit: number, windowSeconds: number) => {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      limit: async () => ({ success: true, remaining: limit, reset: Date.now() + windowSeconds * 1000 })
    };
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds}s`),
  });
};

// 基础API限速: 100请求/分钟
export const apiRatelimit = createRatelimit(100, 60);

// AI分析更严格: 10请求/分钟 per IP
export const aiAnalysisRatelimit = createRatelimit(10, 60);

// 标注API限速: 30请求/分钟
export const highlightsRatelimit = createRatelimit(30, 60);

export function getClientIp(request: Request): string {
  // Cloudflare 提供真实用户 IP（优先使用）
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // 其他反向代理的 fallback
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  // 开发环境 fallback
  return "127.0.0.1";
}
