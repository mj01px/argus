# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restaura primeiro so os .csproj para aproveitar o cache de camadas.
COPY Sentinel.sln ./
COPY src/Sentinel.Contracts/Sentinel.Contracts.csproj src/Sentinel.Contracts/
COPY src/Sentinel.Transactions/Sentinel.Transactions.csproj src/Sentinel.Transactions/
RUN dotnet restore src/Sentinel.Transactions/Sentinel.Transactions.csproj

COPY . .
RUN dotnet publish src/Sentinel.Transactions/Sentinel.Transactions.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Sentinel.Transactions.dll"]
