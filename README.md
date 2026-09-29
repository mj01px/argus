<div align="center">

# Argus

**Real-time transaction pipeline with fraud detection — event-driven, in C#/.NET.**

![C#](https://img.shields.io/badge/C%23-12-512BD4?style=flat-square&logo=csharp&logoColor=white)
![.NET 9](https://img.shields.io/badge/.NET_9-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![Kafka](https://img.shields.io/badge/Apache_Kafka-231F20?style=flat-square&logo=apachekafka&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## What it is

An API receives financial transactions, stores them in Postgres and publishes an event
to Kafka. A separate worker consumes those events, applies fraud rules and raises alerts —
fully decoupled through messaging, in the style of event-driven microservices.

The domain (fraud prevention in financial operations) comes from real-world experience;
here it becomes code.

## Architecture

```
   POST /transactions
          │
          ▼
 ┌──────────────────────┐   transactions.created   ┌────────────────────────┐
 │  Transactions API    │ ───────────────────────► │   Fraud Worker         │
 │  (ASP.NET Core)      │        (Kafka)           │   consumer group       │
 │  validate + store PG │                          │   fraud rules          │
 │  publish event       │                          │   → alerts.raised      │
 └──────────┬───────────┘                          └───────────┬────────────┘
            │                                                   │ alerts.raised
            ▼                                                   ▼
        PostgreSQL  ◄──────────── stores alerts ──────  ┌────────────────────┐
                                  (idempotent insert)   │  Notifications     │
                                                        │  another group     │
                                                        └────────────────────┘
```

- **Transactions API** (`src/Argus.Transactions`) — producer. `POST /transactions`
  validates, stores in Postgres and publishes `transactions.created`. The **event key is
  the `accountId`**, so all events for one account land on the same partition and are
  processed in order.
- **Fraud Worker** (`src/Argus.FraudWorker`) — consumer in the `fraud-workers` group.
  Applies the rules and publishes `alerts.raised`.
- **Notifications** (`src/Argus.Notifications`) — a second consumer group
  (`notifications`) on the `alerts.raised` topic, showing two independent groups consuming
  the same topic. It "sends" the notification (here, via log).
- **Argus.Contracts** — the shared event contracts.

## Delivery guarantees (the core idea)

- **At-least-once**: the worker uses `EnableAutoCommit = false` and only `Commit`s the
  offset **after** processing and persisting. If it crashes mid-way, the message is
  redelivered.
- **Idempotency**: the `alerts` table has `UNIQUE (transaction_id, rule)` and the insert
  is `ON CONFLICT DO NOTHING`. So redelivery **never** produces a duplicate alert — the
  practical result is *exactly-once* on the outcome, even with *at-least-once* delivery.
- **Write durability**: the producer uses `Acks.All` + `EnableIdempotence` to avoid losing
  or duplicating messages at the broker.

## Fraud rules

| Rule | Triggers when |
|------|---------------|
| `high_amount` | amount ≥ R$ 10,000 |
| `velocity`    | ≥ 5 transactions from the same account within 60s |

(Configurable in `FraudRules.cs`.)

## Running it

### Prerequisites (install once)

```bash
brew install --cask dotnet-sdk    # .NET 9 SDK
brew install --cask docker        # Docker Desktop — then open the app once
```

### Everything in containers

```bash
docker compose up --build
```

Starts Redpanda (Kafka), Postgres, the API and the workers. The **Kafka console** is at
<http://localhost:8081> and the API at <http://localhost:8080>.

### Dev mode (infra in Docker, services via dotnet)

```bash
docker compose up -d redpanda postgres console   # infra only
dotnet run --project src/Argus.Transactions       # terminal 1
dotnet run --project src/Argus.FraudWorker         # terminal 2
dotnet run --project src/Argus.Notifications       # terminal 3
```

### Dashboard (React + Vite)

Shows live transactions and alerts (2s polling) and has a form to fire transactions and
watch the rules trigger in real time.

```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173
```

The API URL is configurable via `VITE_API_URL` (defaults to `http://localhost:8080`).

## Testing

A normal transaction (no alert):

```bash
curl -X POST http://localhost:8080/transactions \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acc-1","amount":150.00}'
```

Triggers `high_amount`:

```bash
curl -X POST http://localhost:8080/transactions \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acc-1","amount":25000.00}'
```

Triggers `velocity` (run 5x quickly):

```bash
for i in $(seq 1 5); do
  curl -s -X POST http://localhost:8080/transactions \
    -H "Content-Type: application/json" \
    -d '{"accountId":"acc-2","amount":50.00}' > /dev/null
done
```

See the alerts:

```bash
curl http://localhost:8080/alerts
```

## Roadmap

- [x] **Notifications** service — a second consumer group on `alerts.raised`.
- [x] Live **React** dashboard consuming `/transactions` and `/alerts`.
- [ ] Swap Dapper for **EF Core** with migrations.
- [ ] Integration tests with **Testcontainers**.
- [ ] Deploy: push images to a registry + run `docker compose` on a free tier.

## Stack

C# · .NET 9 · ASP.NET Core · Confluent.Kafka · Redpanda · PostgreSQL · Dapper · React · Vite · Docker Compose
