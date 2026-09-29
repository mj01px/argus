# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY Sentinel.sln ./
COPY src/Sentinel.Contracts/Sentinel.Contracts.csproj src/Sentinel.Contracts/
COPY src/Sentinel.Notifications/Sentinel.Notifications.csproj src/Sentinel.Notifications/
RUN dotnet restore src/Sentinel.Notifications/Sentinel.Notifications.csproj

COPY . .
RUN dotnet publish src/Sentinel.Notifications/Sentinel.Notifications.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "Sentinel.Notifications.dll"]
