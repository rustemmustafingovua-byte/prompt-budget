#!/usr/bin/env node
/**
 * prompt-budget — measure the token cost of a rules file and tool schemas.
 *
 *   prompt-budget AGENTS.md
 *   prompt-budget AGENTS.md --tools tools.json --calls 50
 */
import { readFileSync, existsSync } from "node:fs"
import { report } from "../src/index.js"

// --- CLI shell: --help / --version -------------------------------------------
const HELP = "prompt-budget — What does your system prompt actually cost on every request?\n\nUSAGE\n  prompt-budget AGENTS.md\n  prompt-budget AGENTS.md --tools tools.json --calls 50\n\nCOMMANDS / OPTIONS\n  --tools <file>     also measure the tool schemas\n  --calls <n>        requests per session (default 50)\n  --price-in <usd>   input price per 1M tokens (default 3)\n  --price-out <usd>  output price per 1M tokens (default 15)\n\nMIT · https://github.com/rustemmustafingovua-byte"
const VERSION = "0.1.0"
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION)
  process.exit(0)
}


const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith("--"))
const arg = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : d
}
if (!file || !existsSync(file)) {
  console.error("usage: prompt-budget <rules.md> [--tools tools.json] [--calls 50]")
  process.exit(2)
}
const rules = readFileSync(file, "utf8")
let tools = []
const tf = arg("--tools")
if (tf && existsSync(tf)) {
  const raw = JSON.parse(readFileSync(tf, "utf8"))
  tools = Array.isArray(raw) ? raw : raw.tools || []
}
const r = report({
  rules,
  tools,
  callsPerSession: Number(arg("--calls", 50)),
  priceIn: Number(arg("--price-in", 3)),
  priceOut: Number(arg("--price-out", 15)),
})

console.log(`\n${file}`)
console.log(`  rules file      ${r.rules.tokens} tokens  (${r.rules.lines} lines, ${r.rules.sections} sections)`)
console.log(`  tool schemas    ${r.tools.tokens} tokens  (${r.tools.count} tools)`)
console.log(`  per request     ${r.perRequestTokens} tokens`)
console.log(`  per session     ${r.sessionTokens} tokens  (${r.callsPerSession} calls)`)
console.log(`  cost            $${r.cost.inputUsd.toFixed(2)} in + $${r.cost.outputUsd.toFixed(2)} out per session`)
console.log(`  verdict         ${r.verdict}\n`)
if (r.rules.perSection.length) {
  console.log("  biggest sections:")
  for (const s of r.rules.perSection.slice(0, 5)) console.log(`    ${String(s.tokens).padStart(6)}  ${s.title.slice(0, 60)}`)
}
if (r.tools.perTool.length) {
  console.log("  biggest tools:")
  for (const t of r.tools.perTool.slice(0, 5)) console.log(`    ${String(t.tokens).padStart(6)}  ${t.name}`)
}
console.log("\n  advice:")
for (const a of r.advice) console.log(`    - ${a}`)
console.log()
