# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY Argus.sln ./
COPY src/Argus.Contracts/Argus.Contracts.csproj src/Argus.Contracts/
COPY src/Argus.FraudWorker/Argus.FraudWorker.csproj src/Argus.FraudWorker/
RUN dotnet restore src/Argus.FraudWorker/Argus.FraudWorker.csproj

COPY . .
RUN dotnet publish src/Argus.FraudWorker/Argus.FraudWorker.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "Argus.FraudWorker.dll"]
