export const categories = {
  expense: [
    { name: "Food & Dining", color: "#fb7185", icon: "◒" },
    { name: "Groceries", color: "#34d399", icon: "◈" },
    { name: "Shopping", color: "#c084fc", icon: "◇" },
    { name: "Bills & Utilities", color: "#fbbf24", icon: "⌁" },
    { name: "Travel & Transport", color: "#38bdf8", icon: "↗" },
    { name: "Entertainment", color: "#818cf8", icon: "✦" },
    { name: "General", color: "#94a3b8", icon: "•" }
  ],
  income: [
    { name: "Salary", color: "#34d399", icon: "↗" },
    { name: "Freelance", color: "#38bdf8", icon: "✳" },
    { name: "Investment/Returns", color: "#818cf8", icon: "◈" },
    { name: "Other Income", color: "#fbbf24", icon: "＋" }
  ]
};

export const paymentModes = ["UPI/GPay", "Credit Card", "Debit Card", "Net Banking", "Cash"];
export const localTransactionsKey = "aura.transactions.v1";
export const localBudgetKey = "aura.monthlyBudget.v1";
export const migrationKey = "aura-localstorage-v1";
