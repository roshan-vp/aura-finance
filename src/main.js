import "./styles.css";
import { categoryTotals } from "./analytics.js";
import { categories, localBudgetKey, localTransactionsKey, paymentModes } from "./categories.js";
import {
  createTransaction,
  fetchBudget,
  fetchTransactions,
  removeTransaction,
  saveBudget
} from "./data.js";
import { getMigrationStatus, importLegacyData, readLegacyData } from "./migration.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const dateFormatter = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  transactions: [],
  budget: 50000,
  budgetMonth: "",
  mode: "expense",
  activeFilter: "month",
  customMonth: "",
  legacy: null,
  migrationStatus: null,
  busy: false,
  toastTimer: 0
};

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value) {
  return dateFormatter.format(parseLocalDate(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function showStartup(message, title = "Configuration needed") {
  $("startupTitle").textContent = title;
  $("startupMessage").textContent = message;
  $("startupView").hidden = false;
  $("loginView").hidden = true;
  $("recoveryView").hidden = true;
  $("appShell").hidden = true;
}

function showLogin(message = "") {
  state.user = null;
  state.transactions = [];
  state.budgetMonth = "";
  state.legacy = null;
  $("startupView").hidden = true;
  $("recoveryView").hidden = true;
  $("appShell").hidden = true;
  $("loginView").hidden = false;
  $("authMessage").hidden = !message;
  $("authMessage").textContent = message;
  refreshDisabledState();
}

function showRecovery(message = "") {
  $("startupView").hidden = true;
  $("loginView").hidden = true;
  $("appShell").hidden = true;
  $("recoveryView").hidden = false;
  $("recoveryMessage").hidden = !message;
  $("recoveryMessage").textContent = message;
}

function getFilterDetails() {
  const today = new Date();
  const todayKey = localDateString(today);
  let start = null;
  let end = null;
  let label = "Total";

  if (state.activeFilter === "today") {
    start = end = todayKey;
    label = "Today";
  } else if (state.activeFilter === "week") {
    const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const saturday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 6);
    start = localDateString(sunday);
    end = localDateString(saturday);
    label = "This Week";
  } else if (state.activeFilter === "month") {
    start = localDateString(new Date(today.getFullYear(), today.getMonth(), 1));
    end = localDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" })
      .format(new Date(today.getFullYear(), today.getMonth(), 1));
  } else if (state.activeFilter === "lastMonth") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    start = localDateString(first);
    end = localDateString(new Date(today.getFullYear(), today.getMonth(), 0));
    label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(first);
  } else if (state.activeFilter === "customMonth" && state.customMonth) {
    const [year, month] = state.customMonth.split("-").map(Number);
    start = localDateString(new Date(year, month - 1, 1));
    end = localDateString(new Date(year, month, 0));
    label = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" })
      .format(new Date(year, month - 1, 1));
  }
  return { start, end, label, todayKey };
}

function monthForFilter() {
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth(), 1);
  if (state.activeFilter === "customMonth" && state.customMonth) {
    const [year, monthNumber] = state.customMonth.split("-").map(Number);
    month = new Date(year, monthNumber - 1, 1);
  } else if (state.activeFilter === "lastMonth") {
    month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }
  return localDateString(month);
}

function getVisibleTransactions() {
  const { start, end } = getFilterDetails();
  if (!start || !end) return state.transactions.slice();
  return state.transactions.filter((item) => item.date >= start && item.date <= end);
}

function daysInScope(items, details) {
  const today = parseLocalDate(details.todayKey);
  if (state.activeFilter === "all") {
    if (!items.length) return 0;
    let earliest = parseLocalDate(items[0].date);
    items.forEach((item) => {
      const date = parseLocalDate(item.date);
      if (date < earliest) earliest = date;
    });
    return Math.max(1, Math.floor((today - earliest) / 86400000) + 1);
  }
  if (state.activeFilter === "today") return 1;
  if (state.activeFilter === "month") return today.getDate();
  if (state.activeFilter === "lastMonth" || state.activeFilter === "customMonth") {
    const [year, month] = state.activeFilter === "customMonth"
      ? state.customMonth.split("-").map(Number)
      : [today.getFullYear(), today.getMonth()];
    if (year === today.getFullYear() && month === today.getMonth() + 1) return today.getDate();
    return new Date(year, month, 0).getDate();
  }
  if (state.activeFilter === "week") return today.getDay() + 1;
  return 0;
}

