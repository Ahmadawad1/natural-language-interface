import Ajv from 'ajv';
import { SignJWT, jwtVerify } from 'jose';
import type { Principal, ToolDefinition, ToolCall, ToolResult } from '@nli/protocol';
export type { Principal, ToolDefinition } from '@nli/protocol';

export class NliError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const key = (secret: string) => {
  if (secret.length < 32) throw new Error('Signing secrets must be at least 32 characters.');
  return new TextEncoder().encode(secret);
};
export async function issueToken(
  principal: Principal,
  secret: string,
  audience = 'nli-runtime',
  expiresIn = '15m',
) {
  return new SignJWT({ ...principal })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('nli-host')
    .setAudience(audience)
    .setSubject(principal.userId)
    .setExpirationTime(expiresIn)
    .sign(key(secret));
}
export async function verifyToken(
  token: string,
  secret: string,
  audience = 'nli-runtime',
): Promise<Principal> {
  try {
    const { payload: p } = await jwtVerify(token, key(secret), {
      issuer: 'nli-host',
      audience,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    if (
      ![p.appId, p.tenantId, p.userId].every((v) => typeof v === 'string' && v.length > 0) ||
      p.sub !== p.userId ||
      !Array.isArray(p.permissions) ||
      !p.permissions.every((v) => typeof v === 'string')
    )
      throw new Error();
    return {
      appId: p.appId as string,
      tenantId: p.tenantId as string,
      userId: p.userId as string,
      permissions: p.permissions as string[],
    };
  } catch {
    throw new NliError('UNAUTHENTICATED', 'Your session has expired. Sign in again.', 401);
  }
}

export interface HttpTool extends ToolDefinition {
  endpoint: string;
  method?: 'POST';
}
export class ToolRegistry {
  private ajv = new Ajv({ allErrors: true, strict: true });
  private apps = new Map<
    string,
    Map<
      string,
      { tool: HttpTool; input: ReturnType<Ajv['compile']>; output: ReturnType<Ajv['compile']> }
    >
  >();
  constructor(
    private options: {
      allowedOrigins: string[];
      adapterSecret: string;
      allowInsecureLocalhost?: boolean;
      fetch?: typeof fetch;
    },
  ) {
    key(options.adapterSecret);
  }
  register(appId: string, tool: HttpTool) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new Error('Use a lowercase tool name.');
    const url = new URL(tool.endpoint);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      !this.options.allowedOrigins.includes(url.origin) ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && local && this.options.allowInsecureLocalhost)) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        'Tool endpoint must use an explicitly allowed HTTPS origin (or opted-in loopback HTTP).',
      );
    if (tool.kind === 'write' && !tool.confirmation)
      throw new Error('All write tools require confirmation.');
    if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 120000)
      throw new Error('Timeout must be between 100 and 120000ms.');
    if (!this.apps.has(appId)) this.apps.set(appId, new Map());
    const app = this.apps.get(appId)!;
    if (app.has(tool.name)) throw new Error('Tool names must be unique per application.');
    const copy = structuredClone(tool);
    app.set(tool.name, {
      tool: copy,
      input: this.ajv.compile(copy.inputSchema),
      output: this.ajv.compile(copy.outputSchema),
    });
    return this;
  }
  available(principal: Principal): ToolDefinition[] {
    return [...(this.apps.get(principal.appId)?.values() ?? [])]
      .filter(({ tool }) => tool.permissions.every((p) => principal.permissions.includes(p)))
      .map(({ tool: { endpoint: _endpoint, method: _method, ...definition } }) =>
        structuredClone(definition),
      );
  }
  validate(principal: Principal, call: ToolCall): HttpTool {
    const entry = this.apps.get(principal.appId)?.get(call.name);
    if (!entry || !entry.tool.permissions.every((p) => principal.permissions.includes(p)))
      throw new NliError('FORBIDDEN', 'This capability is not available for your account.', 403);
    if (!entry.input(call.arguments))
      throw new NliError(
        'INVALID_ARGUMENTS',
        `Invalid arguments for ${call.name}: ${this.ajv.errorsText(entry.input.errors)}`,
      );
    return structuredClone(entry.tool);
  }
  async execute(principal: Principal, call: ToolCall, executionId: string): Promise<ToolResult> {
    const tool = this.validate(principal, call);
    const started = Date.now();
    try {
      const response = await (this.options.fetch ?? fetch)(tool.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(tool.timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await issueToken(principal, this.options.adapterSecret, 'nli-host', '2m')}`,
          'Idempotency-Key': executionId,
        },
        body: JSON.stringify(call.arguments),
      });
      if (!response.ok)
        throw new NliError(
          'UPSTREAM_ERROR',
          `The application returned HTTP ${response.status}. No success has been reported.`,
          502,
        );
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty response');
      let size = 0;
      let text = '';
      const decoder = new TextDecoder();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1_000_000) throw new Error('Response too large');
          text += decoder.decode(part.value, { stream: true });
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data: unknown = JSON.parse(text + decoder.decode());
      const entry = this.apps.get(principal.appId)!.get(call.name)!;
      if (!entry.output(data))
        throw new NliError(
          'INVALID_OUTPUT',
          'The application returned data that does not match its registered contract.',
          502,
        );
      return { tool: call.name, data, durationMs: Date.now() - started };
    } catch (error) {
      if (error instanceof NliError) throw error;
      throw new NliError(
        'TOOL_UNAVAILABLE',
        'The application did not return a valid response in time. Check the application before retrying a change.',
        502,
      );
    }
  }
}
