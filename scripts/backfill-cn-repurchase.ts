import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import db from "../src/lib/prisma";

type RepurchaseRow = {
  序号?: number;
  股票代码: string;
  股票简称?: string;
  实施进度?: string;
  已回购金额?: number;
  回购起始时间?: string;
  最新公告日期?: string;
};

type ShareRecord = {
  periodEnd: string;
  periodType: string;
  lineItem: string;
  value: number;
};

async function runCommand(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}


async function ensureExtSource(entityId: string, ticker: string, code: string, market: string) {
  const accessionNumber = "akshare-annual";
  return db.extSource.upsert({
    where: { ExtSource_filer_accession_unique: { filerEntityId: entityId, accessionNumber } },
    create: { kind: "akshare", filerEntityId: entityId, accessionNumber, metadata: { ticker, market, code } },
    update: { metadata: { ticker, market, code } },
  });
}

async function main() {
  console.log("===============================================================");
  console.log("🚀 开始 A 股存量标的「股票回购 ShareRepurchaseAmt & 总股本 CommonStockSharesOutstanding」高效全量回补");
  console.log("===============================================================\n");

  const limitArgIdx = process.argv.indexOf("--limit");
  const limit = limitArgIdx !== -1 ? parseInt(process.argv[limitArgIdx + 1], 10) : undefined;

  const rawCompanies = await db.entity.findMany({
    where: {
      type: "company",
      market: "cn",
      code: { not: null },
      financials: { some: {} },
    },
    select: {
      id: true,
      ticker: true,
      code: true,
      canonicalName: true,
      metadata: true,
    },
    orderBy: { code: "asc" },
  });

  const companies = typeof limit === "number" && !isNaN(limit) ? rawCompanies.slice(0, limit) : rawCompanies;
  console.log(`📊 目标范围: 数据库中已有财务数据的 A 股存量共 ${rawCompanies.length} 家，本次处理 ${companies.length} 家。\n`);

  const startTime = Date.now();

  // -------------------------------------------------------------
  // Phase 1: 回购数据 ShareRepurchaseAmt 全量回补
  // -------------------------------------------------------------
  console.log("--- [Phase 1/2] 股票回购 (ShareRepurchaseAmt) 回补 ---");
  const cachePath = "/tmp/ak_stock_repurchase_cache.json";
  if (!existsSync(cachePath)) {
    console.log("正在拉取东方财富全市场股票回购数据缓存...");
    await runCommand(".venv/bin/python", [
      "-c",
      "import akshare as ak; df = ak.stock_repurchase_em(); df.to_json('/tmp/ak_stock_repurchase_cache.json', orient='records', force_ascii=False)",
    ]);
  }

  let repurchaseCache: RepurchaseRow[] = [];
  try {
    repurchaseCache = JSON.parse(readFileSync(cachePath, "utf-8")) as RepurchaseRow[];
    console.log(`已载入东方财富全市场回购明细缓存: 共 ${repurchaseCache.length} 条记录`);
  } catch (e) {
    console.warn("读取回购缓存失败:", e);
  }

  // 按股票代码组织回购索引
  const repurchaseByCode = new Map<string, RepurchaseRow[]>();
  for (const r of repurchaseCache) {
    const c = String(r.股票代码).padStart(6, "0");
    if (!repurchaseByCode.has(c)) {
      repurchaseByCode.set(c, []);
    }
    repurchaseByCode.get(c)!.push(r);
  }



  // 一次 groupBy 拿每家公司 FY 最大 periodEnd（避免拉几十万行）
  const entityIds = companies.map((c) => c.id);
  const maxFyRows = await db.financial.groupBy({
    by: ["entityId"],
    where: { entityId: { in: entityIds }, periodType: "FY" },
    _max: { periodEnd: true },
  });
  const maxFyYearByEntity = new Map<string, number>();
  for (const r of maxFyRows) {
    if (r._max.periodEnd) {
      maxFyYearByEntity.set(r.entityId, new Date(r._max.periodEnd).getUTCFullYear());
    }
  }

  let repCompaniesWithData = 0;
  const repRows: Array<{
    entityId: string; sourceId: string; periodEnd: Date;
    periodType: string; lineItem: string; value: number; unit: string;
  }> = [];
  const repSourceMap = new Map<string, string>(); // entityId -> sourceId

  for (const comp of companies) {
    const code = comp.code!;
    const repList = repurchaseByCode.get(code);
    if (!repList || repList.length === 0) continue;

    const maxFyYear = maxFyYearByEntity.get(comp.id);
    if (!maxFyYear) continue;

    const repByYear: Record<number, number> = {};
    for (const r of repList) {
      const status = String(r.实施进度 ?? "");
      if (status === "实施中" || status === "完成实施") {
        const amt = typeof r.已回购金额 === "number" ? r.已回购金额 : parseFloat(String(r.已回购金额 ?? 0));
        if (amt && amt > 0) {
          const rawDate = r.回购起始时间 || r.最新公告日期;
          if (rawDate) {
            const rYear = parseInt(String(rawDate).slice(0, 4), 10);
            if (!isNaN(rYear)) {
              const targetYear = Math.min(rYear, maxFyYear);
              repByYear[targetYear] = (repByYear[targetYear] ?? 0) + amt;
            }
          }
        }
      }
    }

    const yearEntries = Object.entries(repByYear);
    if (yearEntries.length === 0) continue;

    repCompaniesWithData++;
    const ticker = comp.ticker ?? (code.startsWith("6") ? `${code}.SS` : `${code}.SZ`);
    const extSource = await ensureExtSource(comp.id, ticker, code, "cn");
    repSourceMap.set(comp.id, extSource.id);

    for (const [yStr, totalAmt] of yearEntries) {
      repRows.push({
        entityId: comp.id,
        sourceId: extSource.id,
        periodEnd: new Date(`${yStr}-12-31T00:00:00.000Z`),
        periodType: "FY",
        lineItem: "ShareRepurchaseAmt",
        value: totalAmt,
        unit: "CNY",
      });
    }
  }

  // 批量写入（createMany skipDuplicates + 逐行 upsert 兜底更新 value）
  let repRowsWritten = 0;
  if (repRows.length > 0) {
    await db.$connect();
    const created = await db.financial.createMany({ data: repRows, skipDuplicates: true });
    repRowsWritten = created.count;
    // upsert remaining (already-existing rows that were skipped — update value)
    for (const row of repRows) {
      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId: row.entityId, periodEnd: row.periodEnd,
            periodType: row.periodType, lineItem: row.lineItem,
          },
        },
        create: row,
        update: { value: row.value, sourceId: row.sourceId },
      });
    }
    repRowsWritten = repRows.length;
  }

  console.log(`✓ 回购回补完成: 命中 ${repCompaniesWithData} 家有回购记录的公司，累计写入 ${repRowsWritten} 行数据。\n`);

  // -------------------------------------------------------------
  // Phase 2: 原生总股本 CommonStockSharesOutstanding 回补
  // -------------------------------------------------------------
  console.log("--- [Phase 2/2] 原生总股本 (CommonStockSharesOutstanding) 回补 ---");

  // 查询哪些公司已经有股本数据
  const existingSharesCounts = await db.financial.groupBy({
    by: ["entityId"],
    where: {
      lineItem: "CommonStockSharesOutstanding",
      entity: { market: "cn" },
    },
    _count: { id: true },
  });
  const hasSharesEntityIds = new Set(existingSharesCounts.map((s) => s.entityId));

  const missingCompanies = companies.filter((c) => !hasSharesEntityIds.has(c.id));
  console.log(`已有股本公司: ${hasSharesEntityIds.size} 家，本次需补充公司: ${missingCompanies.length} 家`);

  if (missingCompanies.length > 0) {
    const BATCH_SIZE = 15;
    let sharesRowsWritten = 0;

    for (let i = 0; i < missingCompanies.length; i += BATCH_SIZE) {
      const batch = missingCompanies.slice(i, i + BATCH_SIZE);
      const codes = batch.map((c) => c.code!);
      const batchFile = `/tmp/cn_shares_batch_${Date.now()}.json`;
      const outFile = `/tmp/cn_shares_out_${Date.now()}.json`;
      writeFileSync(batchFile, JSON.stringify(codes), "utf-8");

      process.stdout.write(
        `[进度 ${i + 1}~${Math.min(i + BATCH_SIZE, missingCompanies.length)}/${missingCompanies.length}] 正在提取 ${codes.join(", ")}... `
      );

      const res = await runCommand(".venv/bin/python", [
        "scripts/extract-cn-shares.py",
        "--codes",
        batchFile,
        "--out",
        outFile,
      ]);

      if (res.code !== 0 || !existsSync(outFile)) {
        console.log(`✗ 批次抓取异常: ${res.stderr.slice(0, 100)}`);
        continue;
      }

      let batchData: Record<string, ShareRecord[]> = {};
      try {
        batchData = JSON.parse(readFileSync(outFile, "utf-8"));
      } catch {
        console.log("✗ 解析批次结果失败");
        continue;
      }

      // 批量写入该批次到数据库（createMany skipDuplicates，比逐行 upsert 快 10-20x）
      let batchWritten = 0;
      for (const comp of batch) {
        const code = comp.code!;
        const recs = batchData[code];
        if (!recs || recs.length === 0) continue;

        const ticker = comp.ticker ?? (code.startsWith("6") ? `${code}.SS` : `${code}.SZ`);
        const extSource = await ensureExtSource(comp.id, ticker, code, "cn");

        const rows = recs.map((rec) => ({
          entityId: comp.id,
          sourceId: extSource.id,
          periodEnd: new Date(rec.periodEnd),
          periodType: rec.periodType,
          lineItem: rec.lineItem,
          value: rec.value,
          unit: "CNY" as const,
        }));

        // Retry once on P1017 connection-reset (Prisma idle timeout during long Python fetch)
        let result = { count: 0 };
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await db.$connect();
            result = await db.financial.createMany({ data: rows, skipDuplicates: true });
            break;
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (attempt === 0 && (code === "P1017" || code === "P1001")) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            throw err;
          }
        }
        batchWritten += result.count;
      }

      sharesRowsWritten += batchWritten;
      console.log(`✓ 写入 ${batchWritten} 条`);
    }
    console.log(`✓ 股本回补完成: 共写入 ${sharesRowsWritten} 行股本数据。\n`);
  }

  // -------------------------------------------------------------
  // Phase 3: 全库总体验收与统计
  // -------------------------------------------------------------
  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log("===============================================================");
  console.log(`🏁 回补任务全部完成！总耗时: ${durationSec} 秒 (${(durationSec / 60).toFixed(1)} 分钟)`);

  const totalRepRows = await db.financial.count({
    where: { lineItem: "ShareRepurchaseAmt", entity: { market: "cn" } },
  });
  const repEntities = await db.financial.groupBy({
    by: ["entityId"],
    where: { lineItem: "ShareRepurchaseAmt", entity: { market: "cn" } },
  });

  const totalSharesRows = await db.financial.count({
    where: { lineItem: "CommonStockSharesOutstanding", entity: { market: "cn" } },
  });
  const sharesEntities = await db.financial.groupBy({
    by: ["entityId"],
    where: { lineItem: "CommonStockSharesOutstanding", entity: { market: "cn" } },
  });

  console.log(`📈 A 股库内 ShareRepurchaseAmt 行数: ${totalRepRows} 行，覆盖公司: ${repEntities.length} 家`);
  console.log(`📈 A 股库内 CommonStockSharesOutstanding 行数: ${totalSharesRows} 行，覆盖公司: ${sharesEntities.length} 家 / ${rawCompanies.length} 家`);
  console.log("===============================================================\n");

  // 抽查 2 家代表性公司的最新财务数据状态
  const sampleCodes = ["600519", "000651", "600887"];
  console.log("🔍 代表性标的数据抽查:");
  for (const c of sampleCodes) {
    const e = await db.entity.findFirst({
      where: { code: c, market: "cn" },
      select: { id: true, code: true, canonicalName: true },
    });
    if (!e) continue;

    const latestShare = await db.financial.findFirst({
      where: { entityId: e.id, lineItem: "CommonStockSharesOutstanding", periodType: "FY" },
      orderBy: { periodEnd: "desc" },
    });
    const repurchases = await db.financial.findMany({
      where: { entityId: e.id, lineItem: "ShareRepurchaseAmt" },
      orderBy: { periodEnd: "desc" },
    });
    const totalRep = repurchases.reduce((sum, r) => sum + Number(r.value), 0);

    console.log(
      `  - ${e.code} ${e.canonicalName}: 最新 FY 股本 = ${latestShare ? (latestShare.value / 1e8).toFixed(2) + " 亿股 (" + new Date(latestShare.periodEnd).getFullYear() + ")" : "无"} | 累计回购 = ${(totalRep / 1e8).toFixed(2)} 亿元 (${repurchases.length} 年记录)`
    );
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("回补主流程异常:", err);
  await db.$disconnect();
  process.exit(1);
});
