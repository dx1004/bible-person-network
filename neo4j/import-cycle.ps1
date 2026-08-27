$ErrorActionPreference = "Stop"

$Neo4jDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $Neo4jDir "docker-compose.yml"
$EnvFile = Join-Path $Neo4jDir ".env"
$ImportDir = Join-Path $Neo4jDir "import"
$ImportFile = Join-Path $ImportDir "import.cypher"

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Count -eq 2) {
                [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
            }
        }
    }
}

if (-not $env:NEO4J_USER) { $env:NEO4J_USER = "neo4j" }
if (-not $env:NEO4J_PASSWORD) { throw "NEO4J_PASSWORD must be set in neo4j/.env or environment." }

$ExpectedPersons = (Import-Csv (Join-Path $ImportDir "person_nodes.csv")).Count
$ExpectedAssertions = (Import-Csv (Join-Path $ImportDir "assertion_nodes.csv")).Count
$ExpectedMentions = (Import-Csv (Join-Path $ImportDir "mention_edges.csv")).Count
$ExpectedNames = (Import-Csv (Join-Path $ImportDir "name_nodes.csv")).Count
$ExpectedSources = (Import-Csv (Join-Path $ImportDir "evidence_nodes.csv")).Count
$ExpectedIdentityOptions = (Import-Csv (Join-Path $ImportDir "identity_option_nodes.csv")).Count
$ExpectedPassages = (Import-Csv (Join-Path $ImportDir "passage_nodes.csv")).Count
$ExpectedSupportedBy = (Import-Csv (Join-Path $ImportDir "assertion_evidence.csv")).Count * 2

function Invoke-Cypher([string]$Query) {
    $result = docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD --database=neo4j --format plain $Query
    if ($LASTEXITCODE -ne 0) { throw "cypher-shell failed" }
    return $result | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1
}

function Run-Count([string]$Query) {
    return [int](Invoke-Cypher $Query).Trim()
}

function Get-SnapshotString {
    $people = Run-Count "MATCH (p:Person) RETURN count(p) AS c;"
    $assertions = Run-Count "MATCH (a:Assertion) RETURN count(a) AS c;"
    $names = Run-Count "MATCH (n:NameVariant) RETURN count(n) AS c;"
    $sources = Run-Count "MATCH (s:Source) RETURN count(s) AS c;"
    $identityOptions = Run-Count "MATCH (i:IdentityOption) RETURN count(i) AS c;"
    $passages = Run-Count "MATCH (p:Passage) RETURN count(p) AS c;"
    $mentions = Run-Count "MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;"
    $supportedBy = Run-Count "MATCH ()-[r:SUPPORTED_BY]->() RETURN count(r) AS c;"
    $hasName = Run-Count "MATCH ()-[r:HAS_NAME]->() RETURN count(r) AS c;"
    $hasIdentity = Run-Count "MATCH ()-[r:HAS_IDENTITY_OPTION]->() RETURN count(r) AS c;"
    $subject = Run-Count "MATCH ()-[r:SUBJECT]->() RETURN count(r) AS c;"
    $object = Run-Count "MATCH ()-[r:OBJECT]->() RETURN count(r) AS c;"

    return "person=$people,assertion=$assertions,name=$names,source=$sources,identity=$identityOptions,passage=$passages,mention=$mentions,supported_by=$supportedBy,has_name=$hasName,has_identity=$hasIdentity,subject=$subject,object=$object"
}

