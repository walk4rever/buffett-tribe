/**
 * 分析和分类未匹配的公司
 * 将结果保存到数据库的 metadata 字段
 */
import prisma from "@/lib/prisma";
import { writeFile } from "fs/promises";

// 未匹配的 80 家公司列表（从上一个脚本的输出）
const NOT_FOUND_TICKERS = [
  "OZON", "DAY", "VTV", "SUMO", "MIME", "AVLR", "MXIM", "ESMT", "QQQ", "IXJ",
  "VUG", "IWF", "VWO", "VOE", "OEF", "IWM", "SPLV", "EWL", "LBRDK", "AKRE",
  "VEA", "IJR", "BSV", "FCAU", "WBC", "UTX", "BITF", "GDX", "ETHM", "MASI",
  "ANSS", "WNS", "INST", "CPRX", "BFB", "DCT", "HCP", "DISH", "TWTR", "IIVI",
  "FL", "XLNX", "CREE", "CEIX", "ARCH", "TWKS", "INFO", "KNBE", "UNVR", "RTN",
  "CWAN", "OLPX", "CFLT", "SEGRT", "HHC", "SONDQ", "SATS", "SMH", "JNPR", "SOND",
  "CPARU", "FTCHQ", "STRYQ", "BRDS", "PLAN", "AGCUU", "RDFN", "EA", "ZEN", "CYBR",
  "SPLK", "SMAR", "AYX", "COUP", "MEKA", "DGNR", "OLO", "RSVA", "XM", "TBA"
];

// 手动分类（基于公开信息）
const CLASSIFICATION = {
  etf: [
    "VTV", "QQQ", "IXJ", "VUG", "IWF", "VWO", "VOE", "OEF", "IWM",
    "SPLV", "EWL", "VEA", "IJR", "BSV", "GDX", "SMH"
  ],
  acquired: [
    "SPLK",    // Splunk → Cisco (2024)
    "PLAN",    // Anaplan → Thoma Bravo (2022)
    "XLNX",    // Xilinx → AMD (2022)
    "MXIM",    // Maxim Integrated → Analog Devices (2021)
    "COUP",    // Coupa → Thoma Bravo (2023)
    "AYX",     // Alteryx → Clearlake/Insight (2023)
    "SUMO",    // Sumo Logic → Francisco Partners (2023)
    "MIME",    // Mimecast → Permira (2022)
    "AVLR",    // Avalara → Vista Equity (2023)
    "INST",    // Instructure → KKR → Thoma Bravo (2020)
    "ZEN",     // Zendesk → Permira/Hellman & Friedman (2022)
    "SMAR",    // Smartsheet → Vista Equity/Blackstone (2024)
    "CFLT",    // Confluent (still public, might be error)
    "CWAN",    // Clearwater Analytics (still public, might be error)
    "OLPX",    // Olaplex → Advent (2024)
  ],
  delisted: [
    "FTCHQ",   // Farfetch 破产
    "TWTR",    // Twitter → X (私有化)
    "SONDQ",   // Sonder 破产
    "STRYQ",   // Starry 破产
    "BRDS",    // Bird 破产
  ],
  ticker_changed: [
    "RTN",     // Raytheon → RTX
    "UTX",     // United Technologies → RTX
    "FCAU",    // Fiat Chrysler → STLA
    "HCP",     // HCP → Healthpeak (PEAK)
    "DCT",     // DCT Industrial → Prologis (PLD)
    "TWKS",    // Thoughtworks → 私有化
  ],
  still_public: [
    "EA",      // Electronic Arts (应该能找到，可能是bug)
    "JNPR",    // Juniper Networks (应该能找到)
    "ANSS",    // Ansys (应该能找到)
    "RDFN",    // Redfin (应该能找到)
    "CYBR",    // CyberArk (应该能找到)
    "SEGRT",   // Seaport Entertainment (应该能找到)
    "HHC",     // Howard Hughes (应该能找到)
  ],
  unknown: [
    "OZON", "DAY", "ESMT", "LBRDK", "AKRE", "WBC", "BITF", "ETHM", "MASI",
    "WNS", "CPRX", "BFB", "DISH", "IIVI", "FL", "CREE", "CEIX", "ARCH",
    "INFO", "KNBE", "UNVR", "SATS", "SOND", "CPARU", "AGCUU", "MEKA",
    "DGNR", "OLO", "RSVA", "XM", "TBA"
  ]
};

