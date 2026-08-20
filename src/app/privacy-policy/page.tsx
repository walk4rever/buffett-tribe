import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export default function PrivacyPolicy() {
  return (
    <div>
      <SiteNav />
      <div className="container">
      <h1 className="letter-title">隐私政策</h1>
      <div className="privacy-content">
        <p>最后更新：2026年3月16日</p>

        <h2>信息收集</h2>
        <p>我们仅收集您自愿提供的信息，包括：</p>
        <ul>
          <li>通过第三方登录（GitHub/Google）提供的基本用户信息（名称、邮箱）</li>
          <li>您在使用高亮功能时保存的标注内容</li>
        </ul>

        <h2>信息使用</h2>
        <p>我们收集的信息仅用于：</p>
        <ul>
          <li>提供和维护我们的服务</li>
          <li>保存您的阅读进度和标注</li>
          <li>改进我们的产品和服务</li>
        </ul>

        <h2>信息共享</h2>
        <p>我们不会出售、交易或转移您的个人信息给第三方，除非获得您的同意或法律要求。</p>

        <h2>数据安全</h2>
        <p>我们采取合理的安全措施保护您的个人信息免受未授权访问或泄露。</p>

        <h2>第三方服务</h2>
        <p>我们使用第三方身份认证服务（GitHub/Google），这些服务有他们自己的隐私政策。</p>

        <h2>儿童隐私</h2>
        <p>我们的服务不针对13岁以下儿童，我们不会故意收集13岁以下儿童的个人信息。</p>

        <h2>政策变更</h2>
        <p>我们可能会不时更新隐私政策，变更将在此页面发布。</p>

        <h2>联系我们</h2>
        <p>如果您对隐私政策有任何问题，请通过<a href="/contact">联系页面</a>联系我们。</p>
      </div>

      <div className="letter-footer">
        <hr />
        <Link href="/" className="back-link">返回首页</Link>
      </div>
      </div>
    </div>
  );
}
