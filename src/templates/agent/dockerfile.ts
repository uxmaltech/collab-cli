import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentDockerfileTemplate(_options: AgentBootstrapOptions): string {
  return `FROM node:22-alpine

WORKDIR /workspace

COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
COPY .collab ./.collab
COPY fixtures ./fixtures
COPY docs ./docs
COPY skills ./skills

CMD ["node", "index.js", "development"]
`;
}
