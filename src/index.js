/**
 * prompt-budget — how many tokens does your system prompt actually cost?
 *
 * Every request re-sends the system prompt, the tool schemas and the rules
 * file. On a metered model that is the dominant cost, and on a free tier it is
 * what burns the daily pool. This measures it before you ship it.
 */
export function estimateTokens(text) {
  if (!text) return 0
  const s = String(text)
  const words = s.split(/\s+/).filter(Boolean)
  // latin ~4 chars/token, code and CJK are denser
  const cjk = (s.match(/[\u3000-\u9fff]/g) || []).length
  const rest = s.length - cjk
  return Math.max(Math.ceil(rest / 4) + cjk, Math.ceil(words.length * 1.3))
}

/** Split a rules file into its sections. */
export function sections(markdown) {
  const out = []
  const lines = String(markdown || "").split("\n")
  let current = null
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      current = { level: h[1].length, title: h[2].trim(), body: "" }
      out.push(current)
      continue
    }
    if (current) current.body += line + "\n"
  }
  return out
}

/** Analyse one rules file. */
export function analyseFile(name, content) {
  const tokens = estimateTokens(content)
  const lines = String(content || "").split("\n").length
  const secs = sections(content)
  const perSection = secs
    .map((s) => ({ title: s.title, level: s.level, tokens: estimateTokens(s.body) }))
    .sort((a, b) => b.tokens - a.tokens)
  const codeBlocks = (String(content).match(/```[\s\S]*?```/g) || [])
  const codeTokens = codeBlocks.reduce((n, b) => n + estimateTokens(b), 0)
  return {
    name,
    tokens,
    lines,
    sections: secs.length,
    perSection,
    codeTokens,
    longestSection: perSection[0] || null,
  }
}

/** Analyse tool schemas. */
export function analyseTools(tools) {
  const list = Array.isArray(tools) ? tools : tools?.tools || []
  const perTool = list.map((t) => ({
    name: t?.name || t?.function?.name || "(unnamed)",
    tokens: estimateTokens(JSON.stringify(t)),
  }))
  return {
    count: list.length,
    tokens: perTool.reduce((n, t) => n + t.tokens, 0),
    perTool: perTool.sort((a, b) => b.tokens - a.tokens),
  }
}

function extractTextContent(value) {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text
          if (typeof part.content === "string") return part.content
        }
        return ""
      })
      .filter(Boolean)
      .join("\n\n")
  }
  return ""
}

function unwrapRequestCandidate(entry) {
  if (!entry || typeof entry !== "object") return null
  if (entry.request && typeof entry.request === "object") return unwrapRequestCandidate(entry.request)
  if (entry.payload && typeof entry.payload === "object") return unwrapRequestCandidate(entry.payload)
  if (entry.body && typeof entry.body === "object") return unwrapRequestCandidate(entry.body)
  if (entry.input && typeof entry.input === "object" && !Array.isArray(entry.input)) {
    if ("system" in entry.input || "tools" in entry.input || "messages" in entry.input) {
      return entry.input
    }
  }
  const hasRequestShape =
    "system" in entry ||
    "instructions" in entry ||
    "tools" in entry ||
    "mcpTools" in entry ||
    "functions" in entry ||
    "rules" in entry ||
    Array.isArray(entry.messages)
  return hasRequestShape ? entry : null
}

function parseSessionEntries(raw) {
  if (typeof raw !== "string") {
    if (Array.isArray(raw)) return raw
    if (raw && typeof raw === "object") {
      for (const key of ["requests", "turns", "events", "entries", "history", "calls"]) {
        if (Array.isArray(raw[key])) return raw[key]
      }
      return [raw]
    }
    return []
  }

  const trimmed = raw.trim()
  if (!trimmed) return []

  // Try single JSON document first (object or array)
  try {
    const parsed = JSON.parse(trimmed)
    return parseSessionEntries(parsed)
  } catch {
    // Fall through to JSONL parsing
  }

  const entries = []
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim()
    if (!l) continue
    try {
      entries.push(JSON.parse(l))
    } catch {
      // Skip non-JSON log lines interleaved in runtime logs
    }
  }
  return entries
}

/**
 * Extract the system prompt / rules text and tool schemas from the last
 * request in an agent session log (JSON, JSONL, or parsed object/array).
 */
export function extractLastRequest(sessionInput) {
  const entries = parseSessionEntries(sessionInput)
  let req = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const candidate = unwrapRequestCandidate(entries[i])
    if (candidate) {
      req = candidate
      break
    }
  }
  if (!req) {
    throw new Error("no agent request found in session log")
  }

  const ruleParts = []
  if (typeof req.rules === "string" && req.rules) {
    ruleParts.push(req.rules)
  }
  const systemText = extractTextContent(req.system)
  if (systemText) ruleParts.push(systemText)

  const instructionsText = extractTextContent(req.instructions)
  if (instructionsText) ruleParts.push(instructionsText)

  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      if (!msg || typeof msg !== "object") continue
      if (msg.role === "system" || msg.role === "developer") {
        const text = extractTextContent(msg.content)
        if (text) ruleParts.push(text)
      }
    }
  }

  const rawTools = Array.isArray(req.tools)
    ? req.tools
    : Array.isArray(req.mcpTools)
      ? req.mcpTools
      : Array.isArray(req.functions)
        ? req.functions
        : req.tools?.tools || []

  return {
    rules: ruleParts.join("\n\n"),
    tools: rawTools,
  }
}

/**
 * Measure the last request of a running agent session using the exact same
 * report pipeline as static `report({ rules, tools })`.
 */
export function reportSession(sessionInput, { callsPerSession = 50, priceIn = 3, priceOut = 15 } = {}) {
  const { rules, tools } = extractLastRequest(sessionInput)
  return report({ rules, tools, callsPerSession, priceIn, priceOut })
}

/**
 * Full report: rules file + tool schemas + what a request really costs.
 */
export function report({ rules = "", tools = [], callsPerSession = 50, priceIn = 3, priceOut = 15 } = {}) {
  const file = analyseFile("rules", rules)
  const toolReport = analyseTools(tools)
  const perRequest = file.tokens + toolReport.tokens
  const sessionTokens = perRequest * callsPerSession
  return {
    rules: file,
    tools: toolReport,
    perRequestTokens: perRequest,
    callsPerSession,
    sessionTokens,
    cost: {
      inputUsd: (sessionTokens / 1e6) * priceIn,
      outputUsd: (sessionTokens / 1e6) * priceOut,
    },
    verdict: verdict(perRequest),
    advice: advice(file, toolReport, perRequest),
  }
}

function verdict(perRequest) {
  if (perRequest > 20000) return "critical — the context is larger than most small models"
  if (perRequest > 10000) return "heavy — noticeable on every request"
  if (perRequest > 4000) return "reasonable for a serious agent"
  return "lean"
}

function advice(file, tools, perRequest) {
  const out = []
  if (file.tokens > 3000) out.push("rules file is large: move stable content into a skill and load it on demand")
  if (tools.tokens > 8000) out.push("tool schemas dominate: cut optional tools per agent")
  if (file.longestSection && file.longestSection.tokens > 1200)
    out.push(`section "${file.longestSection.title}" is ${file.longestSection.tokens} tokens — split it`)
  if (perRequest > 10000) out.push("enable prompt caching: repeated prefixes are billed cheaper")
  if (!out.length) out.push("nothing to cut — this context is already lean")
  return out
}
