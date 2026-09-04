import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import * as cheerio from "cheerio";

export interface EmailRecipientInfo {
  name?: string | null;
  email?: string | null;
}

export interface BuildEmailOptions {
  subject: string;
  markdown: string;
  preheader?: string;
  user?: EmailRecipientInfo;
  baseUrl?: string;
}

export const DEFAULT_BASE_URL = "https://vt.air7.fun";

/**
 * Replace placeholders like {{name}} and {{email}} in content
 */
export function substituteTokens(text: string, user?: EmailRecipientInfo): string {
  const name = user?.name?.trim() || "投资朋友";
  const email = user?.email?.trim() || "";

  return text
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*email\s*\}\}/gi, email);
}

/**
 * Converts markdown string to inline-styled HTML snippet for email clients.
 */
export function renderMarkdownToEmailHtml(
  markdown: string,
  user?: EmailRecipientInfo,
  baseUrl: string = DEFAULT_BASE_URL
): string {
  if (!markdown || !markdown.trim()) {
    return `<div style="padding:40px 0;text-align:center;color:#9ca3af;font-size:14px;font-style:italic;">（正文内容为空）</div>`;
  }

  const processed = substituteTokens(markdown, user);

  const rawHtml = micromark(processed, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });

  const $ = cheerio.load(rawHtml, null, false);

  $("h1").attr(
    "style",
    "font-size:22px;font-weight:700;color:#0f172a;margin:24px 0 12px;letter-spacing:-0.3px;line-height:1.3;"
  );
  $("h2").attr(
    "style",
    "font-size:18px;font-weight:700;color:#0f172a;margin:20px 0 10px;letter-spacing:-0.2px;line-height:1.35;"
  );
  $("h3").attr(
    "style",
    "font-size:16px;font-weight:600;color:#1e293b;margin:16px 0 8px;line-height:1.4;"
  );
  $("p").attr(
    "style",
    "font-size:15px;line-height:1.75;color:#374151;margin:0 0 14px;"
  );
  $("strong").attr("style", "font-weight:600;color:#0f172a;");
  $("em").attr("style", "font-style:italic;color:#4b5563;");
  $("ul").attr(
    "style",
    "margin:0 0 16px;padding-left:22px;color:#374151;line-height:1.8;"
  );
  $("ol").attr(
    "style",
    "margin:0 0 16px;padding-left:22px;color:#374151;line-height:1.8;"
  );
  $("li").attr("style", "margin-bottom:6px;font-size:15px;");
  $("blockquote").attr(
    "style",
    "border:0.5px solid #e5e7eb;border-left:3.5px solid #0071e3;background:#f8fafc;padding:14px 18px;margin:16px 0;border-radius:0 8px 8px 0;color:#475569;font-size:14.5px;line-height:1.7;"
  );
  $("hr").attr("style", "border:none;border-top:1px solid #e5e7eb;margin:24px 0;");

  $("table").attr(
    "style",
    "width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;border:0.5px solid #e5e7eb;"
  );
  $("th").attr(
    "style",
    "background:#f8fafc;padding:10px 14px;text-align:left;font-weight:600;color:#0f172a;border-bottom:1px solid #e5e7eb;border-right:0.5px solid #f1f5f9;"
  );
  $("td").attr(
    "style",
    "padding:10px 14px;border-bottom:0.5px solid #f1f5f9;border-right:0.5px solid #f8fafc;color:#374151;"
  );

  $("pre").attr(
    "style",
    "background:#0f172a;color:#f8fafc;padding:16px 20px;border-radius:8px;overflow-x:auto;font-size:13.5px;line-height:1.6;margin:16px 0;border:0.5px solid #1e293b;"
  );
  $("code").each((_, el) => {
    const parent = $(el).parent();
    if (parent.is("pre")) {
      $(el).attr(
        "style",
        "font-family:-apple-system-monospaced,Menlo,Monaco,Consolas,monospace;background:transparent;padding:0;color:inherit;"
      );
    } else {
      $(el).attr(
        "style",
        "background:#f1f5f9;color:#0f172a;padding:2px 6px;border-radius:4px;font-size:13.5px;font-family:-apple-system-monospaced,Menlo,Monaco,Consolas,monospace;border:0.5px solid #e2e8f0;"
      );
    }
  });

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const isWechatBtn =
      href.endsWith("#wechat-btn") || href.endsWith("#wechat");
    const isCta = !isWechatBtn && href.endsWith("#button");
    const cleanHref = href.replace(/#(button|wechat|wechat-btn)$/, "");
    const finalHref = cleanHref.startsWith("/")
      ? `${baseUrl}${cleanHref}`
      : cleanHref;

    if (isWechatBtn) {
      $(el).attr(
        "href",
        finalHref ||
          "https://pub-675abd2580e643e89dde5e766edae1b7.r2.dev/buffett-tribe/email/announcement-2026-06/wechat-qr.jpeg"
      );
      $(el).attr(
        "style",
        "display:inline-block;background:#07c160;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:-0.2px;"
      );
      const parentP = $(el).parent();
      if (parentP.is("p") && parentP.text().trim() === $(el).text().trim()) {
        parentP.replaceWith(
          `<div style="text-align:center;margin:24px 0;">${$.html(el)}</div>`
        );
      } else {
        $(el).wrap(`<div style="text-align:center;margin:24px 0;"></div>`);
      }
    } else if (isCta) {
      $(el).attr("href", finalHref);
      $(el).attr(
        "style",
        "display:inline-block;background:#0071e3;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:-0.2px;"
      );
      const parentP = $(el).parent();
      if (parentP.is("p") && parentP.text().trim() === $(el).text().trim()) {
        parentP.replaceWith(
          `<div style="text-align:center;margin:24px 0;">${$.html(el)}</div>`
        );
      } else {
        $(el).wrap(`<div style="text-align:center;margin:24px 0;"></div>`);
      }
    } else {
      $(el).attr("href", finalHref);
      $(el).attr(
        "style",
        "color:#0071e3;text-decoration:none;font-weight:500;"
      );
    }
  });

  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    const alt = $(el).attr("alt") || "";
    const isQr =
      src.includes("#wechat") ||
      src.includes("#qr") ||
      src.includes("wechat-qr") ||
      alt.includes("微信") ||
      alt.includes("二维码");
    const cleanSrc = src.replace(/#(wechat|qr|qrcode)$/, "");
    let finalSrc = cleanSrc.startsWith("/")
      ? `${baseUrl}${cleanSrc}`
      : cleanSrc;
    if (
      finalSrc.endsWith("/wechat-qr.jpeg") &&
      !finalSrc.includes("r2.dev")
    ) {
      finalSrc =
        "https://pub-675abd2580e643e89dde5e766edae1b7.r2.dev/buffett-tribe/email/announcement-2026-06/wechat-qr.jpeg";
    }

    if (isQr) {
      $(el).attr("src", finalSrc);
      $(el).attr("alt", alt || "微信二维码");
      $(el).attr("width", "190");
      $(el).attr(
        "style",
        "width:190px;max-width:190px;height:auto;border-radius:8px;border:0.5px solid #e5e7eb;display:block;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,0.04);"
      );
      const parentP = $(el).parent();
      if (parentP.is("p") && parentP.children().length === 1) {
        parentP.replaceWith(
          `<div style="text-align:center;margin:20px auto 24px;">${$.html(
            el
          )}</div>`
        );
      } else {
        $(el).wrap(
          `<div style="text-align:center;margin:20px auto 24px;"></div>`
        );
      }
    } else {
      $(el).attr("src", finalSrc);
      $(el).attr(
        "style",
        "max-width:100%;height:auto;border-radius:8px;margin:16px auto;display:block;border:0.5px solid #e5e7eb;"
      );
    }
  });

  return $.html();
}

