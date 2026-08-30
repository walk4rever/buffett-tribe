import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { BRAND_EN, BRAND_ZH } from "@/lib/brand";

export default function TermsOfService() {
  return (
    <div>
      <SiteNav />
      <div className="container">
      <h1 className="letter-title">使用条款</h1>
      <div className="terms-content">
        <p>最后更新：2026年3月16日</p>

        <h2>接受条款</h2>
        <p>通过访问本网站，您同意遵守这些使用条款。如果您不同意，请不要使用本网站。</p>

        <h2>使用许可</h2>
        <p>{BRAND_ZH}（{BRAND_EN}）是一个价值投资研究平台，仅用于学习和研究用途。</p>

        <h2>用户责任</h2>
        <p>您同意：</p>
        <ul>
          <li>仅将本网站用于合法目的</li>
          <li>不干扰本网站的正常运行</li>
          <li>不尝试未经授权访问本网站的系统或数据</li>
        </ul>

        <h2>知识产权</h2>
        <p>：</p>
        <ul>
          <li>本网站源代码：MIT License</li>
          <li>原始信件内容：版权归原作者所有</li>
          <li>翻译和分析内容：仅供学习研究使用</li>
        </ul>

        <h2>免责声明</h2>
        <p>本网站按&quot;现状&quot;提供，不提供任何明示或暗示的保证。我们不对内容的准确性、完整性或适用性作保证。</p>

        <h2>责任限制</h2>
        <p>在任何情况下，我们不对因使用本网站产生的任何损害不承担责任。</p>

        <h2>链接到第三方网站</h2>
        <p>本网站可能包含到第三方网站的链接，我们对第三方网站的内容不负责。</p>

        <h2>终止访问</h2>
        <p>我们保留随时终止或限制用户访问的权利。</p>

        <h2>适用法律</h2>
        <p>这些条款受中国法律管辖。</p>

        <h2>条款修改</h2>
        <p>我们保留随时修改这些条款的权利，修改后的条款将在此页面发布。</p>

        <h2>联系我们</h2>
        <p>如果您对使用条款有任何问题，请通过<a href="/contact">联系页面</a>联系我们。</p>
      </div>

      <div className="letter-footer">
        <hr />
        <Link href="/" className="back-link">返回首页</Link>
      </div>
      </div>
    </div>
  );
}
