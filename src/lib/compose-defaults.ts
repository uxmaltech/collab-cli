import type { EnvMap } from './env-file';

export const COMPOSE_ENV_DEFAULTS: EnvMap = {
  COLLAB_NETWORK: 'collab-network',
  QDRANT_HOST: '127.0.0.1',
  QDRANT_IMAGE: 'qdrant/qdrant:v1.13.4',
  QDRANT_PORT: '6333',
  QDRANT_VOLUME: 'collab-qdrant-data',
  NEBULA_HOST: '127.0.0.1',
  NEBULA_VERSION: 'v3.6.0',
  NEBULA_METAD_PORT: '9559',
  NEBULA_METAD_HTTP_PORT: '19559',
  NEBULA_STORAGED_PORT: '9779',
  NEBULA_STORAGED_HTTP_PORT: '19779',
  NEBULA_GRAPHD_PORT: '9669',
  NEBULA_GRAPHD_HTTP_PORT: '19669',
  NEBULA_METAD_VOLUME: 'collab-nebula-metad0',
  NEBULA_STORAGED_VOLUME: 'collab-nebula-storaged0',
  MCP_HOST: '127.0.0.1',
  MCP_IMAGE: 'ghcr.io/uxmaltech/collab-architecture-mcp:latest',
  MCP_PORT: '7337',
  MCP_CONTAINER_PORT: '7337',
  MCP_VOLUME: 'collab-mcp-data',
  MCP_ENV: 'local',
  MCP_API_KEYS: '',
};

export const COMPOSE_ENV_ORDER = Object.keys(COMPOSE_ENV_DEFAULTS);
