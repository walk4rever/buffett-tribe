import { readFileSync } from "node:fs";
import db from "../src/lib/prisma";
import { classifySectorLlm } from "./lib/cn-hk-sector-classify";

type Profile = {
  canonicalName: string | null;
  nameZh: string | null;
  nameEnShort: string | null;
  exchange: string | null;
  industryRaw: string | null;
  businessDescription: string | null;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

async function main() {
  const filePath = process.argv[2];
  const ticker = getArg("--ticker");
  const code = getArg("--code");
  const market = getArg("--market");

  if (!filePath || !ticker || !code || !market || (market !== "cn" && market !== "hk")) {
    console.error(
      "Usage: tsx import-cn-hk-company-profile-from-file.ts <json-file> --ticker <T> --code <C> --market cn|hk",
    );
    process.exit(1);
  }

  const profile = JSON.parse(readFileSync(filePath, "utf-8")) as Profile;
  if (!profile.canonicalName || !profile.nameZh || !profile.exchange) {
    console.error(`Incomplete profile in ${filePath}: ${JSON.stringify(profile)}`);
    process.exit(1);
  }

  const sector = profile.industryRaw
    ? await classifySectorLlm({
        companyName: profile.canonicalName,
        industryRaw: profile.industryRaw,
        businessDescription: profile.businessDescription,
      })
    : null;

  const existing = await db.entity.findFirst({
    where: { type: "company", market, code },
    select: { id: true, metadata: true },
  });

  const data = {
    type: "company" as const,
    canonicalName: profile.canonicalName,
    ticker,
    market,
    code,
    sector,
    metadata: {
      ...(existing?.metadata as Record<string, unknown> | null),
      nameZh: profile.nameZh,
      nameEnShort: profile.nameEnShort ?? profile.canonicalName,
      industry: profile.industryRaw,
      exchange: profile.exchange,
    },
  };

  const entity = existing
    ? await db.entity.update({ where: { id: existing.id }, data })
    : await db.entity.create({ data });

  console.log(`Wrote Entity ${entity.id} (${profile.nameZh} / ${market.toUpperCase()} ${code}, sector=${sector ?? "unclassified"})`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
