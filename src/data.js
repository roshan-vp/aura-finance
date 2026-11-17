import { supabase } from "./supabase.js";

const transactionColumns = "id,user_id,description,amount,type,category,payment,date,created_at";
const pageSize = 500;

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function fetchTransactions(userId) {
  const client = requireClient();
  const transactions = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from("transactions")
      .select(transactionColumns)
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    transactions.push(...data);
    if (data.length < pageSize) return transactions;
  }
}

export async function fetchBudget(userId, month) {
  const client = requireClient();
  const { data, error } = await client
    .from("monthly_budgets")
    .select("id,user_id,month,amount")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTransaction(userId, transaction) {
  const client = requireClient();
  const { data, error } = await client
    .from("transactions")
    .insert({ ...transaction, user_id: userId })
    .select(transactionColumns)
    .single();
  if (error) throw error;
  return data;
}

export async function removeTransaction(userId, transactionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("transactions")
    .delete()
    .eq("user_id", userId)
    .eq("id", transactionId)
    .select("id");
  if (error) throw error;
  if (!data.length) throw new Error("The transaction was not found or is no longer available.");
}

export async function saveBudget(userId, month, amount) {
  const client = requireClient();
  const { data, error } = await client
    .from("monthly_budgets")
    .upsert({ user_id: userId, month, amount }, { onConflict: "user_id,month" })
    .select("id,user_id,month,amount")
    .single();
  if (error) throw error;
  return data;
}
