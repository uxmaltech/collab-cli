export const consolidatedTemplate = `services:
  qdrant:
    image: \${QDRANT_IMAGE}

    ports:
      - "\${QDRANT_PORT}:6333"
    volumes:
      - qdrant:/qdrant/storage
    networks:
      - collab

  metad0:
    image: "vesoft/nebula-metad:\${NEBULA_VERSION}"

    ports:
      - "\${NEBULA_METAD_PORT}:9559"
      - "\${NEBULA_METAD_HTTP_PORT}:19559"
    volumes:
      - nebula-metad0:/usr/local/nebula/data/meta
    command:
      - nebula-metad
      - --meta_server_addrs=metad0:9559
      - --local_ip=metad0
      - --ws_ip=metad0
      - --port=9559
      - --ws_http_port=19559
      - --data_path=/usr/local/nebula/data/meta
    networks:
      - collab

  storaged0:
    image: "vesoft/nebula-storaged:\${NEBULA_VERSION}"

    depends_on:
      - metad0
    ports:
      - "\${NEBULA_STORAGED_PORT}:9779"
      - "\${NEBULA_STORAGED_HTTP_PORT}:19779"
    volumes:
      - nebula-storaged0:/usr/local/nebula/data/storage
    command:
      - nebula-storaged
      - --meta_server_addrs=metad0:9559
      - --local_ip=storaged0
      - --ws_ip=storaged0
      - --port=9779
      - --ws_http_port=19779
      - --data_path=/usr/local/nebula/data/storage
    networks:
      - collab

  graphd:
    image: "vesoft/nebula-graphd:\${NEBULA_VERSION}"

    depends_on:
      - metad0
      - storaged0
    ports:
      - "\${NEBULA_GRAPHD_PORT}:9669"
      - "\${NEBULA_GRAPHD_HTTP_PORT}:19669"
    command:
      - nebula-graphd
      - --meta_server_addrs=metad0:9559
      - --local_ip=graphd
      - --ws_ip=graphd
      - --port=9669
      - --ws_http_port=19669
      - --max_sessions_per_ip_per_user=10000
    networks:
      - collab

  mcp:
    image: \${MCP_IMAGE}

    depends_on:
      - qdrant
      - graphd
    ports:
      - "\${MCP_PORT}:\${MCP_CONTAINER_PORT}"
    environment:
      MCP_HOST: "0.0.0.0"
      MCP_ENV: \${MCP_ENV}
      MCP_API_KEYS: \${MCP_API_KEYS}
      MCP_TECHNICAL_SCOPES: \${MCP_TECHNICAL_SCOPES}
      QDRANT_URL: http://qdrant:6333
      NEBULA_ADDR: graphd
      NEBULA_PORT: 9669
    volumes:
      - mcp:/app/.collab
    networks:
      - collab

networks:
  collab:
    external: true
    name: \${COLLAB_NETWORK}

volumes:
  qdrant:
    external: true
    name: \${QDRANT_VOLUME}
  nebula-metad0:
    external: true
    name: \${NEBULA_METAD_VOLUME}
  nebula-storaged0:
    external: true
    name: \${NEBULA_STORAGED_VOLUME}
  mcp:
    external: true
    name: \${MCP_VOLUME}
`;
