using System.Text.Json;
using Confluent.Kafka;
using Argus.Contracts;

namespace Argus.Notifications;

/// <summary>
/// Segundo consumer group no MESMO topico alerts.raised. Enquanto o Fraud Worker
/// PRODUZ os alertas, este servico os CONSOME num grupo proprio ("notifications")
/// para "enviar" a notificacao. Como e um grupo diferente, recebe sua propria copia
/// de cada alerta, independente de qualquer outro consumidor do topico.
///
/// Aqui a notificacao e apenas logada; trocar por e-mail/push/WhatsApp e so plugar
/// um cliente no lugar do log.
/// </summary>
public class NotificationsWorker : BackgroundService
{
    private readonly ILogger<NotificationsWorker> _log;
    private readonly IConfiguration _config;

    public NotificationsWorker(ILogger<NotificationsWorker> log, IConfiguration config)
    {
        _log = log;
        _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var bootstrapServers = _config["Kafka:BootstrapServers"] ?? "localhost:9092";

        var consumerConfig = new ConsumerConfig
        {
            BootstrapServers = bootstrapServers,
            GroupId = "notifications",
            AutoOffsetReset = AutoOffsetReset.Earliest,
            EnableAutoCommit = false,
        };

        using var consumer = new ConsumerBuilder<string, string>(consumerConfig).Build();
        consumer.Subscribe(Topics.AlertRaised);
        _log.LogInformation("Notifications inscrito em {Topic} (grupo notifications)", Topics.AlertRaised);

        // Consumo cooperativo com o loop de background: roda numa Task para nao bloquear.
        await Task.Run(() =>
        {
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

                    var alert = JsonSerializer.Deserialize<AlertRaised>(result.Message.Value);
                    if (alert is not null)
                        _log.LogInformation(
                            "NOTIFICACAO enviada: conta {Account} — {Rule}: {Reason}",
                            alert.AccountId, alert.Rule, alert.Reason);

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
        }, stoppingToken);
    }
}
