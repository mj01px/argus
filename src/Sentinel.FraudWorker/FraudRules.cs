using System.Collections.Concurrent;
using Sentinel.Contracts;

namespace Sentinel.FraudWorker;

public record RuleHit(string Rule, string Reason);

/// <summary>
/// Regras de fraude. O estado da "velocity" e em memoria, entao vale para
/// uma unica instancia do worker (suficiente para o demo). Em producao, essa
/// janela deslizante ficaria num store compartilhado (ex.: Redis) para
/// funcionar com varios consumidores no mesmo grupo.
/// </summary>
public class FraudRules
{
    private const decimal HighAmount = 10_000m;
    private const int VelocityCount = 5;
    private static readonly TimeSpan VelocityWindow = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _recent = new();

    public IReadOnlyList<RuleHit> Evaluate(TransactionCreated tx)
    {
        var hits = new List<RuleHit>();

        if (tx.Amount >= HighAmount)
            hits.Add(new RuleHit("high_amount",
                $"Valor {tx.Amount:N2} acima do limite de {HighAmount:N2}"));

        var window = _recent.GetOrAdd(tx.AccountId, _ => new Queue<DateTimeOffset>());
        int count;
        lock (window)
        {
            window.Enqueue(tx.CreatedAt);
            while (window.Count > 0 && tx.CreatedAt - window.Peek() > VelocityWindow)
                window.Dequeue();
            count = window.Count;
        }

        if (count >= VelocityCount)
            hits.Add(new RuleHit("velocity",
                $"{count} transacoes em {VelocityWindow.TotalSeconds:N0}s na mesma conta"));

        return hits;
    }
}
