import {
  Link,
  Settings,
  Gem,
  Database,
  Heart,
  Wallet,
  Radio,
  TrendingUp,
  Users,
} from "lucide-react";

export type CanvasEntry = {
  text: string;
  evidence?: string[];
  sources?: string[];
  confidence?: number;
};

export type BusinessCanvasData = {
  customerSegments: Array<string | CanvasEntry>;
  valuePropositions: Array<string | CanvasEntry>;
  channels: Array<string | CanvasEntry>;
  customerRelationships: Array<string | CanvasEntry>;
  revenueStreams: Array<string | CanvasEntry>;
  keyResources: Array<string | CanvasEntry>;
  keyActivities: Array<string | CanvasEntry>;
  keyPartnerships: Array<string | CanvasEntry>;
  costStructure: Array<string | CanvasEntry>;
};

const labels: Record<
  keyof BusinessCanvasData,
  { zh: string; en: string; icon: React.ElementType }
> = {
  keyPartnerships: { zh: "重要合作", en: "Key Partnerships", icon: Link },
  keyActivities: { zh: "关键业务", en: "Key Activities", icon: Settings },
  valuePropositions: { zh: "价值主张", en: "Value Propositions", icon: Gem },
  keyResources: { zh: "核心资源", en: "Key Resources", icon: Database },
  customerRelationships: { zh: "客户关系", en: "Customer Relationships", icon: Heart },
  costStructure: { zh: "成本结构", en: "Cost Structure", icon: Wallet },
  channels: { zh: "渠道通路", en: "Channels", icon: Radio },
  revenueStreams: { zh: "收入来源", en: "Revenue Streams", icon: TrendingUp },
  customerSegments: { zh: "客户细分", en: "Customer Segments", icon: Users },
};

