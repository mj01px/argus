# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY Sentinel.sln ./
COPY src/Sentinel.Contracts/Sentinel.Contracts.csproj src/Sentinel.Contracts/
COPY src/Sentinel.FraudWorker/Sentinel.FraudWorker.csproj src/Sentinel.FraudWorker/
RUN dotnet restore src/Sentinel.FraudWorker/Sentinel.FraudWorker.csproj

COPY . .
RUN dotnet publish src/Sentinel.FraudWorker/Sentinel.FraudWorker.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "Sentinel.FraudWorker.dll"]
