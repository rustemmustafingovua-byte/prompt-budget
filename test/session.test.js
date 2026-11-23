import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { extractLastRequest, report, reportSession } from "../src/index.js"

const SAMPLE_RULES = "# Agent rules\nKeep responses concise.\n\n## Tools\nOnly invoke MCP tools when needed."
const SAMPLE_TOOLS = [
  {
    name: "mcp_github_search",
    description: "Search GitHub issues and pull requests with filters",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "mcp_postgres_query",
    description: "Run a read-only SQL query against the connected database",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"],
    },
  },
]

test("reportSession matches report identically on the same input (Anthropic-style JSONL)", () => {
  const firstTurn = {
    type: "request",
    request: {
      system: "# Old rules\nShort.",
      tools: [SAMPLE_TOOLS[0]],
      messages: [{ role: "user", content: "hi" }],
    },
  }
  const lastTurn = {
    type: "request",
    request: {
      system: [{ type: "text", text: SAMPLE_RULES }],
      tools: SAMPLE_TOOLS,
      messages: [{ role: "user", content: "audit tools" }],
    },
  }
  const jsonl = `${JSON.stringify(firstTurn)}\nnot-json-diagnostic-line\n${JSON.stringify(lastTurn)}\n`

  const expected = report({ rules: SAMPLE_RULES, tools: SAMPLE_TOOLS, callsPerSession: 40, priceIn: 3, priceOut: 15 })
  const actual = reportSession(jsonl, { callsPerSession: 40, priceIn: 3, priceOut: 15 })

  assert.deepEqual(actual, expected)
})

test("extractLastRequest handles OpenAI-style messages + function tools in session object", () => {
  const openAiTool = {
    type: "function",
    function: {
      name: "mcp_fetch",
      description: "Fetch a remote document",
      parameters: { type: "object", properties: { url: { type: "string" } } },
    },
  }
  const sessionObj = {
    requests: [
      { messages: [{ role: "system", content: "# Earlier" }], tools: [] },
      {
        messages: [
          { role: "system", content: SAMPLE_RULES },
          { role: "user", content: "check cost" },
        ],
        tools: [openAiTool],
      },
    ],
  }

  const extracted = extractLastRequest(sessionObj)
  assert.equal(extracted.rules, SAMPLE_RULES)
  assert.equal(extracted.tools.length, 1)

  const expected = report({ rules: SAMPLE_RULES, tools: [openAiTool] })
  const actual = reportSession(sessionObj)
  assert.deepEqual(actual, expected)
  assert.equal(actual.tools.perTool[0].name, "mcp_fetch")
})

test("extractLastRequest throws on empty or non-request session logs", () => {
  assert.throws(() => extractLastRequest(""), /no agent request found/)
  assert.throws(() => extractLastRequest('{"ok":true}\n{"ping":1}\n'), /no agent request found/)
})

test("CLI --session produces identical JSON report to static CLI on same input", () => {
  const dir = mkdtempSync(join(tmpdir(), "prompt-budget-test-"))
  try {
    const rulesPath = join(dir, "AGENTS.md")
    const toolsPath = join(dir, "tools.json")
    const sessionPath = join(dir, "session.jsonl")
    writeFileSync(rulesPath, SAMPLE_RULES)
    writeFileSync(toolsPath, JSON.stringify(SAMPLE_TOOLS))
    writeFileSync(
      sessionPath,
      JSON.stringify({ request: { system: SAMPLE_RULES, tools: SAMPLE_TOOLS } }) + "\n"
    )

    const staticOut = execFileSync(
      process.execPath,
      ["bin/prompt-budget.js", rulesPath, "--tools", toolsPath, "--calls", "25", "--json"],
      { encoding: "utf8" }
    )
    const sessionOut = execFileSync(
      process.execPath,
      ["bin/prompt-budget.js", "--session", sessionPath, "--calls", "25", "--json"],
      { encoding: "utf8" }
    )
    assert.deepEqual(JSON.parse(sessionOut), JSON.parse(staticOut))

    // Directory mode picks the most recently modified session file
    const olderPath = join(dir, "a-older.jsonl")
    const newerPath = join(dir, "z-newer.jsonl")
    writeFileSync(olderPath, JSON.stringify({ system: "# Old", tools: [] }) + "\n")
    writeFileSync(newerPath, JSON.stringify({ system: SAMPLE_RULES, tools: SAMPLE_TOOLS }) + "\n")
    const now = Date.now() / 1000
    utimesSync(olderPath, now - 60, now - 60)
    utimesSync(newerPath, now + 10, now + 10)

    const dirOut = execFileSync(
      process.execPath,
      ["bin/prompt-budget.js", "--session", dir, "--calls", "25", "--json"],
      { encoding: "utf8" }
    )
    assert.deepEqual(JSON.parse(dirOut), JSON.parse(staticOut))

    // Stdin mode (-)
    const stdinOut = execFileSync(
      process.execPath,
      ["bin/prompt-budget.js", "--session", "-", "--calls", "25", "--json"],
      {
        encoding: "utf8",
        input: JSON.stringify({ system: SAMPLE_RULES, tools: SAMPLE_TOOLS }),
      }
    )
    assert.deepEqual(JSON.parse(stdinOut), JSON.parse(staticOut))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
