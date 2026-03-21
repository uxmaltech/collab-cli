import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentComposeTemplate(options: AgentBootstrapOptions): string {
  return `services:
  agent:
    image: \${COLLAB_AGENT_IMAGE:-${options.agentSlug}:dev}
    build:
      context: ..
      dockerfile: Dockerfile
    env_file:
      - ../.env
    working_dir: /workspace
    volumes:
      - ..:/workspace
    command: ["node", "index.js", "development"]
    environment:
      COLLAB_AGENT_PROVIDER: \${COLLAB_AGENT_PROVIDER:-${options.provider}}
      COLLAB_AGENT_AUTH_METHOD: \${COLLAB_AGENT_AUTH_METHOD:-${options.providerAuthMethod}}
      COLLAB_AGENT_MODEL: \${COLLAB_AGENT_MODEL:-${options.model ?? ''}}
      COGNITIVE_MCP_URL: \${COGNITIVE_MCP_URL:-${options.cognitiveMcpUrl}}
      REDIS_URL: \${REDIS_URL:-${options.redisUrl}}
      TELEGRAM_BOT_TOKEN: \${TELEGRAM_BOT_TOKEN:-}
      TELEGRAM_DEFAULT_CHAT_ID: \${TELEGRAM_DEFAULT_CHAT_ID:-}
      TELEGRAM_THREAD_ID: \${TELEGRAM_THREAD_ID:-}
    restart: unless-stopped
`;
}

export function infraComposeTemplate(_options: AgentBootstrapOptions): string {
  return `services:
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "\${REDIS_PASSWORD:-collab-dev-redis}"]
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant-data:/qdrant/storage

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ACCESS_KEY:-collabminio}
      MINIO_ROOT_PASSWORD: \${MINIO_SECRET_KEY:-collabminiosecret}
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data

  nebula-metad:
    image: vesoft/nebula-metad:v3.8.0
    command: ["--local_ip=nebula-metad", "--ws_ip=nebula-metad", "--port=9559", "--data_path=/data/meta"]
    ports:
      - "9559:9559"
    volumes:
      - nebula-meta-data:/data/meta

  nebula-storaged:
    image: vesoft/nebula-storaged:v3.8.0
    command: ["--local_ip=nebula-storaged", "--ws_ip=nebula-storaged", "--port=9779", "--data_path=/data/storage", "--meta_server_addrs=nebula-metad:9559"]
    depends_on:
      - nebula-metad
    ports:
      - "9779:9779"
    volumes:
      - nebula-storage-data:/data/storage

  nebula-graphd:
    image: vesoft/nebula-graphd:v3.8.0
    command: ["--local_ip=nebula-graphd", "--port=9669", "--meta_server_addrs=nebula-metad:9559"]
    depends_on:
      - nebula-metad
      - nebula-storaged
    ports:
      - "9669:9669"

volumes:
  redis-data:
  qdrant-data:
  minio-data:
  nebula-meta-data:
  nebula-storage-data:
`;
}

export function mcpComposeTemplate(_options: AgentBootstrapOptions): string {
  return `services:
  cognitive-mcp:
    image: \${COGNITIVE_MCP_IMAGE:-ghcr.io/uxmaltech/collab-architecture-mcp:latest}
    env_file:
      - ../.env
    environment:
      MCP_HOST: 0.0.0.0
      MCP_PORT: 7337
      REDIS_URL: \${REDIS_URL:-redis://:\${REDIS_PASSWORD:-collab-dev-redis}@redis:6379}
      QDRANT_URL: http://qdrant:6333
      QDRANT_API_KEY: ""
      NEBULA_GRAPHD_ADDRESS: nebula-graphd:9669
      NEBULA_USERNAME: root
      NEBULA_PASSWORD: nebula
      MINIO_ENDPOINT: http://minio:9000
      MINIO_ACCESS_KEY: collabminio
      MINIO_SECRET_KEY: collabminiosecret
      MINIO_BUCKET: collab
      COGNITIVE_MCP_API_KEY: \${COGNITIVE_MCP_API_KEY:-}
      MCP_ENV: \${COGNITIVE_MCP_ENV:-local}
    ports:
      - "\${COGNITIVE_MCP_PORT:-8787}:7337"
    depends_on:
      - redis
      - qdrant
      - minio
      - nebula-graphd
`;
}
