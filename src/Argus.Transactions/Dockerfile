# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restaura primeiro so os .csproj para aproveitar o cache de camadas.
COPY Argus.sln ./
COPY src/Argus.Contracts/Argus.Contracts.csproj src/Argus.Contracts/
COPY src/Argus.Transactions/Argus.Transactions.csproj src/Argus.Transactions/
RUN dotnet restore src/Argus.Transactions/Argus.Transactions.csproj

COPY . .
RUN dotnet publish src/Argus.Transactions/Argus.Transactions.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Argus.Transactions.dll"]
