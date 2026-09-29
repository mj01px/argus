using Argus.Notifications;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<NotificationsWorker>();
builder.Build().Run();
