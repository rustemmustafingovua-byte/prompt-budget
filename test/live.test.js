// Integration test against the real service. Skipped unless LIVE=1.
//   LIVE=1 npm test
import { test } from "node:test"
import assert from "node:assert/strict"

const LIVE = process.env.LIVE === "1"
const skip = LIVE ? false : "set LIVE=1 to run the integration test"

import { report } from "../src/index.js"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

test("measures a real rules file", { skip }, () => {
  let rules
  try {
    rules = readFileSync(join(homedir(), ".config", "opencode", "AGENTS.md"), "utf8")
  } catch {
    return
  }
  const r = report({ rules })
  assert.ok(r.rules.tokens > 0)
  assert.ok(r.perRequestTokens >= r.rules.tokens)
})
