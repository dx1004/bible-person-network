#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
IMPORT_DIR="$ROOT_DIR/import"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi

NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-}"
if [[ -z "${NEO4J_PASSWORD}" ]]; then
  echo "NEO4J_PASSWORD must be provided via neo4j/.env or environment variable." >&2
  exit 1
fi

EXPECTED_PERSONS="$(awk 'NR>1 && NF' "$IMPORT_DIR/person_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_ASSERTIONS="$(awk 'NR>1 && NF' "$IMPORT_DIR/assertion_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_MENTIONS="$(awk 'NR>1 && NF' "$IMPORT_DIR/mention_edges.csv" | wc -l | tr -d ' ')"
EXPECTED_NAMES="$(awk 'NR>1 && NF' "$IMPORT_DIR/name_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_SOURCES="$(awk 'NR>1 && NF' "$IMPORT_DIR/evidence_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_IDENTITY_OPTIONS="$(awk 'NR>1 && NF' "$IMPORT_DIR/identity_option_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_PASSAGES="$(awk 'NR>1 && NF' "$IMPORT_DIR/passage_nodes.csv" | wc -l | tr -d ' ')"
EXPECTED_SUPPORTED_BY="$(awk -F, 'NR>1 && NF {source_pair[$1 SUBSEP $2]=1; passage_pair[$1 SUBSEP $3]=1} END {print length(source_pair)+length(passage_pair)}' "$IMPORT_DIR/assertion_evidence.csv")"
IMPORT_CYPHER="$(cat "$IMPORT_DIR/import.cypher")"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v
}
trap cleanup EXIT

run_once() {
  docker compose -f "$COMPOSE_FILE" exec -T neo4j \
    cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" \
    --database=neo4j --non-interactive "$1"
}

query_scalar() {
  run_once "$1" | awk 'NF {val=$1} END {print val}' | tr -d '\r' | tr -d ' '
}

import_once() {
  run_once "MATCH (n) DETACH DELETE n;"
  printf '%s\n' "$IMPORT_CYPHER" | docker compose -f "$COMPOSE_FILE" exec -T neo4j \
    cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" --database=neo4j --non-interactive
}

check_counts() {
  local pass="$1"
  local c_people c_assertions c_names c_sources c_identity_options c_passages
  local c_mentions c_supported_by c_has_name c_has_identity c_subject c_object
  local c_name_orphan c_assertion_orphan c_identity_orphan c_invalid_endpoints
  local c_person_endpointless c_name_endpointless c_identity_endpointless

  c_people="$(query_scalar 'MATCH (p:Person) RETURN count(p) AS c;')"
  c_assertions="$(query_scalar 'MATCH (a:Assertion) RETURN count(a) AS c;')"
  c_names="$(query_scalar 'MATCH (n:NameVariant) RETURN count(n) AS c;')"
  c_sources="$(query_scalar 'MATCH (s:Source) RETURN count(s) AS c;')"
  c_identity_options="$(query_scalar 'MATCH (i:IdentityOption) RETURN count(i) AS c;')"
  c_passages="$(query_scalar 'MATCH (p:Passage) RETURN count(p) AS c;')"
  c_mentions="$(query_scalar 'MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;')"
  c_supported_by="$(query_scalar 'MATCH ()-[r:SUPPORTED_BY]->() RETURN count(r) AS c;')"
  c_has_name="$(query_scalar 'MATCH ()-[r:HAS_NAME]->() RETURN count(r) AS c;')"
  c_has_identity="$(query_scalar 'MATCH ()-[r:HAS_IDENTITY_OPTION]->() RETURN count(r) AS c;')"
  c_subject="$(query_scalar 'MATCH ()-[r:SUBJECT]->() RETURN count(r) AS c;')"
  c_object="$(query_scalar 'MATCH ()-[r:OBJECT]->() RETURN count(r) AS c;')"

  c_name_orphan="$(query_scalar 'MATCH (n:NameVariant) WHERE NOT EXISTS { (p:Person)-[:HAS_NAME]->(n) } RETURN count(n) AS c;')"
  c_assertion_orphan="$(query_scalar 'MATCH (a:Assertion) WHERE NOT EXISTS { (a)-[:SUBJECT]->(:Person) } OR NOT EXISTS { (a)-[:OBJECT]->(:Person) } RETURN count(a) AS c;')"
  c_identity_orphan="$(query_scalar 'MATCH (i:IdentityOption) WHERE NOT EXISTS { (p:Person)-[:HAS_IDENTITY_OPTION]->(i) } RETURN count(i) AS c;')"
  c_invalid_endpoints="$(query_scalar 'MATCH (a:Assertion) WHERE NOT EXISTS { (a)-[:SUBJECT]->(:Person) } OR NOT EXISTS { (a)-[:OBJECT]->(:Person) } RETURN count(a) AS c;')"

  echo "After $pass import:"
  echo "  Person=$c_people/$EXPECTED_PERSONS"
  echo "  Assertion=$c_assertions/$EXPECTED_ASSERTIONS"
  echo "  NameVariant=$c_names/$EXPECTED_NAMES"
  echo "  Source=$c_sources/$EXPECTED_SOURCES"
  echo "  IdentityOption=$c_identity_options/$EXPECTED_IDENTITY_OPTIONS"
  echo "  Passage=$c_passages/$EXPECTED_PASSAGES"
  echo "  MentionedIn=$c_mentions/$EXPECTED_MENTIONS"
  echo "  SupportedBy=$c_supported_by/$EXPECTED_SUPPORTED_BY"
  echo "  HasName=$c_has_name/$EXPECTED_NAMES"
  echo "  HasIdentityOption=$c_has_identity/$EXPECTED_IDENTITY_OPTIONS"
  echo "  Subject=$c_subject/$EXPECTED_ASSERTIONS"
  echo "  Object=$c_object/$EXPECTED_ASSERTIONS"
  echo "  orphanNameVariant=$c_name_orphan"
  echo "  orphanAssertion=$c_assertion_orphan"
  echo "  orphanIdentityOption=$c_identity_orphan"
  echo "  invalidAssertionEndpoints=$c_invalid_endpoints"

  if [[ \
    "$c_people" -ne "$EXPECTED_PERSONS" || \
    "$c_assertions" -ne "$EXPECTED_ASSERTIONS" || \
    "$c_names" -ne "$EXPECTED_NAMES" || \
    "$c_sources" -ne "$EXPECTED_SOURCES" || \
    "$c_identity_options" -ne "$EXPECTED_IDENTITY_OPTIONS" || \
    "$c_passages" -ne "$EXPECTED_PASSAGES" || \
    "$c_mentions" -ne "$EXPECTED_MENTIONS" || \
    "$c_supported_by" -ne "$EXPECTED_SUPPORTED_BY" || \
    "$c_has_name" -ne "$EXPECTED_NAMES" || \
    "$c_has_identity" -ne "$EXPECTED_IDENTITY_OPTIONS" || \
    "$c_subject" -ne "$EXPECTED_ASSERTIONS" || \
    "$c_object" -ne "$EXPECTED_ASSERTIONS" ]]; then
    echo "Imported counts do not match committed csv-derived counts." >&2
    exit 1
  fi
  if [[ "$c_name_orphan" -ne 0 || "$c_assertion_orphan" -ne 0 || "$c_identity_orphan" -ne 0 || "$c_invalid_endpoints" -ne 0 ]]; then
    echo "Invariant violation: orphan/endpoint integrity check failed." >&2
    exit 1
  fi
}

