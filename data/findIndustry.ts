import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new OpenAI();

const TICKER_INDUSTRY_PROMPT = `
You are a financial data normalizer.

You are given a list of stock tickers (U.S. and international).

Your task:
For EACH ticker, return a tuple of:
(ticker, industry)

Rules:
1. Industry must be specific (e.g., "Semiconductors", "Integrated Oil & Gas", "Regional Banking", "Managed Healthcare", NOT just "Technology" or "Finance")
2. Use commonly accepted financial industry classifications (similar to GICS-level specificity)
3. If a ticker is ambiguous or delisted, infer the MOST RECENT known industry
4. If completely unknown, return "Unknown"
5. Do NOT skip any ticker

Output format:
- Return a JSON array of tuples
- Each tuple must be exactly:
  ["TICKER", "Industry"]

Example:
Input:
AAPL
XOM

Output:
[
  ["AAPL", "Consumer Electronics"],
  ["XOM", "Integrated Oil & Gas"]
]

Now process the following tickers:

{TICKERS}

Return ONLY the JSON array. No explanation, no markdown, no extra text.
`.trim();

const TICKER_DATA_DIR = path.join(__dirname, "tickerData");
const BATCH_SIZE = 50;

function tickersFilePath(): string {
  const nested = path.join(TICKER_DATA_DIR, "tickers.txt");
  if (fs.existsSync(nested)) return nested;
  return path.join(__dirname, "tickers.txt");
}

/** Read progress from tickerData first, then legacy `data/` file. */
function tickerIndustriesReadPath(): string {
  const nested = path.join(TICKER_DATA_DIR, "ticker_industries.json");
  const legacy = path.join(__dirname, "ticker_industries.json");
  if (fs.existsSync(nested)) return nested;
  if (fs.existsSync(legacy)) return legacy;
  return nested;
}

/** Always write new results under `tickerData/` (matches consolidateIndustries). */
function tickerIndustriesWritePath(): string {
  fs.mkdirSync(TICKER_DATA_DIR, { recursive: true });
  return path.join(TICKER_DATA_DIR, "ticker_industries.json");
}

function loadTickers(): string[] {
  const raw = fs.readFileSync(tickersFilePath(), "utf-8");
  return raw
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function loadExisting(): Record<string, string> {
  const OUTPUT_FILE = tickerIndustriesReadPath();
  if (fs.existsSync(OUTPUT_FILE)) {
    const raw = fs.readFileSync(OUTPUT_FILE, "utf-8");
    try {
      const arr: [string, string][] = JSON.parse(raw);
      return Object.fromEntries(arr);
    } catch {
      return {};
    }
  }
  return {};
}

function saveResults(map: Record<string, string>): void {
  const out = tickerIndustriesWritePath();
  const arr = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
}

async function processBatch(tickers: string[]): Promise<[string, string][]> {
  const prompt = TICKER_INDUSTRY_PROMPT.replace("{TICKERS}", tickers.join("\n"));

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
  });

  const text = response.choices[0]?.message.content?.trim() ?? "[]";

  try {
    const parsed: [string, string][] = JSON.parse(text);
    return parsed;
  } catch {
    console.error("Failed to parse response for batch:", tickers);
    console.error("Raw response:", text);
    return tickers.map((t) => [t, "Unknown"]);
  }
}

async function main() {
  const allTickers = loadTickers();
  const existing = loadExisting();

  const remaining = allTickers.filter((t) => !(t in existing));

  console.log(`Total tickers: ${allTickers.length}`);
  console.log(`Already processed: ${allTickers.length - remaining.length}`);
  console.log(`Remaining: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All tickers already processed!");
    return;
  }

  let processed = 0;

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);

    console.log(`\nBatch ${batchNum}/${totalBatches}: ${batch[0]} → ${batch[batch.length - 1]}`);

    try {
      const results = await processBatch(batch);

      for (const [ticker, industry] of results) {
        existing[ticker] = industry;
      }

      processed += batch.length;
      saveResults(existing);

      console.log(`  ✓ ${results.length} tickers done (total: ${Object.keys(existing).length})`);
    } catch (err) {
      console.error(`  ✗ Batch failed:`, err);
      for (const t of batch) {
        existing[t] = "Unknown";
      }
      saveResults(existing);
    }

    // small delay to avoid rate limits
    if (i + BATCH_SIZE < remaining.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\nDone! Processed ${processed} tickers.`);
  console.log(`Results saved to: ${tickerIndustriesWritePath()}`);
}

main().catch(console.error);
