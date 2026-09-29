-- Schema criado uma vez pelo Postgres (docker-entrypoint-initdb.d).
-- Duas tabelas: transactions (escrita pela API) e alerts (escrita pelo worker).

CREATE TABLE IF NOT EXISTS transactions (
    id         UUID PRIMARY KEY,
    account_id TEXT           NOT NULL,
    amount     NUMERIC(18, 2) NOT NULL,
    currency   TEXT           NOT NULL DEFAULT 'BRL',
    created_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_transactions_account
    ON transactions (account_id, created_at);

CREATE TABLE IF NOT EXISTS alerts (
    id             UUID PRIMARY KEY,
    transaction_id UUID           NOT NULL,
    account_id     TEXT           NOT NULL,
    rule           TEXT           NOT NULL,
    reason         TEXT           NOT NULL,
    amount         NUMERIC(18, 2) NOT NULL,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    -- Idempotencia: um alerta por (transacao, regra). O worker faz
    -- INSERT ... ON CONFLICT DO NOTHING, entao reentrega (at-least-once)
    -- nunca gera alerta duplicado.
    CONSTRAINT uq_alerts_txn_rule UNIQUE (transaction_id, rule)
);
CREATE INDEX IF NOT EXISTS ix_alerts_account
    ON alerts (account_id, created_at);