function updateSummary(items, details) {
  const income = items.reduce((sum, item) => sum + (item.type === "income" ? Number(item.amount) : 0), 0);
  const spent = items.reduce((sum, item) => sum + (item.type === "expense" ? Number(item.amount) : 0), 0);
  const net = income - spent;
  const days = daysInScope(items, details);
  const period = details.label;
  $("incomeLabel").textContent = `${period} Income`;
  $("spentLabel").textContent = `${period} Spent`;
  $("netLabel").textContent = `${period} Net Cash Flow`;
  $("averageLabel").textContent = `${period} Daily Average Spend`;
  $("incomeTotal").textContent = currency.format(income);
  $("spentTotal").textContent = currency.format(spent);
  $("netTotal").textContent = currency.format(net);
  $("netTotal").style.color = net >= 0 ? "var(--green)" : "var(--rose)";
  $("averageSpend").textContent = currency.format(days ? spent / days : 0);
  $("averageFoot").textContent = `Based on ${days} ${days === 1 ? "day" : "days"}`;
}

function updateBudget(items, details) {
  const spent = items.reduce((sum, item) => sum + (item.type === "expense" ? Number(item.amount) : 0), 0);
  const percent = spent / state.budget * 100;
  const clampedPercent = Math.min(100, percent);
  const color = percent >= 90 ? "var(--rose)" : percent >= 75 ? "var(--amber)" : "var(--cyan)";
  $("budgetSpent").textContent = currency.format(spent);
  $("budgetTarget").textContent = currency.format(state.budget);
  $("budgetFill").style.width = `${clampedPercent}%`;
  $("budgetFill").style.background = color;
  $("budgetFill").style.color = color;
  $("budgetProgress").setAttribute("aria-valuenow", String(Math.round(clampedPercent)));
  $("budgetProgress").setAttribute("aria-valuetext", `${percent.toFixed(0)} percent of budget used`);
  $("budgetPercent").textContent = `${percent.toFixed(0)}% used`;
  const remaining = state.budget - spent;
  $("budgetRemaining").textContent = remaining >= 0
    ? `${currency.format(remaining)} remaining`
    : `${currency.format(Math.abs(remaining))} over target`;
  $("budgetRemaining").style.color = remaining < 0 ? "var(--rose)" : "";
  $("budgetPeriod").textContent = `A gentle guide for ${details.label === "Total" ? "all time" : details.label}`;
}

function updateDistribution(items) {
  const { total, rows } = categoryTotals(items);
  const bar = $("distributionBar");
  const legend = $("distributionLegend");
  const rings = $("distributionRings");
  bar.replaceChildren();
  legend.replaceChildren();
  rings.replaceChildren();
  $("distributionEmpty").hidden = total > 0;
  if (!total) {
    $("distributionTotal").replaceChildren();
    bar.setAttribute("aria-label", "No expenses in this period");
    return;
  }

  const totalLabel = document.createElement("span");
  totalLabel.textContent = "Total expenses";
  const totalAmount = document.createElement("strong");
  totalAmount.textContent = currency.format(total);
  $("distributionTotal").replaceChildren(totalLabel, totalAmount);
  bar.setAttribute("aria-label", `${currency.format(total)} expenses distributed across categories`);

  rows.forEach((row) => {
    const segment = document.createElement("div");
    segment.className = "distribution-segment";
    segment.style.width = `${row.share}%`;
    segment.style.background = row.color;
    segment.title = `${row.name}: ${currency.format(row.amount)} (${row.share.toFixed(1)}%)`;
    segment.setAttribute("aria-label", segment.title);
    bar.append(segment);

    const legendItem = document.createElement("div");
    legendItem.className = "legend-item";
    legendItem.innerHTML = `<span class="legend-dot" style="background:${row.color}"></span><span>${escapeHtml(row.name)} (${row.displayPercent}%)</span>`;
    legend.append(legendItem);

  });

  [...rows].sort((a, b) => b.amount - a.amount).forEach((row) => {
    const circumference = 2 * Math.PI * 42;
    const ring = document.createElement("article");
    ring.className = "ring-card";
    ring.setAttribute("role", "img");
    ring.setAttribute("aria-label", `${row.name}: ${currency.format(row.amount)}, ${row.displayPercent} percent of expenses`);
    ring.innerHTML = `
      <div class="ring-visual" style="--ring-color:${row.color}">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ring-track" cx="50" cy="50" r="42"></circle>
          <circle class="ring-progress" cx="50" cy="50" r="42" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - row.share / 100)}"></circle>
        </svg>
        <div class="ring-center"><span class="ring-icon">${row.icon}</span><strong class="ring-percent">${row.displayPercent}%</strong></div>
      </div>
      <div class="ring-name">${escapeHtml(row.name)}</div>
      <div class="ring-amount">${currency.format(row.amount)}</div>`;
    rings.append(ring);
  });
}

