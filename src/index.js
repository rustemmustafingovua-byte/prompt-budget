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
    name: t.name,
    tokens: estimateTokens(JSON.stringify(t)),
  }))
  return {
    count: list.length,
    tokens: perTool.reduce((n, t) => n + t.tokens, 0),
    perTool: perTool.sort((a, b) => b.tokens - a.tokens),
  }
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
