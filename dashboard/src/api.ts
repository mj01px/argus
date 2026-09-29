const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export interface Transaction {
  id: string;
  accountId: string;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  transactionId: string;
  accountId: string;
  rule: string;
  reason: string;
  amount: number;
  createdAt: string;
}

export interface Account {
  accountId: string;
  txCount: number;
  volume: number;
  lastActivity: string;
  alertCount: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const scope = (account: string | null) => (account ? `&account=${encodeURIComponent(account)}` : "");

export const api = {
  transactions: (limit = 50, account: string | null = null) =>
    getJson<Transaction[]>(`/transactions?limit=${limit}${scope(account)}`),
  alerts: (limit = 50, account: string | null = null) =>
    getJson<Alert[]>(`/alerts?limit=${limit}${scope(account)}`),
  accounts: () => getJson<Account[]>("/accounts"),
  createTransaction: async (accountId: string, amount: number) => {
    const res = await fetch(`${API_URL}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, amount }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
};
