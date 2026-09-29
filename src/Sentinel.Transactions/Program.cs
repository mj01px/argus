using System.Text.Json;
using Confluent.Kafka;
using Dapper;
using Npgsql;
using Sentinel.Contracts;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? "Host=localhost;Port=5432;Database=sentinel;Username=sentinel;Password=sentinel";
var bootstrapServers = builder.Configuration["Kafka:BootstrapServers"] ?? "localhost:9092";

// Dapper mapeia colunas snake_case (account_id) para propriedades PascalCase (AccountId).
DefaultTypeMap.MatchNamesWithUnderscores = true;

// Pool de conexoes do Postgres.
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));

// Producer Kafka: Acks.All + idempotencia = escrita duravel e sem duplicar no broker.
builder.Services.AddSingleton<IProducer<string, string>>(_ =>
    new ProducerBuilder<string, string>(new ProducerConfig
    {
        BootstrapServers = bootstrapServers,
        Acks = Acks.All,
        EnableIdempotence = true,
    }).Build());

// CORS liberado para o dashboard local (apenas dev).
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapPost("/transactions", async (
    CreateTransaction body,
    NpgsqlDataSource db,
    IProducer<string, string> producer,
    ILogger<Program> log) =>
{
    if (string.IsNullOrWhiteSpace(body.AccountId) || body.Amount <= 0)
        return Results.BadRequest(new { error = "accountId e obrigatorio e amount deve ser > 0" });

    var evt = new TransactionCreated(
        Id: Guid.NewGuid(),
        AccountId: body.AccountId.Trim(),
        Amount: body.Amount,
        Currency: string.IsNullOrWhiteSpace(body.Currency) ? "BRL" : body.Currency!.Trim().ToUpperInvariant(),
        CreatedAt: DateTimeOffset.UtcNow);

    await using var conn = await db.OpenConnectionAsync();
    await conn.ExecuteAsync(
        """
        INSERT INTO transactions (id, account_id, amount, currency, created_at)
        VALUES (@Id, @AccountId, @Amount, @Currency, @CreatedAt)
        """,
        new { evt.Id, evt.AccountId, evt.Amount, evt.Currency, CreatedAt = evt.CreatedAt.UtcDateTime });

    // Key = accountId: todos os eventos de uma conta caem na mesma particao,
    // preservando a ordem por conta dentro do consumer group.
    await producer.ProduceAsync(Topics.TransactionCreated, new Message<string, string>
    {
        Key = evt.AccountId,
        Value = JsonSerializer.Serialize(evt),
    });

    log.LogInformation("Transacao {Id} conta {Account} valor {Amount}", evt.Id, evt.AccountId, evt.Amount);
    return Results.Created($"/transactions/{evt.Id}", evt);
});

app.MapGet("/transactions", async (NpgsqlDataSource db, int limit = 50) =>
{
    await using var conn = await db.OpenConnectionAsync();
    var rows = await conn.QueryAsync<TransactionRow>(
        "SELECT id, account_id, amount, currency, created_at FROM transactions ORDER BY created_at DESC LIMIT @limit",
        new { limit = Math.Clamp(limit, 1, 200) });
    return Results.Ok(rows);
});

app.MapGet("/alerts", async (NpgsqlDataSource db, int limit = 50) =>
{
    await using var conn = await db.OpenConnectionAsync();
    var rows = await conn.QueryAsync<AlertRow>(
        "SELECT id, transaction_id, account_id, rule, reason, amount, created_at FROM alerts ORDER BY created_at DESC LIMIT @limit",
        new { limit = Math.Clamp(limit, 1, 200) });
    return Results.Ok(rows);
});

app.Run();

record CreateTransaction(string AccountId, decimal Amount, string? Currency);
record TransactionRow(Guid Id, string AccountId, decimal Amount, string Currency, DateTime CreatedAt);
record AlertRow(Guid Id, Guid TransactionId, string AccountId, string Rule, string Reason, decimal Amount, DateTime CreatedAt);
