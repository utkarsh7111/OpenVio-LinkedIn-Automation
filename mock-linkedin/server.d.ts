import type { Server } from 'node:http';

export interface MockState {
  authorizationCodes: Map<string, any>;
  tokens: Map<string, any>;
  images: Map<string, any>;
  videos: Map<string, any>;
  documents: Map<string, any>;
  uploads: Map<string, any>;
  posts: Map<string, any>;
  failures: any[];
}

export interface MockServer extends Server {
  mockState: MockState;
}

export interface MockServerOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  latencyMs?: number;
  dropConnections?: boolean;
}

export function createMockServer(options?: MockServerOptions): MockServer;