function CanvasCell({
  label,
  items,
  area,
}: {
  label: { zh: string; en: string; icon: React.ElementType };
  items: Array<string | CanvasEntry>;
  area: string;
}) {
  const Icon = label.icon;
  const normalizedItems = items.map((item) =>
    typeof item === "string"
      ? { text: item }
      : {
          text: item.text,
          evidence: item.evidence ?? [],
          sources: item.sources ?? [],
          confidence: item.confidence,
        }
  );

  return (
    <div className={`bmc-cell bmc-cell--${area}`}>
      <div className="bmc-cell-head">
        <div className="bmc-cell-title">
          <Icon size={13} strokeWidth={2} />
          <strong>{label.zh}</strong>
        </div>
        <span>{label.en}</span>
      </div>
      <ul>
        {normalizedItems.map((item, i) => (
          <li key={i} className="bmc-item">
            <div className="bmc-item-text">{item.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompanyBusinessCanvas({ data }: { data: BusinessCanvasData }) {
  return (
    <div className="bmc-grid">
      <CanvasCell label={labels.keyPartnerships} items={data.keyPartnerships} area="partners" />
      <CanvasCell label={labels.keyActivities} items={data.keyActivities} area="activities" />
      <CanvasCell label={labels.valuePropositions} items={data.valuePropositions} area="props" />
      <CanvasCell label={labels.customerRelationships} items={data.customerRelationships} area="relations" />
      <CanvasCell label={labels.customerSegments} items={data.customerSegments} area="segments" />
      <CanvasCell label={labels.keyResources} items={data.keyResources} area="resources" />
      <CanvasCell label={labels.channels} items={data.channels} area="channels" />
      <CanvasCell label={labels.costStructure} items={data.costStructure} area="cost" />
      <CanvasCell label={labels.revenueStreams} items={data.revenueStreams} area="revenue" />
    </div>
  );
}

const canvasByTicker: Record<string, BusinessCanvasData> = {
  AAPL: {
    customerSegments: [
      "全球高端个人消费者，追求品牌、设计及生态系统体验",
      "企业客户，特别是教育、创意和IT行业，采购Mac和iPad",
      "开发者与内容创作者，通过App Store和Apple Services创收",
    ],
    valuePropositions: [
      "无缝硬件、软件与服务整合生态系统，为用户提供一致体验",
      "高隐私保护标准与独特安全架构",
      "创新设计、易用性和品牌溢价，驱动用户忠诚度与复购",
    ],
    channels: [
      "Apple Store 直营零售店及在线商店",
      "运营商合约套餐及授权经销商",
      "企业直销团队与教育机构合作渠道",
    ],
    customerRelationships: [
      "AppleCare+延长保修与技术支持服务",
      "Genius Bar及在线支持",
      "Apple ID账户体系、iCloud同步及订阅服务",
    ],
    revenueStreams: [
      "硬件销售：iPhone（约50%营收）、Mac、iPad、可穿戴设备",
      "服务收入：App Store抽成、iCloud、Apple Music等订阅",
      "配件与授权许可",
    ],
    keyResources: [
      "全球品牌价值最高的科技品牌及忠实用户基础",
      "iOS、macOS、芯片自研能力与知识产权",
      "高效供应链与代工网络的长期合作关系",
    ],
    keyActivities: [
      "产品设计与创新",
      "芯片自研",
      "供应链管理与品控",
      "软件开发与生态运营",
      "品牌营销与零售体验",
    ],
    keyPartnerships: [
      "主要代工厂：富士康、和硕等",
      "芯片供应商：台积电",
      "开发者社区：数百万App开发者",
    ],
    costStructure: [
      "研发投入（约营收22-25%）",
      "营销与销售费用",
      "供应链与制造成本及零售物业租金",
    ],
  },
  KO: {
    customerSegments: [
      "全球消费者，包括所有年龄段的饮料消费者",
      "零售渠道：超市、便利店、杂货店等",
      "餐饮渠道：快餐店、餐厅、影院、自动售货机运营商",
    ],
    valuePropositions: [
      "提供口感一致、广受欢迎的碳酸饮料及多元化非碳酸饮料",
      "强大的品牌情感价值：快乐、分享、经典",
      "便利性和高可得性：在任何地方都能买到",
    ],
    channels: [
      "通过特许瓶装厂分销网络覆盖全球超过200个国家",
      "直接销售给大型零售和餐饮连锁客户",
      "自动售货机、电商平台及单次消费点",
    ],
    customerRelationships: [
      "通过全球品牌广告和营销活动建立情感联结",
      "消费者忠诚度计划和促销活动",
      "与瓶装厂合作确保产品新鲜度和货架陈列",
    ],
    revenueStreams: [
      "向特许瓶装厂销售浓缩液和糖浆（主要收入，高毛利率）",
      "直接销售成品饮料给零售和餐饮客户",
      "品牌授权和合作产品收入",
    ],
    keyResources: [
      "全球最具价值的品牌之一",
      "独特的浓缩液配方和口感（秘方保护）",
      "遍布全球的瓶装厂网络和冷链物流体系",
    ],
    keyActivities: [
      "品牌营销和广告宣传（每年数十亿美元投入）",
      "产品创新和新口味研发",
      "供应链管理：确保浓缩液生产、瓶装厂协调",
    ],
    keyPartnerships: [
      "特许瓶装厂——生产与分销核心伙伴",
      "大型零售和餐饮客户——长期供应协议",
      "原材料供应商——稳定成本与质量",
    ],
    costStructure: [
      "原材料成本（糖、甜味剂、包装）占营收约38%",
      "营销和广告费用（约营收10-12%）",
      "销售、一般及管理费用（约营收20-25%）",
    ],
  },
  MCO: {
    customerSegments: [
      "全球各类发债企业，包括主权国家、地方政府、金融机构和企业",
      "机构投资者，如共同基金、养老基金、保险公司",
      "投资银行和证券公司",
      "监管机构和中央银行",
      "其他信用市场参与者",
    ],
    valuePropositions: [
      "提供独立、权威的信用评级，降低信息不对称和投资风险",
      "基于深度行业研究和数据分析的独特风险管理见解",
      "及时更新评级和预警，帮助客户做出投资和融资决策",
      "满足监管合规要求，如巴塞尔协议对信用风险权重的需求",
      "标准化评级框架，提升全球信用市场的透明度和效率",
    ],
    channels: [
      "直接销售团队面向大型机构",
      "公司官网及Moody's Analytics平台",
      "行业会议、投资者论坛和媒体发布",
      "研究出版物和学术合作",
      "第三方数据分销平台（如Bloomberg、Refinitiv）",
    ],
    customerRelationships: [
      "长期合同和订阅模式",
      "专属客户经理和24/7技术支持",
      "定期客户研讨会和培训",
      "客户反馈机制用于优化评级模型",
      "通过Moody's Ratings Community建立行业交流网络",
    ],
    revenueStreams: [
      "信用评级服务费（发行方付费模式，占收入的大多数）",
      "Moody's Analytics订阅和数据许可费",
      "咨询和定制分析服务",
      "评级相关培训和认证课程收入",
    ],
    keyResources: [
      "全球领先的品牌声誉和百年积累的评级公信力",
      "超过1500名信用分析师及研究人员",
      "自有数据库和专利分析模型",
      "与全球监管机构长期建立的信任关系",
      "AI和机器学习驱动的评级自动化平台",
    ],
    keyActivities: [
      "持续对发债主体进行信用评级和定期审查",
      "开发并更新评级方法、模型和风险框架",
      "为投资者提供市场洞察、经济预测和行业分析",
      "运营和维护数据收集、处理及分发系统",
      "合规管理与监管沟通",
    ],
    keyPartnerships: [
      "与全球主要证券交易所和债券市场合作",
      "与全球金融数据提供商的数据互连",
      "与行业监管机构共同制定评级标准",
      "学术机构和智库合作进行经济研究",
      "科技公司作为云服务供应商支持数据处理",
    ],
    costStructure: [
      "薪酬和福利支出（占运营成本最大部分，约50%以上）",
      "信息技术系统和数据基础设施的维护与升级",
      "合规和风险管理部门的运营成本",
      "市场推广、客户关系和品牌维护费用",
      "法律和审计费用",
    ],
  },
};

export function getMockBusinessCanvas(ticker: string): BusinessCanvasData {
  return (
    canvasByTicker[ticker.toUpperCase()] ?? {
      customerSegments: [{ text: "待补充" }],
      valuePropositions: [{ text: "待补充" }],
      channels: [{ text: "待补充" }],
      customerRelationships: [{ text: "待补充" }],
      revenueStreams: [{ text: "待补充" }],
      keyResources: [{ text: "待补充" }],
      keyActivities: [{ text: "待补充" }],
      keyPartnerships: [{ text: "待补充" }],
      costStructure: [{ text: "待补充" }],
    }
  );
}
