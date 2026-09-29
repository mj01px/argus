# Build context = raiz do repo (ver docker-compose.yml).
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY Argus.sln ./
COPY src/Argus.Contracts/Argus.Contracts.csproj src/Argus.Contracts/
COPY src/Argus.Notifications/Argus.Notifications.csproj src/Argus.Notifications/
RUN dotnet restore src/Argus.Notifications/Argus.Notifications.csproj

COPY . .
RUN dotnet publish src/Argus.Notifications/Argus.Notifications.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:9.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENTRYPOINT ["dotnet", "Argus.Notifications.dll"]
