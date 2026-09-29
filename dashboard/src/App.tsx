import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Alert, type Transaction } from "./api";

const POLL_MS = 2000;
const HIGH_AMOUNT = 10000;

type RuleKey = "high_amount" | "velocity";
const RULE_LABEL: Record<string, string> = { high_amount: "Valor alto", velocity: "Velocity" };

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function time(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR");
}
function secondsAgo(from: number) {
  return Math.max(0, Math.round((Date.now() - from) / 1000));
}

/** Live polling with pause + tracking of which ids are newly arrived (for the entry animation). */
function useLivePoll(paused: boolean) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [tx, al] = await Promise.all([api.transactions(), api.alerts()]);
      const fresh = new Set<string>();
      for (const item of [...tx, ...al]) {
        if (primed.current && !seen.current.has(item.id)) fresh.add(item.id);
        seen.current.add(item.id);
      }
      primed.current = true;
      setTransactions(tx);
      setAlerts(al);
      setNewIds(fresh);
      setOnline(true);
      setUpdatedAt(Date.now());
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (paused) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, paused]);

  return { transactions, alerts, online, updatedAt, newIds, refresh };
}

function StatTiles({ transactions, alerts }: { transactions: Transaction[]; alerts: Alert[] }) {
  const volume = transactions.reduce((sum, t) => sum + t.amount, 0);
  const rate = transactions.length ? Math.round((alerts.length / transactions.length) * 100) : 0;
  return (
    <div className="tiles">
      <div className="tile blue">
        <span className="accent" />
        <div className="label">Transações</div>
        <div className="value">{transactions.length}</div>
        <div className="sub">recentes</div>
      </div>
      <div className="tile crit">
        <span className="accent" />
        <div className="label">Alertas</div>
        <div className="value">{alerts.length}</div>
        <div className="sub">de fraude</div>
      </div>
      <div className="tile good">
        <span className="accent" />
        <div className="label">Volume</div>
        <div className="value">{money(volume)}</div>
        <div className="sub">soma das transações</div>
      </div>
      <div className="tile warn">
        <span className="accent" />
        <div className="label">Taxa de alerta</div>
        <div className="value">{rate}%</div>
        <div className="sub">alertas / transações</div>
      </div>
    </div>
  );
}

function RuleChart({ alerts }: { alerts: Alert[] }) {
  const rules: RuleKey[] = ["high_amount", "velocity"];
  const counts = rules.map((r) => ({ rule: r, n: alerts.filter((a) => a.rule === r).length }));
  const max = Math.max(1, ...counts.map((c) => c.n));
  const total = alerts.length || 1;
  return (
    <div className="panel chart">
      <h2>Alertas por regra</h2>
      {alerts.length === 0 ? (
        <p className="empty">Nenhum alerta ainda — dispare uma transação suspeita abaixo.</p>
      ) : (
        counts.map((c) => (
          <div className="bar-row" key={c.rule}>
            <span className="bar-label"><span className={`tag ${c.rule}`}>{RULE_LABEL[c.rule]}</span></span>
            <div className="bar-track" title={`${c.n} alerta(s) · ${Math.round((c.n / total) * 100)}%`}>
              <div className={`bar-fill ${c.rule}`} style={{ width: `${(c.n / max) * 100}%` }} />
            </div>
            <span className="bar-val">{c.n}</span>
          </div>
        ))
      )}
    </div>
  );
}

function Controls({ onFire }: { onFire: () => void }) {
  const [accountId, setAccountId] = useState("acc-1");
  const [amount, setAmount] = useState("150");
  const [busy, setBusy] = useState(false);

  const fire = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onFire();
    } catch (err) {
      console.error("Falha ao enviar transação:", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const burst = async () => {
    for (let i = 0; i < 5; i++) await api.createTransaction("acc-burst", 50);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void fire(() => api.createTransaction(accountId.trim() || "acc-1", Number(amount) || 0));
  };

  return (
    <div className="controls">
      <div className="grp">
        <button className="btn" disabled={busy} onClick={() => void fire(() => api.createTransaction("acc-1", 150))}>
          Transação normal
        </button>
        <button className="btn crit" disabled={busy} onClick={() => void fire(() => api.createTransaction("acc-1", 25000))}>
          ⚠ Valor alto (R$ 25.000)
        </button>
        <button className="btn warn" disabled={busy} onClick={() => void fire(burst)}>
          ⚡ Rajada 5× (velocity)
        </button>
      </div>
      <form className="grp" onSubmit={submit}>
        <input className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="conta" />
        <input className="field" value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="valor" />
        <button className="btn primary" disabled={busy}>{busy ? "…" : "Enviar"}</button>
      </form>
    </div>
  );
}

function AlertsPanel({ alerts, newIds }: { alerts: Alert[]; newIds: Set<string> }) {
  const [filter, setFilter] = useState<"all" | RuleKey>("all");
  const shown = filter === "all" ? alerts : alerts.filter((a) => a.rule === filter);
  return (
    <section className="panel">
      <h2>
        Alertas <span className="count">{shown.length}</span>
        <div className="chips">
          {(["all", "high_amount", "velocity"] as const).map((f) => (
            <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "Todos" : RULE_LABEL[f]}
            </button>
          ))}
        </div>
      </h2>
      <div className="list">
        {shown.length === 0 && <p className="empty">Sem alertas.</p>}
        {shown.map((a) => (
          <div className={`card alert ${a.rule} ${newIds.has(a.id) ? "is-new" : ""}`} key={a.id}>
            <div className="row">
              <span className={`tag ${a.rule}`}>{RULE_LABEL[a.rule] ?? a.rule}</span>
              <span className="when">{time(a.createdAt)}</span>
            </div>
            <div className="reason">{a.reason}</div>
            <div className="meta">conta {a.accountId} · {money(a.amount)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TxPanel({ transactions, newIds }: { transactions: Transaction[]; newIds: Set<string> }) {
  return (
    <section className="panel">
      <h2>Transações <span className="count">{transactions.length}</span></h2>
      <div className="list">
        {transactions.length === 0 && <p className="empty">Sem transações.</p>}
        {transactions.map((t) => (
          <div className={`card ${t.amount >= HIGH_AMOUNT ? "big" : ""} ${newIds.has(t.id) ? "is-new" : ""}`} key={t.id}>
            <div className="row">
              <span className="amount">{money(t.amount)}</span>
              <span className="when">{time(t.createdAt)}</span>
            </div>
            <div className="meta">conta {t.accountId} · {t.currency}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [paused, setPaused] = useState(false);
  const { transactions, alerts, online, updatedAt, newIds, refresh } = useLivePoll(paused);
  const [, forceTick] = useState(0);

  // keep the "atualizado há Xs" label ticking
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="logo">🛡️</span>
          <h1>Argus</h1>
          <span className="tag-name">fraud monitor</span>
        </div>
        <div className="spacer" />
        <span className="status-dot">
          <span className={`dot ${online ? "ok" : "off"}`} />
          {online ? `atualizado há ${secondsAgo(updatedAt)}s` : "API offline"}
        </span>
        <button className="icon-btn" onClick={() => setPaused((p) => !p)}>
          {paused ? "▶ Retomar" : "⏸ Pausar"}
        </button>
        <button className="icon-btn" onClick={() => void refresh()}>↻ Atualizar</button>
      </div>

      <StatTiles transactions={transactions} alerts={alerts} />
      <RuleChart alerts={alerts} />
      <Controls onFire={refresh} />

      <div className="grid">
        <AlertsPanel alerts={alerts} newIds={newIds} />
        <TxPanel transactions={transactions} newIds={newIds} />
      </div>
    </div>
  );
}
