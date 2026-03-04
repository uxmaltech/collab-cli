export const mcpTemplate = `services:
  mcp:
    image: \${MCP_IMAGE}
    container_name: collab-mcp
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
  mcp:
    external: true
    name: \${MCP_VOLUME}
`;
