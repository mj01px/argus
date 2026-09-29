import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Account, type Alert, type Transaction } from "./api";

const POLL_MS = 2000;

type RuleKey = "high_amount" | "velocity";
interface RuleDef { label: string; desc: string; color: string; tint: string; severity: string; }
const RULES: Record<RuleKey, RuleDef> = {
  high_amount: { label: "Valor alto", desc: "acima do limite", color: "#F0616D", tint: "rgba(240,97,109,.12)", severity: "Crítico" },
  velocity: { label: "Velocity", desc: "frequência em 60s", color: "#E8A93A", tint: "rgba(232,169,58,.12)", severity: "Atenção" },
};
const RULE_KEYS: RuleKey[] = ["high_amount", "velocity"];

type Mode = "normal" | "high" | "burst";
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "normal", label: "Transação normal", hint: "Uma transação com a conta e o valor informados." },
  { id: "high", label: "Valor alto", hint: "Valor fixo de R$ 25.000 — dispara a regra Valor alto." },
  { id: "burst", label: "Rajada 5×", hint: "5 transações em sequência na mesma conta — dispara Velocity." },
];

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour12: false });
function parseAmount(s: string): number {
  const t = s.trim().replace(/\s/g, "");
  const v = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isFinite(v) ? v : NaN;
}

