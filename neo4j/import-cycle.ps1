$ErrorActionPreference = "Stop"

$Neo4jDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $Neo4jDir "docker-compose.yml"
$EnvFile = Join-Path $Neo4jDir ".env"
$ImportFile = Join-Path $Neo4jDir "import/import.cypher"

if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile. Copy neo4j/.env.example to neo4j/.env and set a local password."
}

Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line.Split("=", 2)
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
        }
    }
}

if (-not $env:NEO4J_USER) { $env:NEO4J_USER = "neo4j" }
if (-not $env:NEO4J_PASSWORD) { throw "NEO4J_PASSWORD must be set in neo4j/.env" }

docker compose -f $ComposeFile up -d neo4j

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD "RETURN 1;" *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { throw "Neo4j did not become ready in time." }

function Invoke-Cypher([string]$Query) {
    $result = docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD --database=neo4j --format plain $Query
    if ($LASTEXITCODE -ne 0) { throw "cypher-shell failed" }
    return $result
}

function Import-Once {
    Invoke-Cypher "MATCH (n) DETACH DELETE n;" | Out-Null
    Get-Content -Raw $ImportFile | docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD --database=neo4j --non-interactive
    if ($LASTEXITCODE -ne 0) { throw "Neo4j import failed" }
    $people = (Invoke-Cypher "MATCH (p:Person) RETURN count(p) AS c;")[-1].Trim()
    $assertions = (Invoke-Cypher "MATCH (a:Assertion) RETURN count(a) AS c;")[-1].Trim()
    $mentions = (Invoke-Cypher "MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;")[-1].Trim()
    return "$people|$assertions|$mentions"
}

$first = Import-Once
Write-Host "First import counts: $first"
$second = Import-Once
Write-Host "Second import counts: $second"

if ($first -ne $second) { throw "Idempotent import check failed: $first != $second" }
Write-Host "Idempotent import check: PASS ($second)"