snapshot_signature() {
  local c_people c_assertions c_names c_sources c_identity_options c_passages
  local c_mentions c_supported_by c_has_name c_has_identity c_subject c_object

  c_people="$(query_scalar 'MATCH (p:Person) RETURN count(p) AS c;')"
  c_assertions="$(query_scalar 'MATCH (a:Assertion) RETURN count(a) AS c;')"
  c_names="$(query_scalar 'MATCH (n:NameVariant) RETURN count(n) AS c;')"
  c_sources="$(query_scalar 'MATCH (s:Source) RETURN count(s) AS c;')"
  c_identity_options="$(query_scalar 'MATCH (i:IdentityOption) RETURN count(i) AS c;')"
  c_passages="$(query_scalar 'MATCH (p:Passage) RETURN count(p) AS c;')"
  c_mentions="$(query_scalar 'MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;')"
  c_supported_by="$(query_scalar 'MATCH ()-[r:SUPPORTED_BY]->() RETURN count(r) AS c;')"
  c_has_name="$(query_scalar 'MATCH ()-[r:HAS_NAME]->() RETURN count(r) AS c;')"
  c_has_identity="$(query_scalar 'MATCH ()-[r:HAS_IDENTITY_OPTION]->() RETURN count(r) AS c;')"
  c_subject="$(query_scalar 'MATCH ()-[r:SUBJECT]->() RETURN count(r) AS c;')"
  c_object="$(query_scalar 'MATCH ()-[r:OBJECT]->() RETURN count(r) AS c;')"

  printf 'person:%s|assertion:%s|name:%s|source:%s|identity:%s|passage:%s|mention:%s|supported_by:%s|has_name:%s|has_identity:%s|subject:%s|object:%s\n' \
    "$c_people" "$c_assertions" "$c_names" "$c_sources" "$c_identity_options" "$c_passages" "$c_mentions" "$c_supported_by" "$c_has_name" "$c_has_identity" "$c_subject" "$c_object"
}

docker compose -f "$COMPOSE_FILE" up -d neo4j
ready=false
for _ in {1..60}; do
  if docker compose -f "$COMPOSE_FILE" exec -T neo4j cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "RETURN 1;" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo "Neo4j container did not become ready." >&2
  exit 1
fi

import_once
check_counts "first"
SIGNATURE1="$(snapshot_signature)"
COUNT_PERSONS_1="$(query_scalar 'MATCH (p:Person) RETURN count(p) AS c;')"
COUNT_ASSERTIONS_1="$(query_scalar 'MATCH (a:Assertion) RETURN count(a) AS c;')"
COUNT_MENTIONS_1="$(query_scalar 'MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;')"
echo "First snapshot: $SIGNATURE1"

import_once
check_counts "second"
SIGNATURE2="$(snapshot_signature)"
COUNT_PERSONS_2="$(query_scalar 'MATCH (p:Person) RETURN count(p) AS c;')"
COUNT_ASSERTIONS_2="$(query_scalar 'MATCH (a:Assertion) RETURN count(a) AS c;')"
COUNT_MENTIONS_2="$(query_scalar 'MATCH ()-[m:MENTIONED_IN]->() RETURN count(m) AS c;')"
echo "Second snapshot: $SIGNATURE2"

if [[ "$SIGNATURE1" != "$SIGNATURE2" ]]; then
  echo "Import snapshots are not identical:" >&2
  echo "  $SIGNATURE1" >&2
  echo "  $SIGNATURE2" >&2
  exit 1
fi

if [[ "$COUNT_PERSONS_1" -eq "$COUNT_PERSONS_2" && "$COUNT_ASSERTIONS_1" -eq "$COUNT_ASSERTIONS_2" && "$COUNT_MENTIONS_1" -eq "$COUNT_MENTIONS_2" ]]; then
  echo "Idempotent import check: PASS"
else
  echo "Idempotent import check: FAIL"
  exit 1
fi
