-- Administrator-only, for the dedicated fresh coding-worker PostgreSQL cluster.
-- No network listener, no privileged application role, bounded connection/memory costs.
ALTER SYSTEM SET listen_addresses = '';
ALTER SYSTEM SET shared_buffers = '64MB';
ALTER SYSTEM SET max_connections = '16';
ALTER SYSTEM SET work_mem = '4MB';
SELECT 'CREATE ROLE developer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'developer') \gexec
SELECT 'CREATE DATABASE hermes_orca_memory OWNER developer'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hermes_orca_memory') \gexec
\connect hermes_orca_memory
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
REVOKE ALL ON DATABASE hermes_orca_memory FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE hermes_orca_memory TO developer;
