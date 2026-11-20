import express, { type ErrorRequestHandler, type Request } from 'express';
import Ajv from 'ajv';
import { NliError, verifyToken } from '@nli/backend';
import type { Principal } from '@nli/protocol';
import { RuntimeEngine } from './engine.js';
export { RuntimeEngine } from './engine.js';
export { RuntimeStore } from './store.js';
export { OllamaPlanner } from './planner.js';
export type { Planner, PlannerInput, Plan } from './planner.js';

export function createRuntimeApp(
  engine: RuntimeEngine,
  options: { sessionSecret: string; allowedOrigins: string[] },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    if (origin) {
      if (!options.allowedOrigins.includes(origin))
        return res.status(403).json({ error: 'Origin is not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NLI-App-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', planner: engine.planner.name, version: '0.1.0' }),
  );
  app.use(express.json({ limit: '32kb' }));
  const principals = new WeakMap<Request, Principal>();
  const buckets = new Map<string, { count: number; reset: number }>();
  app.use('/v1', async (req, res, next) => {
    try {
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer '))
        throw new NliError('UNAUTHENTICATED', 'Sign in to use the assistant.', 401);
      const p = await verifyToken(auth.slice(7), options.sessionSecret);
      if (req.header('X-NLI-App-Id') && req.header('X-NLI-App-Id') !== p.appId)
        throw new NliError('FORBIDDEN', 'Application context does not match your session.', 403);
      principals.set(req, p);
      const now = Date.now();
      for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
      const key = JSON.stringify([p.appId, p.tenantId, p.userId]);
      const bucket = buckets.get(key) ?? { count: 0, reset: now + 60000 };
      bucket.count++;
      buckets.set(key, bucket);
      if (bucket.count > 60) {
        res.setHeader('Retry-After', '60');
        throw new NliError('RATE_LIMITED', 'Too many requests. Try again in a minute.', 429);
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get('/v1/capabilities', (req, res) =>
    res.json({
      tools: engine.registry.available(principals.get(req)!),
      planner: engine.planner.name,
    }),
  );
  app.post('/v1/conversations', (req, res) =>
    res.status(201).json(engine.store.create(principals.get(req)!)),
  );
  app.get('/v1/conversations/:id', (req, res) =>
    res.json(engine.store.get(principals.get(req)!, req.params.id)),
  );
  const validate = new Ajv().compile({
    type: 'object',
    additionalProperties: false,
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' },
      locale: { type: 'string', maxLength: 50 },
      context: { type: 'object', maxProperties: 20 },
      confirmation: {
        type: 'object',
        additionalProperties: false,
        required: ['proposalId', 'decision'],
        properties: {
          proposalId: { type: 'string', maxLength: 100 },
          decision: { enum: ['confirm', 'cancel'] },
        },
      },
    },
    oneOf: [
      { required: ['message'], not: { required: ['confirmation'] } },
      { required: ['confirmation'], not: { required: ['message'] } },
    ],
  });
  app.post('/v1/conversations/:id/messages', async (req, res, next) => {
    try {
      if (!validate(req.body))
        throw new NliError(
          'INVALID_REQUEST',
          'Provide a message (1–4000 characters) or an explicit action confirmation.',
        );
      const p = principals.get(req)!;
      engine.store.get(p, req.params.id);
      if (req.headers.accept?.includes('application/x-ndjson')) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const heartbeat = setInterval(() => {
          if (!res.destroyed) res.write('\n');
        }, 10000);
        try {
          await engine.turn(p, req.params.id, req.body, (event) => {
            if (!res.destroyed) res.write(JSON.stringify(event) + '\n');
          });
        } catch (error) {
          if (!res.destroyed)
            res.write(
              JSON.stringify({
                type: 'error',
                content: error instanceof NliError ? error.message : 'Request failed.',
              }) + '\n',
            );
        } finally {
          clearInterval(heartbeat);
          res.end();
        }
      } else res.json(await engine.turn(p, req.params.id, req.body));
    } catch (error) {
      next(error);
    }
  });
  app.use(((error, _req, res, _next) => {
    const status =
      error instanceof NliError
        ? error.status
        : error.status === 413
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 500;
    res
      .status(status)
      .json({
        error:
          error instanceof NliError
            ? error.message
            : status === 500
              ? 'An internal error occurred.'
              : 'Invalid request body.',
      });
  }) as ErrorRequestHandler);
  return app;
}
