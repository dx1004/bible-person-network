#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  echo "Missing $ROOT_DIR/.env; copy neo4j/.env.example and set NEO4J_PASSWORD locally." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ROOT_DIR/.env"
set +a

if [[ -z "${NEO4J_USER:-}" ]]; then
  NEO4J_USER="neo4j"
fi
if [[ -z "${NEO4J_PASSWORD:-}" ]]; then
  echo "NEO4J_PASSWORD must be set in neo4j/.env" >&2
  exit 1
fi

run_once() {
  docker compose -f "$COMPOSE_FILE" exec -T neo4j \
    cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" \
    --database=neo4j --non-interactive "$1"
}

docker compose -f "$COMPOSE_FILE" up -d neo4j
for _ in {1..60}; do
  if docker compose -f "$COMPOSE_FILE" exec -T neo4j cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1;" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
run_once "RETURN 1;" >/dev/null
run_once "MATCH (n) DETACH DELETE n;"
cat "$ROOT_DIR/import/import.cypher" | docker compose -f "$COMPOSE_FILE" exec -T neo4j \
  cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" --database=neo4j --non-interactive

COUNT_PERSONS="$(run_once 'MATCH (p:Person) RETURN count(p) AS c;' | tail -n +2 | tr -d '\r' | tr -d ' ')"
COUNT_ASSERTIONS="$(run_once 'MATCH (a:Assertion) RETURN count(a) AS c;' | tail -n +2 | tr -d '\r' | tr -d ' ')"
echo "After first import: $COUNT_PERSONS people, $COUNT_ASSERTIONS assertions"

run_once "MATCH (n) DETACH DELETE n;"
cat "$ROOT_DIR/import/import.cypher" | docker compose -f "$COMPOSE_FILE" exec -T neo4j \
  cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" --database=neo4j --non-interactive

COUNT_PERSONS_2="$(run_once 'MATCH (p:Person) RETURN count(p) AS c;' | tail -n +2 | tr -d '\r' | tr -d ' ')"
COUNT_ASSERTIONS_2="$(run_once 'MATCH (a:Assertion) RETURN count(a) AS c;' | tail -n +2 | tr -d '\r' | tr -d ' ')"
echo "After second import: $COUNT_PERSONS_2 people, $COUNT_ASSERTIONS_2 assertions"

if [[ "$COUNT_PERSONS" == "$COUNT_PERSONS_2" && "$COUNT_ASSERTIONS" == "$COUNT_ASSERTIONS_2" ]]; then
  echo "Idempotent import check: PASS"
else
  echo "Idempotent import check: FAIL"
  exit 1
fi