function categoryFor(type, name) {
  return categories[type].find((item) => item.name === name) || categories[type][categories[type].length - 1];
}

function updateTransactionList(items, details) {
  const query = $("search").value.trim().toLocaleLowerCase("en-IN");
  const filtered = items.filter((item) => !query ||
    [item.description, item.category, item.payment]
      .some((value) => String(value).toLocaleLowerCase("en-IN").includes(query)));
  filtered.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  $("transactionCount").textContent = `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;
  $("transactionPeriod").textContent = details.label === "Total" ? "All your recorded activity" : `${details.label} activity`;
  const list = $("transactionList");
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.innerHTML = `<strong>${query ? "No matching transactions" : "Nothing here just yet"}</strong>${query ? "Try a different search." : "Your activity will appear here once you add it."}`;
    list.append(empty);
    return;
  }

  filtered.forEach((item) => {
    const category = categoryFor(item.type, item.category);
    const row = document.createElement("div");
    row.className = "transaction-row";
    const prefix = item.type === "income" ? "+" : "−";
    row.innerHTML = `
      <div class="transaction-main">
        <div class="category-icon" style="--cat-color:${category.color}" aria-hidden="true">${category.icon}</div>
        <div class="transaction-copy">
          <div class="transaction-name" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</div>
          <div class="transaction-meta"><span>${escapeHtml(item.category)}</span><span class="separator">·</span><span>${escapeHtml(item.payment)}</span><span class="separator">·</span><span>${escapeHtml(formatDate(item.date))}</span></div>
        </div>
      </div>
      <div class="transaction-value ${item.type}">${prefix}${currency.format(Number(item.amount))}</div>
      <button type="button" class="delete-btn" aria-label="Delete ${escapeHtml(item.description)}" title="Delete transaction" data-id="${escapeHtml(item.id)}"${state.busy || !navigator.onLine ? " disabled" : ""}>×</button>`;
    list.append(row);
  });
}

function render() {
  if (!state.user) return;
  const details = getFilterDetails();
  const items = getVisibleTransactions();
  updateSummary(items, details);
  updateBudget(items, details);
  updateDistribution(items);
  updateTransactionList(items, details);
  document.querySelectorAll(".filter-btn").forEach((button) => {
    const active = button.dataset.filter === state.activeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("monthPicker").value = state.activeFilter === "customMonth" ? state.customMonth : "";
  refreshDisabledState();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-btn").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const categorySelect = $("category");
  const previous = categorySelect.value;
  categorySelect.replaceChildren(...categories[mode].map((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    return option;
  }));
  if (categories[mode].some((category) => category.name === previous)) categorySelect.value = previous;
  $("submitBtn").className = `submit-btn ${mode}`;
  $("submitBtn").textContent = `Add ${mode}`;
}

function setDataError(message) {
  $("dataErrorText").textContent = message;
  $("dataError").hidden = false;
}

function clearDataError() {
  $("dataError").hidden = true;
  $("dataErrorText").textContent = "";
}

function isExpiredSessionError(error) {
  return error?.status === 401 || error?.code === "PGRST301" ||
    error?.code === "invalid_jwt" || error?.name === "AuthSessionMissingError";
}

async function handleDataError(error) {
  console.error("AURA data operation failed.", error);
  if (isExpiredSessionError(error)) {
    await supabase.auth.signOut({ scope: "local" });
    showLogin("Your session expired. Sign in again to continue.");
    return;
  }
  setDataError(error?.message || "AURA could not complete the request. Please retry.");
}

function updateMigrationPrompt(legacy, migration) {
  state.legacy = legacy;
  state.migrationStatus = migration;
  const notice = $("migrationNotice");
  if (migration || (!legacy.transactions.length && legacy.budget === null && !legacy.invalidCount)) {
    notice.hidden = true;
    return;
  }
  const parts = [`${legacy.transactions.length} transaction${legacy.transactions.length === 1 ? "" : "s"}`];
  if (legacy.budget !== null) parts.push("your saved monthly budget");
  if (legacy.invalidCount) parts.push(`${legacy.invalidCount} invalid transaction${legacy.invalidCount === 1 ? "" : "s"}`);
  $("migrationDescription").textContent =
    `${parts.join(" and ")} found in this browser. Original local data will remain untouched. If a cloud budget already exists for the month, it will be kept.`;
  $("importData").disabled = legacy.invalidCount > 0 || !navigator.onLine || state.busy;
  $("importData").textContent = legacy.invalidCount ? "Resolve invalid local data first" : "Review & import";
  notice.hidden = false;
}

async function loadDashboard(user) {
  state.user = user;
  $("startupView").hidden = true;
  $("loginView").hidden = true;
  $("recoveryView").hidden = true;
  $("appShell").hidden = false;
  $("accountEmail").textContent = user.email || "";
  $("dataLoading").hidden = false;
  $("dashboardContent").hidden = true;
  clearDataError();
  $("migrationNotice").hidden = true;
  state.transactions = [];
  state.budgetMonth = "";
  state.budget = 50000;

  try {
    const month = monthForFilter();
    const [transactions, budget, migration] = await Promise.all([
      fetchTransactions(user.id),
      fetchBudget(user.id, month),
      getMigrationStatus(user.id)
    ]);
    state.transactions = transactions;
    state.budgetMonth = month;
    state.budget = budget ? Number(budget.amount) : 50000;
    $("todayText").textContent = formatDate(localDateString(new Date()));
    $("dataLoading").hidden = true;
    $("dashboardContent").hidden = false;
    render();
    try {
      updateMigrationPrompt(readLegacyData(), migration);
    } catch (error) {
      $("migrationDescription").textContent = error.message;
      $("importData").hidden = true;
      $("migrationNotice").hidden = false;
    }
  } catch (error) {
    $("dataLoading").hidden = true;
    $("dashboardContent").hidden = true;
    await handleDataError(error);
  }
}

async function loadBudgetForCurrentView() {
  const month = monthForFilter();
  if (month === state.budgetMonth) {
    render();
    return;
  }
  $("budgetPeriod").textContent = `Loading target for ${getFilterDetails().label}…`;
  try {
    const budget = await fetchBudget(state.user.id, month);
    state.budgetMonth = month;
    state.budget = budget ? Number(budget.amount) : 50000;
    clearDataError();
    render();
  } catch (error) {
    await handleDataError(error);
  }
}

function refreshDisabledState() {
  const offline = !navigator.onLine;
  const busy = state.busy;
  if ($("loginButton")) $("loginButton").disabled = offline || busy;
  if ($("forgotPassword")) $("forgotPassword").disabled = offline || busy;
  if ($("submitBtn")) $("submitBtn").disabled = offline || busy || !state.user;
  if ($("editBudget")) $("editBudget").disabled = offline || busy || !state.user;
  if ($("importData")) $("importData").disabled = offline || busy || Boolean(state.legacy?.invalidCount);
  document.querySelectorAll(".quick-chip").forEach((button) => {
    button.disabled = offline || busy || !state.user;
  });
  document.querySelectorAll(".delete-btn").forEach((button) => {
    button.disabled = offline || busy || !state.user;
  });
  $("connectionNotice").hidden = !offline;
  $("connectionNotice").textContent = offline
    ? "You’re offline. AURA will not save changes until the database connection returns."
    : "";
}

function showAuthError(error) {
  console.error("AURA authentication request failed.", error);
  $("authMessage").textContent = error?.message || "Sign-in failed. Check your connection and try again.";
  $("authMessage").hidden = false;
}

async function handleLogin(event) {
  event.preventDefault();
  if (!navigator.onLine || state.busy) return;
  state.busy = true;
  refreshDisabledState();
  $("loginButton").textContent = "Signing in…";
  $("authMessage").hidden = true;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value
    });
    if (error) throw error;
    $("loginPassword").value = "";
    await loadDashboard(data.user);
  } catch (error) {
    showAuthError(error);
  } finally {
    state.busy = false;
    $("loginButton").textContent = "Sign in";
    refreshDisabledState();
  }
}

async function handlePasswordReset() {
  if (!navigator.onLine || state.busy) return;
  const email = $("loginEmail").value.trim();
  if (!email) {
    $("authMessage").textContent = "Enter your account email first.";
    $("authMessage").hidden = false;
    $("loginEmail").focus();
    return;
  }
  state.busy = true;
  refreshDisabledState();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`
    });
    if (error) throw error;
    $("authMessage").textContent = "If the account exists, a password reset link has been sent.";
    $("authMessage").hidden = false;
  } catch (error) {
    showAuthError(error);
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function handlePasswordRecovery(event) {
  event.preventDefault();
  if (state.busy) return;
  state.busy = true;
  refreshDisabledState();
  $("recoveryButton").disabled = true;
  try {
    const { data, error } = await supabase.auth.updateUser({ password: $("newPassword").value });
    if (error) throw error;
    $("newPassword").value = "";
    await loadDashboard(data.user);
    showToast("Password updated.");
  } catch (error) {
    console.error("AURA password update failed.", error);
    $("recoveryMessage").textContent = error?.message || "Password could not be updated.";
    $("recoveryMessage").hidden = false;
  } finally {
    state.busy = false;
    $("recoveryButton").disabled = false;
    refreshDisabledState();
  }
}

async function handleLogout() {
  if (state.busy) return;
  state.busy = true;
  refreshDisabledState();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showLogin();
  } catch (error) {
    await handleDataError(error);
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function submitTransaction(transaction) {
  if (!state.user || !navigator.onLine || state.busy) return false;
  state.busy = true;
  refreshDisabledState();
  try {
    const saved = await createTransaction(state.user.id, transaction);
    state.transactions.push(saved);
    render();
    showToast(`${saved.type === "income" ? "Income" : "Expense"} saved.`);
    return true;
  } catch (error) {
    await handleDataError(error);
    return false;
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function handleTransactionSubmit(event) {
  event.preventDefault();
  const description = $("description").value.trim();
  const amount = Number($("amount").value);
  const date = $("date").value;
  if (!description || !Number.isFinite(amount) || amount <= 0 ||
      !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast("Add a description, valid amount, and date.");
    return;
  }
  const saved = await submitTransaction({
    type: state.mode,
    description,
    amount,
    category: $("category").value,
    payment: $("payment").value,
    date
  });
  if (saved) {
    $("description").value = "";
    $("amount").value = "";
    $("description").focus();
  }
}

async function handleDelete(event) {
  const button = event.target.closest(".delete-btn");
  if (!button || state.busy || !navigator.onLine) return;
  const transaction = state.transactions.find((item) => item.id === button.dataset.id);
  if (!transaction || !window.confirm(`Delete "${transaction.description}"? This cannot be undone.`)) return;
  state.busy = true;
  refreshDisabledState();
  try {
    await removeTransaction(state.user.id, transaction.id);
    state.transactions = state.transactions.filter((item) => item.id !== transaction.id);
    render();
    showToast("Transaction deleted.");
  } catch (error) {
    await handleDataError(error);
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function handleBudgetEdit() {
  const response = window.prompt("Set your monthly budget target (₹):", String(state.budget));
  if (response === null) return;
  const amount = Number(response.trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a budget greater than ₹0.");
    return;
  }
  if (!navigator.onLine || state.busy) return;
  state.busy = true;
  refreshDisabledState();
  try {
    const saved = await saveBudget(state.user.id, state.budgetMonth || monthForFilter(), amount);
    state.budget = Number(saved.amount);
    state.budgetMonth = saved.month;
    render();
    showToast("Monthly target updated.");
  } catch (error) {
    await handleDataError(error);
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function handleMigration() {
  const legacy = state.legacy;
  if (!legacy || legacy.invalidCount || !navigator.onLine || state.busy) return;
  const budgetLine = legacy.budget === null ? "" : `\nSaved monthly budget: ${currency.format(legacy.budget)}.`;
  const confirmed = window.confirm(
    `Import ${legacy.transactions.length} transaction${legacy.transactions.length === 1 ? "" : "s"} into your AURA account?${budgetLine}\n\nYour localStorage data will not be deleted. If a cloud budget already exists for this month, it will be kept.`
  );
  if (!confirmed) return;

  state.busy = true;
  refreshDisabledState();
  $("migrationDescription").textContent = "Importing and verifying records… Your local copy remains untouched.";
  try {
    const result = await importLegacyData(state.user.id, legacy);
    const suffix = result.budgetSkipped ? " The existing cloud budget was kept." : "";
    showToast(`${result.transactionsImported} transactions verified.${suffix}`);
    await loadDashboard(state.user);
  } catch (error) {
    console.error("AURA local data migration failed.", error);
    $("migrationDescription").textContent = `${error?.message || "Import failed."} Local data has not been deleted; you can safely retry.`;
    $("migrationNotice").hidden = false;
  } finally {
    state.busy = false;
    refreshDisabledState();
  }
}

async function handleFilterChange(filter) {
  state.activeFilter = filter;
  state.customMonth = "";
  render();
  await loadBudgetForCurrentView();
}

async function handleMonthChange(value) {
  if (!value) return;
  state.activeFilter = "customMonth";
  state.customMonth = value;
  render();
  await loadBudgetForCurrentView();
}

async function verifyStoredSession() {
  if (!isSupabaseConfigured) {
    showStartup("Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your local .env file, then restart the app.");
    return;
  }
  if (!navigator.onLine) {
    showLogin("Connect to the internet to verify your session and load financial data.");
    return;
  }
  showStartup("Checking your secure session…", "Connecting to AURA");
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      showLogin();
      return;
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    await loadDashboard(userData.user);
  } catch (error) {
    console.error("AURA could not verify the saved session.", error);
    showLogin(navigator.onLine
      ? "Your session could not be verified. Sign in again or retry when the connection is stable."
      : "Connect to the internet to verify your session and load financial data.");
  }
}

function bindEvents() {
  $("loginForm").addEventListener("submit", handleLogin);
  $("forgotPassword").addEventListener("click", handlePasswordReset);
  $("recoveryForm").addEventListener("submit", handlePasswordRecovery);
  $("logoutButton").addEventListener("click", handleLogout);
  $("transactionForm").addEventListener("submit", handleTransactionSubmit);
  $("transactionList").addEventListener("click", handleDelete);
  $("editBudget").addEventListener("click", handleBudgetEdit);
  $("importData").addEventListener("click", handleMigration);
  $("retryData").addEventListener("click", () => {
    if (state.user) loadDashboard(state.user);
  });
  $("search").addEventListener("input", render);

  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.addEventListener("click", () => handleFilterChange(button.dataset.filter));
  });
  $("monthPicker").addEventListener("change", (event) => handleMonthChange(event.target.value));
  document.querySelectorAll(".quick-chip").forEach((button) => {
    button.addEventListener("click", async () => {
      const saved = await submitTransaction({
        type: "expense",
        description: button.dataset.description,
        amount: Number(button.dataset.amount),
        category: button.dataset.category,
        payment: "UPI/GPay",
        date: localDateString(new Date())
      });
      if (saved) showToast(`${button.dataset.description} added.`);
    });
  });

  window.addEventListener("online", () => {
    refreshDisabledState();
    if ($("appShell").hidden && isSupabaseConfigured) verifyStoredSession();
  });
  window.addEventListener("offline", refreshDisabledState);
}

function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .catch((error) => {
        console.error("AURA offline shell registration failed.", error);
        showToast("Offline app shell could not be installed.");
      });
  });
}

async function start() {
  $("date").value = localDateString(new Date());
  $("todayText").textContent = formatDate(localDateString(new Date()));
  $("payment").replaceChildren(...paymentModes.map((mode) => {
    const option = document.createElement("option");
    option.textContent = mode;
    option.value = mode;
    return option;
  }));
  setMode("expense");
  bindEvents();
  refreshDisabledState();
  registerServiceWorker();

  if (!isSupabaseConfigured) {
    showStartup("Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your local .env file, then restart the app.");
    return;
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") showRecovery();
    if (event === "SIGNED_OUT") showLogin();
    if (event === "TOKEN_REFRESHED" && !session) showLogin("Your session expired. Sign in again to continue.");
  });
  await verifyStoredSession();
}

start().catch((error) => {
  console.error("AURA could not start.", error);
  showStartup(error?.message || "AURA could not start. Check the configuration and reload.");
});
