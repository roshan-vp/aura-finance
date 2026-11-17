import { localBudgetKey, localTransactionsKey, migrationKey } from "./categories.js";
import { supabase } from "./supabase.js";

function isLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function readLegacyData() {
  let savedTransactions = [];
  let savedBudget = null;
  try {
    const rawTransactions = localStorage.getItem(localTransactionsKey);
    if (rawTransactions !== null) {
      const parsed = JSON.parse(rawTransactions);
      if (!Array.isArray(parsed)) throw new Error("Saved transactions are not in the expected list format.");
      const idCounts = new Map();
      savedTransactions = parsed.map((item, index) => {
        if (!item || typeof item !== "object" ||
            typeof item.description !== "string" || !item.description.trim() ||
            !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0 ||
            !["income", "expense"].includes(item.type) ||
            typeof item.category !== "string" || !item.category.trim() ||
            typeof item.payment !== "string" || !item.payment.trim() ||
            !isLocalDate(item.date)) return { invalid: true };
        const baseId = typeof item.id === "string" && item.id ? item.id : `row-${index}`;
        const seen = idCounts.get(baseId) || 0;
        idCounts.set(baseId, seen + 1);
        return {
          legacy_id: `localstorage-v1:${baseId}${seen ? `:${seen}` : ""}`,
          description: item.description.trim(),
          amount: Number(item.amount),
          type: item.type,
          category: item.category,
          payment: item.payment,
          date: item.date
        };
      });
    }
    const rawBudget = localStorage.getItem(localBudgetKey);
    if (rawBudget !== null) {
      const amount = Number(rawBudget);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("The saved budget is invalid; local data was left untouched.");
      savedBudget = amount;
    }
  } catch (error) {
    throw new Error(`Could not read the saved local data: ${error.message}`);
  }

  const invalidCount = savedTransactions.filter((item) => item.invalid).length;
  return {
    transactions: savedTransactions.filter((item) => !item.invalid),
    invalidCount,
    budget: savedBudget
  };
}

export async function getMigrationStatus(userId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("user_migrations")
    .select("migration_key,imported_transactions,budget_imported,completed_at")
    .eq("user_id", userId)
    .eq("migration_key", migrationKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureBudget(userId, month, amount) {
  const { data: existing, error: readError } = await supabase
    .from("monthly_budgets")
    .select("amount")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return { imported: Number(existing.amount) === amount, verified: true };

  const { error: insertError } = await supabase
    .from("monthly_budgets")
    .insert({ user_id: userId, month, amount });
  if (insertError && insertError.code !== "23505") throw insertError;

  const { data: verified, error: verifyError } = await supabase
    .from("monthly_budgets")
    .select("amount")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (verifyError) throw verifyError;
  if (!verified) throw new Error("The monthly budget could not be verified after import.");
  return { imported: Number(verified.amount) === amount, verified: true };
}

export async function importLegacyData(userId, legacy) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (legacy.invalidCount) {
    throw new Error(`${legacy.invalidCount} local transaction${legacy.invalidCount === 1 ? "" : "s"} could not be validated. No migration marker was written; your original data is unchanged.`);
  }

  const transactionIds = legacy.transactions.map((transaction) => transaction.legacy_id);
  for (let offset = 0; offset < legacy.transactions.length; offset += 100) {
    const batch = legacy.transactions.slice(offset, offset + 100)
      .map((transaction) => ({ ...transaction, user_id: userId }));
    const { error } = await supabase
      .from("transactions")
      .upsert(batch, { onConflict: "user_id,legacy_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  for (let offset = 0; offset < transactionIds.length; offset += 100) {
    const ids = transactionIds.slice(offset, offset + 100);
    const { data, error } = await supabase
      .from("transactions")
      .select("legacy_id")
      .eq("user_id", userId)
      .in("legacy_id", ids);
    if (error) throw error;
    if (new Set(data.map((row) => row.legacy_id)).size !== ids.length) {
      throw new Error("Some imported transactions could not be verified. Your local copy remains available; retrying will not duplicate verified rows.");
    }
  }

  let budgetImported = false;
  if (legacy.budget !== null) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const result = await ensureBudget(userId, month, legacy.budget);
    budgetImported = result.imported;
  }

  const { error: markerError } = await supabase.from("user_migrations").insert({
    user_id: userId,
    migration_key: migrationKey,
    imported_transactions: transactionIds.length,
    budget_imported: budgetImported
  });
  if (markerError && markerError.code !== "23505") throw markerError;
  const marker = await getMigrationStatus(userId);
  if (!marker) throw new Error("The migration completed but its verification record could not be found.");

  return {
    transactionsImported: transactionIds.length,
    budgetImported,
    budgetSkipped: legacy.budget !== null && !budgetImported
  };
}
