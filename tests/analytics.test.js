import test from "node:test";
import assert from "node:assert/strict";
import { categoryTotals } from "../src/analytics.js";

test("category totals ignore income and normalize displayed shares to 100 percent", () => {
  const { total, rows } = categoryTotals([
    { type: "expense", category: "Food & Dining", amount: 1 },
    { type: "expense", category: "Shopping", amount: 1 },
    { type: "income", category: "Salary", amount: 500 },
  ]);

  assert.equal(total, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.displayPercent, 0), 100);
});

test("unrecognized expense categories are included in General", () => {
  const { total, rows } = categoryTotals([
    { type: "expense", category: "Unknown", amount: 250 },
  ]);

  assert.equal(total, 250);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "General");
  assert.equal(rows[0].amount, 250);
});

test("empty expense periods return no distribution rows", () => {
  assert.deepEqual(categoryTotals([{ type: "income", amount: 100 }]), { total: 0, rows: [] });
});