type ClassificationType = keyof typeof CLASSIFICATION;

function classifyTicker(ticker: string): ClassificationType {
  for (const [category, tickers] of Object.entries(CLASSIFICATION)) {
    if (tickers.includes(ticker)) {
      return category as ClassificationType;
    }
  }
  return "unknown";
}

const CATEGORY_LABELS: Record<ClassificationType, string> = {
  etf: "ETF（交易所基金）",
  acquired: "已被收购/私有化",
  delisted: "已退市/破产",
  ticker_changed: "Ticker 已变更",
  still_public: "仍在交易（可能是匹配错误）",
  unknown: "未知状态"
};

async function main() {
  console.log("=== Classify Unmatched Companies ===\n");

  // 统计分类
  const stats: Record<ClassificationType, number> = {
    etf: 0,
    acquired: 0,
    delisted: 0,
    ticker_changed: 0,
    still_public: 0,
    unknown: 0
  };

  const classified: Record<ClassificationType, Array<{ ticker: string; name: string; entityId: string }>> = {
    etf: [],
    acquired: [],
    delisted: [],
    ticker_changed: [],
    still_public: [],
    unknown: []
  };

  // 查询这些公司的详细信息
  for (const ticker of NOT_FOUND_TICKERS) {
    const entity = await prisma.entity.findFirst({
      where: {
        type: "company",
        ticker: { equals: ticker, mode: "insensitive" }
      },
      select: {
        id: true,
        ticker: true,
        canonicalName: true,
        metadata: true
      }
    });

    if (!entity) {
      console.log(`⚠️ ${ticker} not found in database`);
      continue;
    }

    const category = classifyTicker(ticker);
    stats[category]++;
    classified[category].push({
      ticker: entity.ticker!,
      name: entity.canonicalName || "Unknown",
      entityId: entity.id
    });

    // 更新 metadata
    const existingMeta = (entity.metadata as Record<string, unknown>) || {};
    await prisma.entity.update({
      where: { id: entity.id },
      data: {
        metadata: {
          ...existingMeta,
          unmatchedReason: category,
          unmatchedReasonLabel: CATEGORY_LABELS[category],
          unmatchedAt: new Date().toISOString()
        }
      }
    });
  }

  // 输出统计
  console.log("=== Classification Summary ===\n");
  for (const [category, count] of Object.entries(stats)) {
    console.log(`${CATEGORY_LABELS[category as ClassificationType].padEnd(30)}: ${count}`);
  }
  console.log(`${"总计".padEnd(30)}: ${NOT_FOUND_TICKERS.length}\n`);

  // 输出详细分类
  console.log("=== Detailed Classification ===\n");
  for (const [category, companies] of Object.entries(classified)) {
    if (companies.length === 0) continue;

    console.log(`\n${CATEGORY_LABELS[category as ClassificationType]} (${companies.length}):`);
    companies.forEach(c => {
      console.log(`  ${c.ticker.padEnd(12)} ${c.name}`);
    });
  }

  // 保存到文件
  const output = {
    summary: stats,
    classifications: classified,
    categoryLabels: CATEGORY_LABELS
  };

  await writeFile(
    "unmatched-companies-classification.json",
    JSON.stringify(output, null, 2)
  );

  console.log("\n✓ Classification saved to unmatched-companies-classification.json");
  console.log("✓ Database metadata updated for all unmatched companies");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
