// One-off seed for the first 打孔 (Punch) entry: 段永平 × 苹果 (Duan Yongping / Apple).
// All quotes are verbatim from `段永平投资问答录 · 投资篇`（Document id: duan-investment,
// "案例 3：苹果" section, PDF pages ~376+）— already a licensed document in this repo's
// own library, not fabricated. Run: node --env-file=.env.local ./node_modules/.bin/tsx scripts/seed-punch-duan-apple.ts
import prisma from "../src/lib/prisma";

const SOURCE_TITLE = "段永平投资问答录 · 投资篇";
const SOURCE_URL = "/documents/duan/investment";

async function main() {
  const duanFiler = await prisma.filer.findFirst({ where: { personNameZh: "段永平" } });
  if (!duanFiler) throw new Error("Duan Yongping filer not found");

  const aapl = await prisma.entity.findFirst({ where: { ticker: "AAPL" } });
  if (!aapl) throw new Error("AAPL entity not found");

  const quotes = [
    {
      text: "一般来讲我要投资一个公司时，主要考虑两个重要的点：1.这家公司能长期获利（足够的利润）吗？2.公司获得的利润如何给到股东？",
      date: "2013-04-24",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
    {
      text: "我在2011年买苹果的时候，苹果大概3000亿市值（当时股价310/7=44），手里有1000亿净现金，那时候利润大概不到200亿……用2000亿左右市值买个目前赚接近200亿/年、未来5左右会赚到500亿/年或以上的公司……如果有这个结论，买苹果不过是个简单算术题，你只要根据你自己的机会成本就可以决定了。",
      date: "2019-05-20",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
    {
      text: "OPPO和APPLE其实有很多相同的基因，这也是我最后能看懂APPLE的原因之一。",
      date: "2011-08-07",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
    {
      text: "本人喜欢苹果生意模式的很重要的一点来自于自己在消费电子20多年的体验，苹果是我一直梦寐以求但似乎难以达到的生意模式。",
      date: "2013-01-22",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
    {
      text: "苹果所处的行业确实是个变化很快的行业。虽然我认为苹果在竞争中已经处于一个非常有利的位置，但我还是会很关切哪些变化有可能会改变苹果的地位。如果非要我给苹果定个价的话，我大概认为苹果也许某天会到600块……当然，苹果也是有可能掉回到100多块的，反正到时大家就知道了。",
      date: "2011-04-29",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
    {
      text: "我通常比较集中于比较了解的公司，比如苹果，茅台。",
      date: "2019-05-27",
      sourceTitle: SOURCE_TITLE,
      sourceUrl: SOURCE_URL,
    },
  ];

  const punch = await prisma.punch.upsert({
    where: { slug: "duan-yongping-apple" },
    create: {
      slug: "duan-yongping-apple",
      filerEntityId: duanFiler.filerEntityId,
      companyEntityId: aapl.id,
      source: "curated",
      status: "active",
      punchYear: 2011,
      headline: "看懂苹果的生意模式后，一道“简单算术题”式的重仓",
      thesis:
        "段永平反复强调，投资只看两件事：这家公司能不能长期获利，以及利润如何回报股东。他对苹果的“懂”不是来自技术分析，而是来自自己在消费电子行业20多年的从业经历——做小霸王的经历让他判断 OPPO 与苹果“有很多相同的基因”，也让他认定苹果的产品体验和生态粘性（iCloud、Find My iPhone、iMessage 等构成的换机成本）是真正的护城河，而不只是一家硬件公司。2011年建仓时，他把“要不要买苹果”简化成一道算术题：用约2000亿美元市值，买下一家当年利润接近200亿美元、未来5年大概率能到500亿美元的公司。",
      catalyst:
        "段永平明确说过“不做短期的投机”——他讲的“催化剂”不是事件驱动，而是利润复合增长的确定性来源：iPhone 的换机周期、服务生态带来的用户粘性，加上库克主导的大规模股票回购（持续缩减总股本、推高每股价值，他专门做过“苹果回购”的案例分析）。",
      valuation:
        "2011年建仓后不久，他给出的定价逻辑是：苹果当时每股盈利约25-26美元，两三年内大概率翻倍到40-50美元，加上每股净现金会从60多美元涨到100多美元，据此认为“苹果也许某天会到600美元”（对应当时市值约1万亿美元），但同时明确承认“苹果也是有可能掉回到100多块的”——不是精确预测，是“模糊的正确”式的估值方法。",
      risk:
        "段永平自己坦承的风险点：苹果所处的是一个变化很快的行业，他会持续关切“哪些变化有可能改变苹果的地位”；他也坦言不确定自己会不会持有苹果10年以上——这次判断从一开始就不是“闭眼拿到死”的信仰，而是持续验证的判断。",
      quotes,
      entrySummary:
        "2011年建仓，当时苹果市值约3000亿美元（股价对应约44美元/股，未复权），手握约1000亿美元净现金，年利润不到200亿美元。",
    },
    update: {
      filerEntityId: duanFiler.filerEntityId,
      companyEntityId: aapl.id,
      punchYear: 2011,
      quotes,
    },
  });

  console.log("Seeded punch:", punch.id, punch.slug);
}

main().finally(() => prisma.$disconnect());
