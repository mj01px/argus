import { useCallback, useEffect, useState } from "react";
import { api, type Alert, type Transaction } from "./api";

const POLL_MS = 2000;

function useLivePoll() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [tx, al] = await Promise.all([api.transactions(), api.alerts()]);
      setTransactions(tx);
      setAlerts(al);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { transactions, alerts, online, refresh };
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR");
}

function TransactionForm({ onDone }: { onDone: () => void }) {
  const [accountId, setAccountId] = useState("acc-1");
  const [amount, setAmount] = useState("150");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.createTransaction(accountId.trim(), Number(amount));
      onDone();
    } catch (err) {
      alert(`Falha: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="conta" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="valor" />
      <button disabled={busy}>{busy ? "..." : "Enviar transação"}</button>
      <span className="hint">≥ 10.000 dispara high_amount · 5x em 60s dispara velocity</span>
    </form>
  );
}

export function App() {
  const { transactions, alerts, online, refresh } = useLivePoll();

  return (
    <div className="app">
      <header>
        <h1>🛡️ Sentinel</h1>
        <span className={online ? "badge ok" : "badge off"}>{online ? "conectado" : "API offline"}</span>
      </header>

      <TransactionForm onDone={refresh} />

      <div className="grid">
        <section>
          <h2>Alertas <small>{alerts.length}</small></h2>
          {alerts.length === 0 && <p className="empty">Sem alertas ainda.</p>}
          {alerts.map((a) => (
            <div className="card alert" key={a.id}>
              <div className="row">
                <span className={`tag ${a.rule}`}>{a.rule}</span>
                <span className="when">{time(a.createdAt)}</span>
              </div>
              <div className="reason">{a.reason}</div>
              <div className="meta">conta {a.accountId} · {money(a.amount)}</div>
            </div>
          ))}
        </section>

        <section>
          <h2>Transações <small>{transactions.length}</small></h2>
          {transactions.length === 0 && <p className="empty">Sem transações ainda.</p>}
          {transactions.map((t) => (
            <div className="card" key={t.id}>
              <div className="row">
                <strong>{money(t.amount)}</strong>
                <span className="when">{time(t.createdAt)}</span>
              </div>
              <div className="meta">conta {t.accountId} · {t.currency}</div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
