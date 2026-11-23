#!/usr/bin/env node
/**
 * prompt-budget — measure the token cost of a rules file and tool schemas.
 *
 *   prompt-budget AGENTS.md
 *   prompt-budget AGENTS.md --tools tools.json --calls 50
 *   prompt-budget --session session.jsonl --calls 50
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { report, reportSession } from "../src/index.js"

// --- CLI shell: --help / --version -------------------------------------------
const HELP = `prompt-budget — What does your system prompt actually cost on every request?

USAGE
  prompt-budget AGENTS.md
  prompt-budget AGENTS.md --tools tools.json --calls 50
  prompt-budget --session session.jsonl [--calls 50] [--json]

COMMANDS / OPTIONS
  --tools <file>     also measure the tool schemas
  --session <path>   inspect the last request from a session JSON/JSONL file, directory, or "-" (stdin)
  --calls <n>        requests per session (default 50)
  --price-in <usd>   input price per 1M tokens (default 3)
  --price-out <usd>  output price per 1M tokens (default 15)
  --json             print machine-readable JSON output

MIT · https://github.com/rustemmustafingovua-byte`
const VERSION = "0.1.0"
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION)
  process.exit(0)
}

const VALUE_FLAGS = new Set(["--tools", "--session", "--calls", "--price-in", "--price-out"])
const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : d
}
const hasFlag = (n) => argv.includes(n)

function positionalFile(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i += 1
      continue
    }
    if (!args[i].startsWith("--")) return args[i]
  }
  return undefined
}

function resolveSessionPath(target) {
  if (target === "-") return "-"
  if (!existsSync(target)) return null
  const st = statSync(target)
  if (!st.isDirectory()) return target
  const files = readdirSync(target)
    .filter((name) => name.endsWith(".jsonl") || name.endsWith(".json"))
    .map((name) => {
      const full = join(target, name)
      return { full, mtimeMs: statSync(full).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files[0]?.full || null
}

const callsPerSession = Number(arg("--calls", 50))
const priceIn = Number(arg("--price-in", 3))
const priceOut = Number(arg("--price-out", 15))
const asJson = hasFlag("--json")
const sessionTarget = arg("--session")

let label
let r

if (sessionTarget) {
  const resolved = resolveSessionPath(sessionTarget)
  if (!resolved) {
    console.error(`session not found: ${sessionTarget}`)
    process.exit(2)
  }
  const raw = resolved === "-" ? readFileSync(0, "utf8") : readFileSync(resolved, "utf8")
  try {
    r = reportSession(raw, { callsPerSession, priceIn, priceOut })
  } catch (err) {
    console.error(`invalid session log (${resolved}): ${err.message}`)
    process.exit(2)
  }
  label = resolved === "-" ? "stdin (last request)" : `${resolved} (last request)`
} else {
  const file = positionalFile(argv)
  if (!file || !existsSync(file)) {
    console.error("usage: prompt-budget <rules.md> [--tools tools.json] [--calls 50] | prompt-budget --session <file|dir|->")
    process.exit(2)
  }
  const rules = readFileSync(file, "utf8")
  let tools = []
  const tf = arg("--tools")
  if (tf && existsSync(tf)) {
    const raw = JSON.parse(readFileSync(tf, "utf8"))
    tools = Array.isArray(raw) ? raw : raw.tools || []
  }
  r = report({
    rules,
    tools,
    callsPerSession,
    priceIn,
    priceOut,
  })
  label = file
}

if (asJson) {
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

console.log(`\n${label}`)
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