function Test-Integrity {
    $people = Run-Count "MATCH (p:Person) RETURN count(p) AS c;"
    $assertions = Run-Count "MATCH (a:Assertion) RETURN count(a) AS c;"
    $names = Run-Count "MATCH (n:NameVariant) RETURN count(n) AS c;"
    $sources = Run-Count "MATCH (s:Source) RETURN count(s) AS c;"
    $identityOptions = Run-Count "MATCH (i:IdentityOption) RETURN count(i) AS c;"
    $passages = Run-Count "MATCH (p:Passage) RETURN count(p) AS c;"
    $mentions = Run-Count "MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;"
    $supportedBy = Run-Count "MATCH ()-[r:SUPPORTED_BY]->() RETURN count(r) AS c;"
    $hasName = Run-Count "MATCH ()-[r:HAS_NAME]->() RETURN count(r) AS c;"
    $hasIdentity = Run-Count "MATCH ()-[r:HAS_IDENTITY_OPTION]->() RETURN count(r) AS c;"
    $subject = Run-Count "MATCH ()-[r:SUBJECT]->() RETURN count(r) AS c;"
    $object = Run-Count "MATCH ()-[r:OBJECT]->() RETURN count(r) AS c;"
    $orphanName = Run-Count "MATCH (n:NameVariant) WHERE NOT EXISTS { (p:Person)-[:HAS_NAME]->(n) } RETURN count(n) AS c;"
    $orphanAssertion = Run-Count "MATCH (a:Assertion) WHERE NOT EXISTS { (a)-[:SUBJECT]->(:Person) } OR NOT EXISTS { (a)-[:OBJECT]->(:Person) } RETURN count(a) AS c;"
    $orphanIdentity = Run-Count "MATCH (i:IdentityOption) WHERE NOT EXISTS { (p:Person)-[:HAS_IDENTITY_OPTION]->(i) } RETURN count(i) AS c;"
    $invalidEndpoints = Run-Count "MATCH (a:Assertion) OPTIONAL MATCH (a)-[:SUBJECT]->(sp:Person) OPTIONAL MATCH (a)-[:OBJECT]->(op:Person) WHERE sp IS NULL OR op IS NULL RETURN count(a) AS c;"

    Write-Host "Integrity counts: Person=$people/$ExpectedPersons Assertion=$assertions/$ExpectedAssertions Name=$names/$ExpectedNames Source=$sources/$ExpectedSources IdentityOption=$identityOptions/$ExpectedIdentityOptions Passage=$passages/$ExpectedPassages"
    Write-Host "Relationship counts: MentionedIn=$mentions/$ExpectedMentions SupportedBy=$supportedBy/$ExpectedSupportedBy HasName=$hasName/$ExpectedNames HasIdentityOption=$hasIdentity/$ExpectedIdentityOptions Subject=$subject/$ExpectedAssertions Object=$object/$ExpectedAssertions"
    Write-Host "Orphan checks: NameVariant=$orphanName Assertion=$orphanAssertion IdentityOption=$orphanIdentity"
    Write-Host "Invalid assertion endpoints=$invalidEndpoints"

    if (
        $people -ne $ExpectedPersons -or
        $assertions -ne $ExpectedAssertions -or
        $names -ne $ExpectedNames -or
        $sources -ne $ExpectedSources -or
        $identityOptions -ne $ExpectedIdentityOptions -or
        $passages -ne $ExpectedPassages -or
        $mentions -ne $ExpectedMentions -or
        $supportedBy -ne $ExpectedSupportedBy -or
        $hasName -ne $ExpectedNames -or
        $hasIdentity -ne $ExpectedIdentityOptions -or
        $subject -ne $ExpectedAssertions -or
        $object -ne $ExpectedAssertions
    ) {
        throw "Imported counts do not match committed csv counts."
    }
    if ($orphanName -ne 0 -or $orphanAssertion -ne 0 -or $orphanIdentity -ne 0 -or $invalidEndpoints -ne 0) {
        throw "Integrity invariant failed: orphan/endpoint checks are non-zero."
    }
}

function Import-Once {
    Invoke-Cypher "MATCH (n) DETACH DELETE n;" | Out-Null
    Get-Content -Raw $ImportFile | docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD --database=neo4j --non-interactive
    if ($LASTEXITCODE -ne 0) { throw "Neo4j import failed" }
}

try {
    docker compose -f $ComposeFile up -d neo4j
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        docker compose -f $ComposeFile exec -T neo4j cypher-shell -u $env:NEO4J_USER -p $env:NEO4J_PASSWORD "RETURN 1;" *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "Neo4j did not become ready in time." }

    Import-Once
    Test-Integrity
    $snapshot1 = Get-SnapshotString
    $counts1 = @{
        people = Run-Count "MATCH (p:Person) RETURN count(p) AS c;"
        assertions = Run-Count "MATCH (a:Assertion) RETURN count(a) AS c;"
        mentions = Run-Count "MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;"
    }
    Write-Host "First import counts: People=$($counts1.people) Assertions=$($counts1.assertions) Mentions=$($counts1.mentions)"
    Write-Host "First import snapshot: $snapshot1"

    Import-Once
    Test-Integrity
    $snapshot2 = Get-SnapshotString
    $counts2 = @{
        people = Run-Count "MATCH (p:Person) RETURN count(p) AS c;"
        assertions = Run-Count "MATCH (a:Assertion) RETURN count(a) AS c;"
        mentions = Run-Count "MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;"
    }
    Write-Host "Second import counts: People=$($counts2.people) Assertions=$($counts2.assertions) Mentions=$($counts2.mentions)"
    Write-Host "Second import snapshot: $snapshot2"

    if ($snapshot1 -ne $snapshot2) {
        throw "Import snapshots are not identical: $snapshot1 != $snapshot2"
    }

    if ($counts1.people -eq $counts2.people -and $counts1.assertions -eq $counts2.assertions -and $counts1.mentions -eq $counts2.mentions) {
        Write-Host "Idempotent import check: PASS ($($counts2.people), $($counts2.assertions), $($counts2.mentions))"
    } else {
        throw "Idempotent import check failed: $($counts1.people)/$($counts1.assertions)/$($counts1.mentions) != $($counts2.people)/$($counts2.assertions)/$($counts2.mentions)"
    }
} finally {
    docker compose -f $ComposeFile down -v | Out-Null
}