/**
 * Builds the complete, responsive email HTML document.
 */
export function buildFullEmailHtml(options: BuildEmailOptions): string {
  const {
    subject,
    markdown,
    preheader,
    user,
    baseUrl = DEFAULT_BASE_URL,
  } = options;

  const bodyHtml = renderMarkdownToEmailHtml(markdown, user, baseUrl);

  const preheaderHtml = preheader
    ? `
    <div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">
      ${preheader.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
    </div>
    `
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased;">
  ${preheaderHtml}
  <div style="max-width:600px;margin:36px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:0.5px solid #e0e0e0;box-shadow:0 4px 12px rgba(0,0,0,0.03);">

    <!-- Brand Header -->
    <div style="background:#0f172a;padding:20px 28px;">
      <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <tr>
          <td style="vertical-align:middle;">
            <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;line-height:0;">
                  <a href="${baseUrl}" style="text-decoration:none;display:inline-block;">
                    <img src="${baseUrl}/logo-white.svg" width="24" height="24" alt="Value Tribe" style="display:block;border:0;outline:none;text-decoration:none;" />
                  </a>
                </td>
                <td style="vertical-align:middle;padding-right:12px;white-space:nowrap;">
                  <a href="${baseUrl}" style="text-decoration:none;font-size:17px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                    Value Tribe
                  </a>
                </td>
                <td style="vertical-align:middle;padding-left:12px;border-left:1px solid #334155;">
                  <span style="font-size:12px;font-weight:400;color:#94a3b8;letter-spacing:0.2px;line-height:1.4;display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
                    买股票就是买公司，知识库+Agent让你更好地理解一家公司！
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>

    <!-- Main Content Area -->
    <div style="padding:36px 36px 28px;">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <div style="border-top:0.5px solid #e5e7eb;padding:20px 36px;background:#f9fafb;">
      <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">
        © 2026 Value Tribe &nbsp;|&nbsp;
        <a href="https://vt.air7.fun" style="color:#6b7280;text-decoration:none;">vt.air7.fun</a>
      </p>
      <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.5;">
        此为产品发布与重要功能通知邮件。如您不希望接收此类产品通告，可直接回复本邮件说明退订。
      </p>
    </div>

  </div>
</body>
</html>`;
}
