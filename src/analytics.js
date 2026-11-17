import { categories } from "./categories.js";

export function categoryTotals(items) {
  const totals = new Map(categories.expense.map((category) => [category.name, 0]));
  items.filter((item) => item.type === "expense").forEach((item) => {
    const name = totals.has(item.category) ? item.category : "General";
    totals.set(name, (totals.get(name) || 0) + Number(item.amount));
  });
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  if (!total) return { total: 0, rows: [] };

  const rows = categories.expense
    .map((category) => ({ ...category, amount: totals.get(category.name) || 0 }))
    .filter((category) => category.amount > 0);
  let assigned = 0;
  rows.forEach((row) => {
    row.share = row.amount / total * 100;
    row.displayPercent = Math.floor(row.share);
    row.remainder = row.share - row.displayPercent;
    assigned += row.displayPercent;
  });
  [...rows].sort((a, b) => b.remainder - a.remainder)
    .slice(0, 100 - assigned)
    .forEach((row) => { row.displayPercent += 1; });
  return { total, rows };
}