/* ---------------- icons ---------------- */
const Logo = () => (
  <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="argusG" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#8B5CF6" /><stop offset="1" stopColor="#4C8DFF" />
      </linearGradient>
    </defs>
    <path d="M12 2.4l7.6 3.2v5.4c0 4.9-3.2 9-7.6 10.8C7.6 20 4.4 15.9 4.4 11V5.6L12 2.4z" fill="url(#argusG)" />
    <ellipse cx="12" cy="11" rx="4.5" ry="3" fill="none" stroke="#fff" strokeWidth="1.3" />
    <circle cx="12" cy="11" r="1.55" fill="#fff" />
  </svg>
);
const IconPause = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>;
const IconPlay = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>;
const IconRefresh = ({ spin }: { spin: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: spin ? "argusSpin .8s linear infinite" : undefined }}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v4.5h-4.5" />
  </svg>
);
const IconCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3FBF7F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const IconTriangle = ({ size = 13 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#F0616D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17.2v.1" /></svg>;
const IconBolt = ({ size = 13 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#E8A93A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" /></svg>;

/* ---------------- pagination ---------------- */
const PER_PAGE = 10;
function usePaged<T>(items: T[]) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  useEffect(() => { if (page !== current) setPage(current); }, [page, current]);
  const start = current * PER_PAGE;
  return { page: current, setPage, pageCount, total: items.length, pageItems: items.slice(start, start + PER_PAGE) };
}

function Pager({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  const from = page * PER_PAGE + 1;
  const to = Math.min(total, (page + 1) * PER_PAGE);
  return (
    <div className="pager">
      <span className="pg-range">{from}–{to} de {total}</span>
      <div className="pg-nav">
        <button className="pg-btn" disabled={page === 0} onClick={() => onPage(page - 1)}>‹ Anterior</button>
        <span className="pg-info tnum">{page + 1} / {pageCount}</span>
        <button className="pg-btn" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>Próxima ›</button>
      </div>
    </div>
  );
}

/* ---------------- live data hook ---------------- */
interface Snap { txns: Transaction[]; alerts: Alert[]; accounts: Account[]; at: number | null; }
const EMPTY: Snap = { txns: [], alerts: [], accounts: [], at: null };

function useLive(paused: boolean, account: string | null) {
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState(0);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const latest = useRef<Snap | null>(null);
  const shown = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const fetchData = useCallback(async (): Promise<Snap> => {
    const [txns, alerts, accounts] = await Promise.all([
      api.transactions(50, account),
      api.alerts(50, account),
      api.accounts(),
    ]);
    return { txns, alerts, accounts, at: Date.now() };
  }, [account]);

  const apply = useCallback((s: Snap) => {
    const fresh = new Set<string>();
    const next = new Set<string>();
    for (const it of [...s.txns, ...s.alerts]) {
      next.add(it.id);
      if (primed.current && !shown.current.has(it.id)) fresh.add(it.id);
    }
    primed.current = true;
    shown.current = next;
    latest.current = s;
    setNewIds(fresh);
    setSnap(s);
    setPending(0);
  }, []);

  const poll = useCallback(async () => {
    try {
      const s = await fetchData();
      latest.current = s;
      setOnline(true);
      if (pausedRef.current) {
        setPending(s.txns.filter((t) => !shown.current.has(t.id)).length);
      } else {
        apply(s);
      }
    } catch {
      setOnline(false);
    }
  }, [fetchData, apply]);

  const reload = useCallback(async (): Promise<Snap> => {
    try {
      const s = await fetchData();
      apply(s);
      setOnline(true);
      return s;
    } catch {
      setOnline(false);
      return snap;
    }
  }, [fetchData, apply, snap]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setTimeout(() => setRefreshing(false), 300);
  }, [reload]);

  // initial load + reload whenever the account scope changes
  useEffect(() => {
    let alive = true;
    setLoading(true);
    primed.current = false;
    shown.current = new Set();
    (async () => {
      try { const s = await fetchData(); if (alive) apply(s); }
      catch { if (alive) setOnline(false); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [fetchData, apply]);

  // poll + clock
  useEffect(() => {
    const p = setInterval(poll, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(p); clearInterval(c); };
  }, [poll]);

  // resume → apply buffered snapshot
  useEffect(() => {
    if (!paused && latest.current) apply(latest.current);
  }, [paused, apply]);

  return { snap, loading, refreshing, online, now, pending, newIds, refresh, reload };
}

/* ---------------- header ---------------- */
function Header({ live, paused, refreshing, updatedText, updatedTitle, pending, onToggle, onRefresh }: {
  live: boolean; paused: boolean; refreshing: boolean; updatedText: string; updatedTitle: string;
  pending: number; onToggle: () => void; onRefresh: () => void;
}) {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <div className="brand">
          <Logo />
          <span className="name">Argus</span>
          <span className="sep">/</span>
          <span className="sub">Fraud Monitor</span>
        </div>
        <div className="hdr-right">
          <div className="live" title={updatedTitle}>
            <span className={`dot ${live ? "on" : "off"}`} />
            <span className="lbl" style={{ color: live ? "#3FBF7F" : "#9297A3" }}>{paused ? "Pausado" : "Ao vivo"}</span>
            <span className="sep" style={{ color: "#3A3E48" }}>·</span>
            <span className="tnum" style={{ whiteSpace: "nowrap" }}>{updatedText}</span>
          </div>
          {paused && pending > 0 && <span className="pending">{pending === 1 ? "1 nova" : `${pending} novas`}</span>}
          <button className="hbtn pad" onClick={onToggle} aria-pressed={paused} title={paused ? "Retomar atualização automática" : "Pausar atualização automática"}>
            {paused ? <IconPlay /> : <IconPause />}<span>{paused ? "Retomar" : "Pausar"}</span>
          </button>
          <button className="hbtn sq" onClick={onRefresh} disabled={refreshing} title="Atualizar agora" aria-label="Atualizar agora">
            <IconRefresh spin={refreshing} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- tiles ---------------- */
function Tiles({ snap, loading }: { snap: Snap; loading: boolean }) {
  const vol = snap.txns.reduce((s, t) => s + t.amount, 0);
  const accs = new Set(snap.alerts.map((a) => a.accountId)).size;
  const rate = snap.txns.length ? Math.round((snap.alerts.length / snap.txns.length) * 100) + "%" : "0%";
  const dash = (v: string | number) => (loading ? "—" : v);
  const tiles = [
    { k: "Transações", v: dash(snap.txns.length), s: "recentes · até 50" },
    { k: "Alertas de fraude", v: dash(snap.alerts.length), s: loading || !snap.alerts.length ? "de fraude" : `de fraude · ${accs} ${accs === 1 ? "conta" : "contas"}` },
    { k: "Volume monitorado", v: dash(brl(vol)), s: "soma das transações" },
    { k: "Taxa de alerta", v: dash(rate), s: "alertas / transações" },
  ];
  return (
    <section className="tiles" aria-label="Indicadores">
      {tiles.map((t) => (
        <div className="tile" key={t.k}>
          <span className="k">{t.k}</span>
          <span className="v">{t.v}</span>
          <span className="s">{t.s}</span>
        </div>
      ))}
    </section>
  );
}

/* ---------------- rules ---------------- */
function RulesPanel({ snap, loading }: { snap: Snap; loading: boolean }) {
  const total = snap.alerts.length;
  const rows = RULE_KEYS
    .map((k) => ({ k, ...RULES[k], n: snap.alerts.filter((a) => a.rule === k).length }))
    .sort((a, b) => b.n - a.n);
  return (
    <section className="panel pad rules" aria-label="Alertas por regra">
      <div className="panel-h">
        <h2>Alertas por regra</h2>
        <span className="aside tnum">{loading ? "" : `${total} ${total === 1 ? "alerta" : "alertas"}`}</span>
      </div>
      <div className="list">
        {rows.map((r) => {
          const pct = !total ? 0 : Math.round((r.n / total) * 100);
          return (
            <div className="rule" key={r.k}>
              <div className="top">
                <span className="lhs">
                  <span className="sq" style={{ background: r.color }} />
                  <span>{r.label}</span>
                  <span className="desc">{r.desc}</span>
                </span>
                <span className="rhs">
                  <span className="cnt">{loading ? "—" : r.n}</span>
                  <span className="pct">{loading ? "0%" : pct + "%"}</span>
                </span>
              </div>
              <div className="track"><div className="fill" style={{ width: loading ? "0%" : pct + "%", background: r.color }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- simulate ---------------- */
function SimulatePanel({ reload, snapAlerts, scopeAccount }: { reload: () => Promise<Snap>; snapAlerts: number; scopeAccount: string | null }) {
  const [mode, setMode] = useState<Mode>("normal");
  const [account, setAccount] = useState("acc-1");
  const [amount, setAmount] = useState("150");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; warn?: boolean; text: string } | null>(null);

  // When a specific account is selected in the bar, target it in the simulator.
  useEffect(() => { if (scopeAccount) setAccount(scopeAccount); }, [scopeAccount]);

  const send = async () => {
    if (sending) return;
    const acc = account.trim();
    if (!acc) return setResult({ ok: false, text: "Informe o identificador da conta" });
    const v = mode === "high" ? 25000 : parseAmount(amount);
    if (!(v > 0)) return setResult({ ok: false, text: "Informe um valor maior que zero" });
    setSending(true); setResult(null);
    const before = snapAlerts;
    const count = mode === "burst" ? 5 : 1;
    const tx = count === 1 ? "1 transação enviada" : `${count} transações enviadas`;
    try {
      for (let i = 0; i < count; i++) await api.createTransaction(acc, v);
      await reload();
      setResult({ ok: true, text: `${tx} · avaliando regras…` });
      setSending(false);
      // Alerts are eventual: the API returns immediately, then the Fraud Worker
      // consumes the Kafka event and writes the alert a beat later. Poll briefly
      // for the delta so the result reflects the real event-driven flow.
      void (async () => {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 700));
          const s = await reload();
          const delta = s.alerts.length - before;
          if (delta > 0) {
            const al = delta === 1 ? "1 alerta gerado" : `${delta} alertas gerados`;
            setResult({ ok: true, warn: true, text: `${tx} · ${al}` });
            return;
          }
        }
        setResult({ ok: true, text: `${tx} · nenhum alerta` });
      })();
    } catch (e) {
      setResult({ ok: false, text: `Falha: ${(e as Error).message}` });
      setSending(false);
    }
  };

  const resultColor = !result ? "#9297A3" : !result.ok ? "#F0616D" : result.warn ? "#E8A93A" : "#3FBF7F";
  const hint = MODES.find((m) => m.id === mode)!.hint;

  return (
    <section className="panel pad sim" aria-label="Simular transação">
      <div className="panel-h">
        <h2>Simular transação</h2>
        <span className="aside">envia ao pipeline de regras</span>
      </div>
      <div className="seg" role="radiogroup" aria-label="Tipo de simulação">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => { setMode(m.id); setResult(null); }}>
            {m.id === "normal" && <IconCheck />}{m.id === "high" && <IconTriangle />}{m.id === "burst" && <IconBolt />}
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="sim-fields">
        <label className="field">
          Conta
          <input value={account} onChange={(e) => setAccount(e.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          {mode === "burst" ? "Valor por transação" : "Valor"}
          <span className="prefixed">
            <span>R$</span>
            <input
              value={mode === "high" ? "25.000,00" : amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={mode === "high"}
              inputMode="decimal"
            />
          </span>
        </label>
        <button className="send" onClick={send} disabled={sending}>
          {sending && <span className="spinner" />}
          <span>{sending ? "Enviando…" : mode === "burst" ? "Enviar rajada" : "Enviar transação"}</span>
        </button>
      </div>
      <div className="sim-foot">
        <span className="hint">{hint}</span>
        {result && (
          <span className="result" role="status" style={{ color: resultColor }}>
            <span className="d" style={{ background: resultColor }} />{result.text}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- alerts ---------------- */
function AlertsPanel({ snap, loading, newIds }: { snap: Snap; loading: boolean; newIds: Set<string> }) {
  const [filter, setFilter] = useState<"all" | RuleKey>("all");
  const cnt = { high_amount: snap.alerts.filter((a) => a.rule === "high_amount").length, velocity: snap.alerts.filter((a) => a.rule === "velocity").length };
  const shown = filter === "all" ? snap.alerts : snap.alerts.filter((a) => a.rule === filter);
  const { page, setPage, pageCount, total, pageItems } = usePaged(shown);
  useEffect(() => { setPage(0); }, [filter, setPage]);
  const filters: { id: "all" | RuleKey; label: string; count: number }[] = [
    { id: "all", label: "Todos", count: snap.alerts.length },
    { id: "high_amount", label: "Valor alto", count: cnt.high_amount },
    { id: "velocity", label: "Velocity", count: cnt.velocity },
  ];
  return (
    <section className="panel lp alerts" aria-label="Alertas">
      <div className="lp-h">
        <div className="title"><h2>Alertas</h2><span className="badge">{loading ? "—" : snap.alerts.length}</span></div>
        <div className="tabs" role="tablist" aria-label="Filtrar alertas">
          {filters.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
              <span>{f.label}</span><span className="c">{loading ? "" : f.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="scroll">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <div className="sk-row" key={i}>
              <div className="sk-ic" />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                <div className="sk-line" style={{ width: "55%" }} /><div className="sk-line sm" style={{ width: "32%" }} />
              </div>
            </div>
          ))
        ) : shown.length === 0 ? (
          <div className="empty">
            <span className="t">{snap.alerts.length === 0 ? "Nenhum alerta" : `Nenhum alerta de ${RULES[filter as RuleKey]?.label ?? ""}`}</span>
            <span className="d">{snap.alerts.length === 0 ? "Simule uma transação de risco para testar as regras." : "Altere o filtro para ver outras regras."}</span>
          </div>
        ) : (
          pageItems.map((a) => {
            const r = RULES[a.rule as RuleKey] ?? RULES.high_amount;
            return (
              <div className={`a-row ${newIds.has(a.id) ? "is-new" : ""}`} key={a.id}>
                <div className="a-ic" style={{ background: r.tint }}>{a.rule === "velocity" ? <IconBolt size={14} /> : <IconTriangle size={14} />}</div>
                <div className="a-body">
                  <span className="a-msg">{a.reason}</span>
                  <span className="a-meta">
                    <span className="rule" style={{ color: r.color }}>{r.label}</span>
                    <span className="sep">·</span><span>{r.severity}</span>
                    <span className="sep">·</span><span className="mono">{a.accountId}</span>
                    <span className="sep">·</span><span className="tnum">{brl(a.amount)}</span>
                  </span>
                </div>
                <span className="a-time">{hhmmss(a.createdAt)}</span>
              </div>
            );
          })
        )}
      </div>
      {!loading && <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} />}
    </section>
  );
}

/* ---------------- transactions ---------------- */
function TxPanel({ snap, loading, newIds }: { snap: Snap; loading: boolean; newIds: Set<string> }) {
  const tagsByTx = new Map<string, RuleKey[]>();
  for (const a of snap.alerts) {
    const arr = tagsByTx.get(a.transactionId) ?? [];
    if (!arr.includes(a.rule as RuleKey)) arr.push(a.rule as RuleKey);
    tagsByTx.set(a.transactionId, arr);
  }
  const { page, setPage, pageCount, total, pageItems } = usePaged(snap.txns);
  return (
    <section className="panel lp txns" aria-label="Transações">
      <div className="lp-h">
        <div className="title"><h2>Transações</h2><span className="badge">{loading ? "—" : snap.txns.length}</span></div>
        <span className="aside">mais recentes primeiro</span>
      </div>
      <div className="scroll">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => (
            <div className="sk-row" key={i} style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "50%" }}>
                <div className="sk-line" style={{ width: "60%" }} /><div className="sk-line sm" style={{ width: "40%" }} />
              </div>
              <div className="sk-line sm" style={{ width: 52 }} />
            </div>
          ))
        ) : snap.txns.length === 0 ? (
          <div className="empty"><span className="t">Sem transações</span><span className="d">Use o simulador para enviar a primeira.</span></div>
        ) : (
          pageItems.map((t) => {
            const tags = tagsByTx.get(t.id) ?? [];
            return (
              <div className={`t-row ${newIds.has(t.id) ? "is-new" : ""}`} key={t.id}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="t-amt">{brl(t.amount)}</span>
                  <span className="t-sub"><span className="mono">{t.accountId}</span> · {t.currency}</span>
                </div>
                <div className="t-right">
                  {tags.map((g) => (
                    <span className="tag" key={g} style={{ background: RULES[g].tint, color: RULES[g].color }}>{RULES[g].label}</span>
                  ))}
                  <span className="t-time">{hhmmss(t.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
      {!loading && <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} />}
    </section>
  );
}

/* ---------------- accounts dropdown ---------------- */
const Chevron = ({ open }: { open: boolean }) => (
  <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : undefined }}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
const Check = () => <svg className="dd-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4C8DFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

function AccountsDropdown({ accounts, selected, onSelect }: { accounts: Account[]; selected: string | null; onSelect: (a: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (v: string | null) => { onSelect(v); setOpen(false); };
  const active = selected ? accounts.find((a) => a.accountId === selected) : null;

  return (
    <section className="accounts" aria-label="Conta">
      <span className="acc-title">Conta</span>
      <div className="dd" ref={ref}>
        <button className="dd-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
          <span className={selected ? "mono" : ""}>{selected ?? "Geral"}</span>
          {active && active.alertCount > 0 && <span className="c alert"><span className="d" />{active.alertCount}</span>}
          <Chevron open={open} />
        </button>
        {open && (
          <div className="dd-menu" role="listbox">
            <button className={`dd-item ${selected === null ? "on" : ""}`} role="option" aria-selected={selected === null} onClick={() => pick(null)}>
              <span className="dd-main">Geral</span>
              <span className="dd-side">{accounts.length} {accounts.length === 1 ? "conta" : "contas"}</span>
              {selected === null && <Check />}
            </button>
            {accounts.map((a) => (
              <button key={a.accountId} className={`dd-item ${selected === a.accountId ? "on" : ""}`} role="option" aria-selected={selected === a.accountId} onClick={() => pick(a.accountId)}>
                <span className="dd-main mono">{a.accountId}</span>
                <span className="dd-side">
                  <span className="tnum">{a.txCount} tx</span>
                  {a.alertCount > 0 && <span className="c alert"><span className="d" />{a.alertCount}</span>}
                </span>
                {selected === a.accountId && <Check />}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- app ---------------- */
export function App() {
  const [paused, setPaused] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const { snap, loading, refreshing, online, now, pending, newIds, refresh, reload } = useLive(paused, account);

  const secs = snap.at ? Math.max(0, Math.floor((now - snap.at) / 1000)) : null;
  const updatedText = !online ? "sem conexão"
    : secs == null ? "conectando…"
    : secs < 1 ? "atualizado agora"
    : secs < 60 ? `atualizado há ${secs}s`
    : `atualizado há ${Math.floor(secs / 60)}min`;

  return (
    <>
      <Header
        live={online && !paused}
        paused={paused}
        refreshing={refreshing}
        updatedText={updatedText}
        updatedTitle={snap.at ? "Última atualização: " + hhmmss(new Date(snap.at).toISOString()) : ""}
        pending={pending}
        onToggle={() => setPaused((p) => !p)}
        onRefresh={() => void refresh()}
      />
      <main className="main">
        <AccountsDropdown accounts={snap.accounts} selected={account} onSelect={setAccount} />
        <Tiles snap={snap} loading={loading} />
        <div className="cols">
          <RulesPanel snap={snap} loading={loading} />
          <SimulatePanel reload={reload} snapAlerts={snap.alerts.length} scopeAccount={account} />
        </div>
        <div className="cols">
          <AlertsPanel snap={snap} loading={loading} newIds={newIds} />
          <TxPanel snap={snap} loading={loading} newIds={newIds} />
        </div>
      </main>
    </>
  );
}
