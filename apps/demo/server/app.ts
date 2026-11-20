import express, { type ErrorRequestHandler } from 'express';
import Ajv from 'ajv';
import { issueToken, verifyToken, NliError, type Principal } from '@nli/backend';
import { CrmDatabase } from './database.js';
import { crmCapabilities } from './capabilities.js';

export const demoPrincipal: Principal = {
  appId: 'meridian',
  tenantId: 'meridian-demo',
  userId: 'alex-morgan',
  permissions: ['crm:read', 'tasks:write'],
};
export function createDemoHost(
  db: CrmDatabase,
  secrets: { sessionSecret: string; adapterSecret: string },
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Local sandbox only. A real host must derive this principal from its own login session.
  app.post('/api/session', async (req, res) => {
    if (
      req.headers.origin &&
      !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(req.headers.origin)
    )
      return res.sendStatus(403);
    const hostname = req.hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return res.sendStatus(403);
    res.json({
      token: await issueToken(demoPrincipal, secrets.sessionSecret),
      hostToken: await issueToken(demoPrincipal, secrets.sessionSecret, 'demo-ui'),
      user: { id: demoPrincipal.userId, name: 'Alex Morgan', workspace: 'Meridian workspace' },
    });
  });
  app.use('/api', async (req, res, next) => {
    try {
      const p = await verifyToken(
        req.headers.authorization?.replace(/^Bearer /, '') ?? '',
        secrets.sessionSecret,
        'demo-ui',
      );
      if (p.appId !== 'meridian' || !p.permissions.includes('crm:read'))
        throw new NliError('FORBIDDEN', 'Not authorized.', 403);
      res.locals.principal = p;
      next();
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/customers', (_req, res) => res.json(db.search(res.locals.principal, {})));
  app.get('/api/opportunities', (_req, res) => res.json(db.opportunities(res.locals.principal)));
  app.get('/api/tasks', (_req, res) => res.json(db.tasks(res.locals.principal)));
  app.post('/api/tasks/:id/complete', (req, res) => {
    if (!res.locals.principal.permissions.includes('tasks:write'))
      throw new NliError('FORBIDDEN', 'Not authorized.', 403);
    res.json(db.completeTask(res.locals.principal, req.params.id));
  });
  const ajv = new Ajv();
  for (const tool of crmCapabilities('http://127.0.0.1:4101')) {
    const validate = ajv.compile(tool.inputSchema);
    app.post(new URL(tool.endpoint).pathname, async (req, res, next) => {
      try {
        const p = await verifyToken(
          req.headers.authorization?.replace(/^Bearer /, '') ?? '',
          secrets.adapterSecret,
          'nli-host',
        );
        if (
          p.appId !== 'meridian' ||
          !tool.permissions.every((permission) => p.permissions.includes(permission))
        )
          throw new NliError('FORBIDDEN', 'Not authorized.', 403);
        if (!validate(req.body)) throw new NliError('INVALID_ARGUMENTS', 'Invalid tool arguments.');
        const args = req.body as Record<string, unknown>;
        switch (tool.name) {
          case 'customers_search':
            return res.json(db.search(p, args as Parameters<CrmDatabase['search']>[1]));
          case 'customer_activity':
            return res.json(db.activity(p, args.customerId as string));
          case 'opportunities_list':
            return res.json(db.opportunities(p, args.thisMonth as boolean));
          case 'tasks_list':
            return res.json(db.tasks(p, args.status as 'Open' | 'Done' | undefined));
          case 'tasks_create': {
            const key = req.header('Idempotency-Key');
            if (!key || key.length > 150)
              throw new NliError('INVALID_KEY', 'An idempotency key is required.');
            return res.json(
              db.createTasks(p, args as Parameters<CrmDatabase['createTasks']>[1], key),
            );
          }
        }
      } catch (error) {
        next(error);
      }
    });
  }
  app.use(((error, _req, res, _next) =>
    res.status(error instanceof NliError ? error.status : 500).json({
      error: error instanceof NliError ? error.message : 'Host application error.',
    })) as ErrorRequestHandler);
  return app;
}
