using System.Text.Json;
using Confluent.Kafka;
using Dapper;
using Npgsql;
using Argus.Contracts;

namespace Argus.FraudWorker;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _log;
    private readonly IConfiguration _config;
    private readonly FraudRules _rules = new();

    public Worker(ILogger<Worker> log, IConfiguration config)
    {
        _log = log;
        _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var connectionString = _config.GetConnectionString("Postgres")
            ?? "Host=localhost;Port=5432;Database=argus;Username=argus;Password=argus";
        var bootstrapServers = _config["Kafka:BootstrapServers"] ?? "localhost:9092";

        DefaultTypeMap.MatchNamesWithUnderscores = true;
        await using var db = NpgsqlDataSource.Create(connectionString);

        using var producer = new ProducerBuilder<string, string>(new ProducerConfig
        {
            BootstrapServers = bootstrapServers,
            Acks = Acks.All,
            EnableIdempotence = true,
        }).Build();

        var consumerConfig = new ConsumerConfig
        {
            BootstrapServers = bootstrapServers,
            GroupId = "fraud-workers",
            AutoOffsetReset = AutoOffsetReset.Earliest,
            // Commit manual = at-least-once: so avanco o offset DEPOIS de processar
            // e persistir. Se o worker cair no meio, a mensagem e reentregue e a
            // constraint unica (transaction_id, rule) evita alerta duplicado.
            EnableAutoCommit = false,
        };

        using var consumer = new ConsumerBuilder<string, string>(consumerConfig).Build();
        consumer.Subscribe(Topics.TransactionCreated);
        _log.LogInformation("Fraud worker inscrito em {Topic} (grupo fraud-workers)", Topics.TransactionCreated);

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                ConsumeResult<string, string> result;
                try
                {
                    result = consumer.Consume(stoppingToken);
                }
                catch (ConsumeException ex)
                {
                    _log.LogError(ex, "Erro ao consumir do Kafka");
                    continue;
                }

                if (result?.Message?.Value is null)
                    continue;

                try
                {
                    var evt = JsonSerializer.Deserialize<TransactionCreated>(result.Message.Value);
                    if (evt is not null)
                        await HandleAsync(evt, db, producer, stoppingToken);
                }
                catch (Exception ex)
                {
                    // Nao faz commit: a mensagem sera reentregue (at-least-once).
                    _log.LogError(ex, "Falha ao processar offset {Offset}; sem commit", result.TopicPartitionOffset);
                    continue;
                }

                consumer.Commit(result);
            }
        }
        catch (OperationCanceledException)
        {
            // shutdown normal
        }
        finally
        {
            consumer.Close();
        }
    }

    private async Task HandleAsync(
        TransactionCreated tx,
        NpgsqlDataSource db,
        IProducer<string, string> producer,
        CancellationToken ct)
    {
        foreach (var hit in _rules.Evaluate(tx))
        {
            var alert = new AlertRaised(
                Id: Guid.NewGuid(),
                TransactionId: tx.Id,
                AccountId: tx.AccountId,
                Rule: hit.Rule,
                Reason: hit.Reason,
                Amount: tx.Amount,
                CreatedAt: DateTimeOffset.UtcNow);

            await using var conn = await db.OpenConnectionAsync(ct);
            var inserted = await conn.ExecuteAsync(
                """
                INSERT INTO alerts (id, transaction_id, account_id, rule, reason, amount, created_at)
                VALUES (@Id, @TransactionId, @AccountId, @Rule, @Reason, @Amount, @CreatedAt)
                ON CONFLICT (transaction_id, rule) DO NOTHING
                """,
                new { alert.Id, alert.TransactionId, alert.AccountId, alert.Rule, alert.Reason, alert.Amount, CreatedAt = alert.CreatedAt.UtcDateTime });

            // So publica o AlertRaised se o alerta e novo (evita eco em reentrega).
            if (inserted > 0)
            {
                await producer.ProduceAsync(Topics.AlertRaised, new Message<string, string>
                {
                    Key = alert.AccountId,
                    Value = JsonSerializer.Serialize(alert),
                }, ct);

                _log.LogWarning("ALERTA {Rule} conta {Account} tx {Tx}: {Reason}",
                    alert.Rule, alert.AccountId, alert.TransactionId, alert.Reason);
            }
        }
    }
}
