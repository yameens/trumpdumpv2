import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI();

/** Pipeline JSON lives here when you use `data/tickerData/`. */
const TICKER_DATA_DIR = path.join(__dirname, "tickerData");

function resolveTickerIndustriesPath(): string {
  const inTickerData = path.join(TICKER_DATA_DIR, "ticker_industries.json");
  const legacy = path.join(__dirname, "ticker_industries.json");
  if (fs.existsSync(inTickerData)) return inTickerData;
  if (fs.existsSync(legacy)) return legacy;
  return inTickerData;
}

/**
 * The 11 official GICS sectors plus one escape-hatch bucket for fund wrappers
 * that don't represent operating companies.
 */
const GICS_BUCKETS = [
  "Energy",
  "Materials",
  "Industrials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Information Technology",
  "Communication Services",
  "Utilities",
  "Real Estate",
  "Closed-End Funds & SPACs",
] as const;

const FALLBACK_BUCKET = "Uncategorized";

const SYSTEM_PROMPT = `You are an elite quantitative financial analyst mapping equity industry strings to GICS sectors.

ALLOWED BUCKETS — you must use ONLY these 12 names, spelled exactly as written:
${GICS_BUCKETS.map((b) => `- ${b}`).join("\n")}

MAPPING RULES:
1. Map EVERY raw industry string the user provides into one of the 12 allowed buckets above.
2. Do NOT invent new bucket names. Every key in your output must be one of the 12 names above.
3. If a string is ambiguous, use the bucket whose underlying economic driver is closest.
4. Closed-End Funds, SPACs, BDCs, and blank-check companies → "Closed-End Funds & SPACs".
5. REITs → "Real Estate" (regardless of REIT sub-type).
6. Education & Training Services, Education Services, for-profit schools → "Consumer Discretionary".
7. "Unknown" → "Financials" as a catch-all for unclassifiable strings.

OUTPUT FORMAT: respond with a single valid JSON object only — no markdown, no commentary.
Keys = bucket names (from the allowed list), values = arrays of the raw industry strings you placed there.
Every raw string provided by the user must appear in exactly one array.`;

function loadTickerIndustries(inputFile: string): [string, string][] {
  const raw = fs.readFileSync(inputFile, "utf-8");
  return JSON.parse(raw) as [string, string][];
}

function buildReverseMap(clustering: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [bucket, industries] of Object.entries(clustering)) {
    for (const ind of industries) {
      map.set(ind, bucket);
    }
  }
  return map;
}

async function clusterIndustries(
  uniqueIndustries: string[],
): Promise<Record<string, string[]>> {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(uniqueIndustries) },
    ],
    temperature: 0.1,
  });

  const text = response.choices[0]?.message.content ?? "{}";
  return JSON.parse(text) as Record<string, string[]>;
}

function patchMissingIndustries(
  clustering: Record<string, string[]>,
  uniqueIndustries: string[],
): void {
  const assigned = new Set<string>();
  for (const arr of Object.values(clustering)) {
    for (const s of arr) assigned.add(s);
  }
  const missing = uniqueIndustries.filter((s) => !assigned.has(s));
  if (missing.length === 0) return;
  if (!clustering[FALLBACK_BUCKET]) clustering[FALLBACK_BUCKET] = [];
  clustering[FALLBACK_BUCKET].push(...missing);
  console.warn(`Patched ${missing.length} unassigned industries into "${FALLBACK_BUCKET}": ${JSON.stringify(missing)}`);
}

function main() {
  void (async () => {
    const inputFile = resolveTickerIndustriesPath();
    const outputFile = path.join(path.dirname(inputFile), "industry_buckets.json");
    const pairs = loadTickerIndustries(inputFile);
    const unique = [...new Set(pairs.map(([, i]) => i))].sort((a, b) => a.localeCompare(b));

    console.log(`Tickers: ${pairs.length}, unique industries: ${unique.length}`);
    console.log(`Calling gpt-4o with ${GICS_BUCKETS.length} fixed GICS buckets...`);

    let clustering: Record<string, string[]>;
    try {
      clustering = await clusterIndustries(unique);
    } catch (e) {
      console.error("Failed to cluster industries:", e);
      process.exit(1);
    }

    // Warn about any non-canonical bucket names the model invented
    const allowedSet = new Set<string>([...GICS_BUCKETS, FALLBACK_BUCKET]);
    const invented = Object.keys(clustering).filter((k) => !allowedSet.has(k));
    if (invented.length) {
      console.warn(`Model invented ${invented.length} non-canonical bucket(s): ${JSON.stringify(invented)}`);
    }

    // Find any raw industries the model missed and repair in a second pass
    const assignedAfterFirst = new Set<string>();
    for (const arr of Object.values(clustering)) {
      for (const s of arr) assignedAfterFirst.add(s);
    }
    const missing = unique.filter((s) => !assignedAfterFirst.has(s));
    if (missing.length > 0) {
      console.log(`Repair pass: ${missing.length} industries missed — sending again...`);
      try {
        const repairClustering = await clusterIndustries(missing);
        for (const [bucket, inds] of Object.entries(repairClustering)) {
          if (!clustering[bucket]) clustering[bucket] = [];
          clustering[bucket]!.push(...inds);
        }
      } catch {
        console.warn("Repair pass failed; falling back to patch.");
      }
    }

    // Any still-missing industries after repair go into Uncategorized
    patchMissingIndustries(clustering, unique);

    const rawToBucket = buildReverseMap(clustering);

    // Map tickers to their canonical buckets
    const buckets: Record<string, string[]> = {};
    const ensureBucket = (name: string) => {
      if (!buckets[name]) buckets[name] = [];
    };

    for (const [ticker, industry] of pairs) {
      const bucket = rawToBucket.get(industry) ?? FALLBACK_BUCKET;
      ensureBucket(bucket);
      buckets[bucket]!.push(ticker);
    }

    // Dedupe, sort tickers; sort bucket keys; drop empty buckets
    const sorted: Record<string, string[]> = {};
    for (const key of Object.keys(buckets).sort((a, b) => a.localeCompare(b))) {
      const row = buckets[key];
      if (!row) continue;
      const seen = new Set<string>();
      const deduped = row.filter((t) => {
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });
      if (deduped.length > 0) sorted[key] = deduped.sort((a, b) => a.localeCompare(b));
    }

    fs.writeFileSync(outputFile, JSON.stringify(sorted, null, 2));

    const bucketCount = Object.keys(sorted).length;
    let totalTickers = 0;
    for (const v of Object.values(sorted)) totalTickers += v.length;

    console.log(`\nBuckets: ${bucketCount}`);
    console.log(`Total tickers mapped: ${totalTickers}`);
    console.log(`Industries covered: ${unique.filter((i) => rawToBucket.has(i)).length}/${unique.length}`);
    console.log(`Wrote ${outputFile}`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
