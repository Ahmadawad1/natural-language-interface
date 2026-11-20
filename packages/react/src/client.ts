import type { ApplicationContext, Conversation, StreamEvent, ToolDefinition } from '@nli/protocol';
export interface ClientOptions {
  endpoint: string;
  appId: string;
  getToken: () => Promise<string>;
}
export class NliClient {
  constructor(private options: ClientOptions) {}
  private async request(path: string, init: RequestInit = {}) {
    const token = await this.options.getToken();
    const response = await fetch(`${this.options.endpoint.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-NLI-App-Id': this.options.appId,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Runtime request failed (${response.status}).`);
    }
    return response;
  }
  async createConversation(): Promise<Conversation> {
    return (await this.request('/v1/conversations', { method: 'POST' })).json();
  }
  async getConversation(id: string): Promise<Conversation> {
    return (await this.request(`/v1/conversations/${encodeURIComponent(id)}`)).json();
  }
  async capabilities(): Promise<{ tools: ToolDefinition[]; planner: string }> {
    return (await this.request('/v1/capabilities')).json();
  }
  async send(
    id: string,
    body: {
      message?: string;
      confirmation?: { proposalId: string; decision: 'confirm' | 'cancel' };
      context?: ApplicationContext;
      locale?: string;
    },
    onEvent: (event: StreamEvent) => void,
  ) {
    const response = await this.request(`/v1/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      headers: { Accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
    });
    if (response.headers.get('Content-Type')?.includes('application/x-ndjson'))
      await readEvents(response, onEvent);
    else onEvent({ type: 'conversation', conversation: (await response.json()) as Conversation });
  }
}
export async function readEvents(response: Response, onEvent: (event: StreamEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The runtime returned an empty response.');
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === 'conversation' || event.type === 'error') terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      lines.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!terminal)
      throw new Error(
        'The connection ended before the result arrived. Reload the conversation before retrying a change.',
      );
  } finally {
    reader.releaseLock();
  }
}
