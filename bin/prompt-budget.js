#!/usr/bin/env node
/**
 * prompt-budget — measure the token cost of a rules file and tool schemas.
 *
 *   prompt-budget AGENTS.md
 *   prompt-budget AGENTS.md --tools tools.json --calls 50
 */
import { readFileSync, existsSync } from "node:fs"
import { report } from "../src/index.js"

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
