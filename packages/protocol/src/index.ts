export type JsonSchema = Record<string, unknown>;
export interface Principal {
  appId: string;
  tenantId: string;
  userId: string;
  permissions: string[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  kind: 'read' | 'write';
  permissions: string[];
  confirmation: boolean;
  timeoutMs: number;
}
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
export interface ToolResult {
  tool: string;
  data: unknown;
  durationMs: number;
}
export interface Proposal {
  id: string;
  calls: ToolCall[];
  expiresAt: string;
  status: 'pending' | 'executing' | 'succeeded' | 'cancelled' | 'failed' | 'unknown';
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  results?: ToolResult[];
  proposal?: Proposal;
  error?: boolean;
}
export interface Conversation {
  id: string;
  messages: Message[];
}
export type StreamEvent =
  | { type: 'status'; content: string }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'error'; content: string };
export interface ApplicationContext {
  page?: string;
  selectedIds?: string[];
  [key: string]: unknown;
}
