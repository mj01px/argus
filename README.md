<div align="center">

# Sentinel

**Pipeline de transações com detecção de fraude em tempo real — event-driven, em C#/.NET.**

![C#](https://img.shields.io/badge/C%23-12-512BD4?style=flat-square&logo=csharp&logoColor=white)
![.NET 9](https://img.shields.io/badge/.NET_9-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![Kafka](https://img.shields.io/badge/Apache_Kafka-231F20?style=flat-square&logo=apachekafka&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## O que é

Uma API recebe transações financeiras, grava no Postgres e publica um evento no Kafka.
Um worker separado consome esses eventos, aplica regras de fraude e levanta alertas —
tudo desacoplado por mensageria, no estilo de microsserviços event-driven.

O domínio (prevenção a fraude em operações financeiras) vem de experiência real de
mercado; aqui ele vira código.

## Arquitetura

```
   POST /transactions
          │
          ▼
 ┌──────────────────────┐   transactions.created   ┌────────────────────────┐
 │  Transactions API    │ ───────────────────────► │   Fraud Worker         │
 │  (ASP.NET Core)      │        (Kafka)           │   consumer group       │
 │  valida + grava PG   │                          │   regras de fraude     │
 │  publica evento      │                          │   → alerts.raised      │
 └──────────┬───────────┘                          └───────────┬────────────┘
            │                                                   │
            ▼                                                   ▼
        PostgreSQL  ◄───────────── grava alertas ────────  (INSERT idempotente)
```

- **Transactions API** (`src/Sentinel.Transactions`) — producer. `POST /transactions`
  valida, grava no Postgres e publica `transactions.created`. A **key do evento é o
  `accountId`**, então todos os eventos de uma conta caem na mesma partição e são
  processados em ordem.
- **Fraud Worker** (`src/Sentinel.FraudWorker`) — consumer no grupo `fraud-workers`.
  Aplica as regras e publica `alerts.raised`.
- **Sentinel.Contracts** — os contratos de evento compartilhados.

## Garantias de entrega (o ponto central)

- **At-least-once**: o worker usa `EnableAutoCommit = false` e só faz `Commit` do offset
  **depois** de processar e persistir. Se cair no meio, a mensagem é reentregue.
- **Idempotência**: a tabela `alerts` tem `UNIQUE (transaction_id, rule)` e o insert é
  `ON CONFLICT DO NOTHING`. Assim, reentrega **nunca** gera alerta duplicado — o efeito
  prático é *exactly-once* no resultado, mesmo com entrega *at-least-once*.
- **Durabilidade na escrita**: o producer usa `Acks.All` + `EnableIdempotence` para não
  perder nem duplicar no broker.

## Regras de fraude

| Regra | Dispara quando |
|-------|----------------|
| `high_amount` | valor ≥ R$ 10.000 |
| `velocity`    | ≥ 5 transações da mesma conta em 60s |

(Configuráveis em `FraudRules.cs`.)

## Como rodar

### Pré-requisitos (instalar uma vez)

```bash
brew install --cask dotnet-sdk    # .NET 9 SDK
brew install --cask docker        # Docker Desktop — depois abra o app uma vez
```

### Tudo em containers

```bash
docker compose up --build
```

Sobe Redpanda (Kafka), Postgres, a API e o worker. O **console do Kafka** fica em
<http://localhost:8081> e a API em <http://localhost:8080>.

### Modo dev (infra em Docker, serviços via dotnet)

```bash
docker compose up -d redpanda postgres console   # só a infra
dotnet run --project src/Sentinel.Transactions   # terminal 1
dotnet run --project src/Sentinel.FraudWorker     # terminal 2
```

## Testando

Uma transação normal (não gera alerta):

```bash
curl -X POST http://localhost:8080/transactions \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acc-1","amount":150.00}'
```

Dispara `high_amount`:

```bash
curl -X POST http://localhost:8080/transactions \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acc-1","amount":25000.00}'
```

Dispara `velocity` (rode 5x rápido):

```bash
for i in $(seq 1 5); do
  curl -s -X POST http://localhost:8080/transactions \
    -H "Content-Type: application/json" \
    -d '{"accountId":"acc-2","amount":50.00}' > /dev/null
done
```

Veja os alertas:

```bash
curl http://localhost:8080/alerts
```

## Próximos passos

- [ ] Serviço **Notifications** — outro consumer group em `alerts.raised` (demonstra
      múltiplos grupos consumindo o mesmo tópico).
- [ ] Dashboard **React** consumindo `/transactions` e `/alerts` ao vivo.
- [ ] Trocar Dapper por **EF Core** com migrations.
- [ ] Testes de integração com **Testcontainers**.
- [ ] Deploy: imagens no registry + `docker compose` num free tier.

## Stack

C# · .NET 9 · ASP.NET Core · Confluent.Kafka · Redpanda · PostgreSQL · Dapper · Docker Compose
