namespace Argus.Contracts;

/// <summary>Nomes dos topicos Kafka, compartilhados por producer e consumer.</summary>
public static class Topics
{
    public const string TransactionCreated = "transactions.created";
    public const string AlertRaised = "alerts.raised";
}

/// <summary>Publicado pela Transactions API quando uma transacao entra.</summary>
public record TransactionCreated(
    Guid Id,
    string AccountId,
    decimal Amount,
    string Currency,
    DateTimeOffset CreatedAt);

/// <summary>Publicado pelo Fraud Worker quando uma regra dispara.</summary>
public record AlertRaised(
    Guid Id,
    Guid TransactionId,
    string AccountId,
    string Rule,
    string Reason,
    decimal Amount,
    DateTimeOffset CreatedAt);
