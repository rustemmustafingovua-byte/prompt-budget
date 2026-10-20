import { test } from "node:test"
import assert from "node:assert/strict"
import { estimateTokens, sections, analyseFile, analyseTools, report } from "../src/index.js"

test("token estimation scales with content", () => {
  assert.equal(estimateTokens(""), 0)
  assert.ok(estimateTokens("word ".repeat(100)) > 50)
})

test("splits a rules file into sections", () => {
  const s = sections("# One\nbody\n## Two\nmore")
  assert.equal(s.length, 2)
  assert.equal(s[1].title, "Two")
})

test("finds the most expensive section", () => {
  const f = analyseFile("rules", "# Small\nx\n# Big\n" + "y ".repeat(500))
  assert.equal(f.longestSection.title, "Big")
})

test("counts tool schema tokens", () => {
  const t = analyseTools([{ name: "a", description: "x".repeat(200) }])
  assert.equal(t.count, 1)
  assert.ok(t.tokens > 40)
})

test("produces a verdict and advice", () => {
  const r = report({ rules: "# A\n" + "z ".repeat(4000), tools: [{ name: "t" }] })
  assert.ok(r.perRequestTokens > 1000)
  assert.ok(r.advice.length > 0)
  assert.ok(r.cost.inputUsd > 0)
})
