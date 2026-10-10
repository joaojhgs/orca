#!/bin/bash
# Installed beside the standalone plugin; no OAuth or external paid credentials.
set -euo pipefail
memory_profile=/home/developer/.hermes/profiles/orca-manager
IFS= read -r HINDSIGHT_API_LLM_API_KEY < "$memory_profile/memory-bridge.key"
IFS= read -r HINDSIGHT_API_TENANT_API_KEY < "$memory_profile/memory-api.key"
export HINDSIGHT_API_LLM_API_KEY HINDSIGHT_API_TENANT_API_KEY
export HINDSIGHT_API_TENANT_EXTENSION=hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension
export HINDSIGHT_API_DATABASE_URL='postgresql://developer@/hermes_orca_memory?host=/var/run/postgresql'
export HINDSIGHT_API_LLM_PROVIDER=openai
export HINDSIGHT_API_LLM_BASE_URL=http://127.0.0.1:8789/v1
export HINDSIGHT_API_LLM_MODEL=hermes-memory
export HINDSIGHT_API_LLM_MAX_CONCURRENT=1
export HINDSIGHT_API_LLM_MAX_RETRIES=1
export HINDSIGHT_API_LLM_TIMEOUT=120
export HINDSIGHT_API_REFLECT_LLM_TIMEOUT=120
export HINDSIGHT_API_EMBEDDINGS_PROVIDER=local
export HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-en-v1.5
export HINDSIGHT_API_RERANKER_PROVIDER=local
export HINDSIGHT_API_WORKER_ID=hermes-orca-manager-memory
export HINDSIGHT_API_WORKER_MAX_SLOTS=1
export HINDSIGHT_API_WORKER_CONSOLIDATION_RESERVED_SLOTS=0
export HINDSIGHT_API_DB_POOL_MIN_SIZE=1
export HINDSIGHT_API_DB_POOL_MAX_SIZE=4
export HF_HUB_DISABLE_TELEMETRY=1
export TOKENIZERS_PARALLELISM=false
export OMP_NUM_THREADS=1
export MKL_NUM_THREADS=1
exec /home/developer/.local/bin/hindsight-api --host 127.0.0.1 --port 8788 --workers 1
