#!/usr/bin/env node
// ============================================================================
// Draft apartment application letters from pasted listing URLs.
//
//   npm run draft -- <url> [<url> ...]      # URLs as arguments
//   npm run draft                           # paste a block, then Ctrl+D (Ctrl+Z on Windows)
//   npm run draft -- --out letters.md <url> # also write a markdown file
//
// Mixes ImmoScout24 and Kleinanzeigen links freely; each is detected by URL.
// Filters are NOT applied: pasting a link is the decision. Listings outside the
// configured criteria are still drafted, just flagged.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { parseListingUrls } from "../lib/apartments/url";
import { draftListings, type DraftedListing } from "../lib/apartments/draft-from-url";

// Load .env (no dependency; the Trigger runtime injects env in production).
function loadEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function facts(r: DraftedListing): string {
  const i = r.item!;
  return [
    i.location,
    i.warmmiete != null ? `${Math.round(i.warmmiete)} € warm` : null,
    i.kaltmiete != null ? `${Math.round(i.kaltmiete)} € kalt` : null,
    i.wohnflaeche != null ? `${i.wohnflaeche} m²` : null,
    i.zimmer != null ? `${i.zimmer} Zi` : null,
    i.distanceKm != null ? `${i.distanceKm} km` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

async function main(): Promise<void> {
  loadEnv();

  const argv = process.argv.slice(2);
  let outFile: string | null = null;
  const outIdx = argv.findIndex((a) => a === "--out" || a === "-o");
  if (outIdx !== -1) {
    outFile = argv[outIdx + 1] ?? null;
    argv.splice(outIdx, 2);
  }

  const input = argv.length ? argv.join("\n") : await readStdin();
  const { listings, rejected } = parseListingUrls(input);

  for (const line of rejected) {
    console.error(C.yellow(`⚠ not a listing URL, skipped: ${line.slice(0, 80)}`));
  }
  if (listings.length === 0) {
    console.error(C.red("No listing URLs found."));
    console.error(C.dim("Usage: npm run draft -- <url> [<url> ...]   (or pipe/paste URLs on stdin)"));
    process.exit(1);
  }

  const byline = listings.reduce<Record<string, number>>((a, l) => {
    a[l.source] = (a[l.source] ?? 0) + 1;
    return a;
  }, {});
  console.error(
    C.dim(
      `Drafting ${listings.length} listing(s) — ` +
        Object.entries(byline).map(([s, n]) => `${n} ${s}`).join(", ") +
        "\n"
    )
  );

  let done = 0;
  const results = await draftListings(listings, {
    concurrency: 3,
    onDone: (r) => {
      done++;
      const tag = `[${done}/${listings.length}]`;
      if (r.ok) console.error(C.dim(`${tag} ✓ ${r.source} ${r.id}`));
      else console.error(C.red(`${tag} ✗ ${r.source} ${r.id}: ${r.error}`));
    },
  });

  const md: string[] = [`# Bewerbungen (${listings.length})\n`];
  console.log("");

  for (const r of results) {
    if (!r.ok) {
      console.log(C.red(`\n${"─".repeat(74)}\n✗ ${r.source} ${r.id} — ${r.error}\n   ${r.url}`));
      md.push(`\n---\n\n## ⚠️ ${r.source} ${r.id} — ${r.error}\n\n${r.url}\n`);
      continue;
    }
    const i = r.item!;
    const warn = r.outsideCriteria?.length
      ? C.yellow(`  ⚠ ausserhalb der Kriterien: ${r.outsideCriteria.join(", ")}`)
      : "";

    console.log(C.dim("─".repeat(74)));
    console.log(C.bold(i.title));
    console.log(facts(r) + (i.contactName ? `  ·  ${i.contactName}` : ""));
    console.log(C.cyan(i.url) + warn);
    console.log(C.dim("─".repeat(74)));
    console.log(i.letter);
    console.log("");

    md.push(
      `\n---\n\n## ${i.title}\n\n${facts(r)}  \n` +
        (i.contactName ? `Kontakt: ${i.contactName}  \n` : "") +
        (r.outsideCriteria?.length ? `⚠️ Ausserhalb der Kriterien: ${r.outsideCriteria.join(", ")}  \n` : "") +
        `🔗 ${i.url}\n\n\`\`\`text\n${i.letter}\n\`\`\`\n`
    );
  }

  const okCount = results.filter((r) => r.ok).length;
  console.error(
    (okCount === results.length ? C.green : C.yellow)(
      `\n${okCount}/${results.length} drafted.`
    )
  );

  if (outFile) {
    fs.writeFileSync(outFile, md.join(""), "utf8");
    console.error(C.dim(`Written to ${outFile}`));
  }
}

main().catch((e) => {
  console.error(C.red(`Failed: ${(e as Error).message}`));
  process.exit(1);
});
