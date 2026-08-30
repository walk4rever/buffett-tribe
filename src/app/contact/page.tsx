import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { BRAND_EN, BRAND_ZH } from "@/lib/brand";

export default function Contact() {
  return (
    <div>
      <SiteNav />
      <div className="container">
        <h1 className="letter-title">联系我们</h1>
        <div className="contact-content">
          <p>欢迎通过以下方式联系我们：</p>

          <h2>GitHub</h2>
          <p>如果您发现了bug或者有功能建议，请在 GitHub 仓库提交 Issue：</p>
          <p>
            <a
              href="https://github.com/walk4rever/buffett-tribe"
              target="_blank"
              rel="noopener noreferrer"
              className="link-primary"
            >
              github.com/walk4rever/buffett-tribe
            </a>
          </p>

          <h2>项目介绍</h2>
          <p>{BRAND_ZH}（{BRAND_EN}）是一个价值投资研究平台，目标是让价值投资者能够更好地学习沃伦·巴菲特等大师的投资理念。</p>

          <p>我们相信：通过理解历史背景，能更好地理解投资大师的决策过程。</p>

          <h2>数据来源</h2>
          <ul>
            <li>巴菲特致股东信原文：Berkshire Hathaway 官方网站</li>
            <li>市场数据：Yahoo Finance</li>
            <li>持仓数据：SEC EDGAR</li>
          </ul>

          <p>本项目仅供学习研究使用。</p>
        </div>

        <div className="letter-footer">
          <hr />
          <Link href="/" className="back-link">返回首页</Link>
        </div>
      </div>
    </div>
  );
}
