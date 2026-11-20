import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Conversation, Message, Principal, Proposal, ToolCall } from '@nli/protocol';
import { NliError } from '@nli/backend';

/** SQLite store for a single runtime process. Deploy one instance per database. */
export class RuntimeStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, app TEXT NOT NULL, tenant TEXT NOT NULL, actor TEXT NOT NULL, messages TEXT NOT NULL, busy_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, calls TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, app TEXT NOT NULL, tenant TEXT NOT NULL, actor TEXT NOT NULL, conversation TEXT NOT NULL, event TEXT NOT NULL, detail TEXT NOT NULL);`);
    // A process interruption during a write has an unknown outcome. Never replay it.
    this.db.exec(
      "UPDATE proposals SET status='unknown' WHERE status='executing'; UPDATE conversations SET busy_until=0;",
    );
  }
  create(p: Principal): Conversation {
    const conversation = { id: randomUUID(), messages: [] };
    this.db
      .prepare('INSERT INTO conversations(id,app,tenant,actor,messages) VALUES(?,?,?,?,?)')
      .run(conversation.id, p.appId, p.tenantId, p.userId, '[]');
    return conversation;
  }
  get(p: Principal, id: string): Conversation {
    const row = this.db
      .prepare('SELECT messages FROM conversations WHERE id=? AND app=? AND tenant=? AND actor=?')
      .get(id, p.appId, p.tenantId, p.userId);
    if (!row) throw new NliError('NOT_FOUND', 'Conversation not found.', 404);
    const messages = JSON.parse(row.messages as string) as Message[];
    for (const message of messages)
      if (message.proposal) message.proposal = this.proposal(id, message.proposal.id);
    return { id, messages };
  }
  lock(p: Principal, id: string) {
    this.get(p, id);
    const result = this.db
      .prepare('UPDATE conversations SET busy_until=? WHERE id=? AND busy_until<=?')
      .run(Date.now() + 600000, id, Date.now());
    if (!result.changes)
      throw new NliError('BUSY', 'A request is already running in this conversation.', 409);
  }
  unlock(id: string) {
    this.db.prepare('UPDATE conversations SET busy_until=0 WHERE id=?').run(id);
  }
  append(p: Principal, id: string, message: Message) {
    const c = this.get(p, id);
    c.messages.push(message);
    this.db
      .prepare('UPDATE conversations SET messages=? WHERE id=?')
      .run(JSON.stringify(c.messages), id);
  }
  pending(conversation: string): Proposal | undefined {
    const row = this.db
      .prepare(
        "SELECT id FROM proposals WHERE conversation=? AND status='pending' ORDER BY rowid DESC LIMIT 1",
      )
      .get(conversation);
    return row ? this.proposal(conversation, row.id as string) : undefined;
  }
  propose(conversation: string, calls: ToolCall[]): Proposal {
    this.cancelPending(conversation);
    const proposal: Proposal = {
      id: randomUUID(),
      calls,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      status: 'pending',
    };
    this.db
      .prepare('INSERT INTO proposals VALUES(?,?,?,?,?)')
      .run(
        proposal.id,
        conversation,
        JSON.stringify(calls),
        Date.parse(proposal.expiresAt),
        proposal.status,
      );
    return proposal;
  }
  proposal(conversation: string, id: string): Proposal {
    const row = this.db
      .prepare('SELECT * FROM proposals WHERE id=? AND conversation=?')
      .get(id, conversation);
    if (!row) throw new NliError('NOT_FOUND', 'Action not found.', 404);
    return {
      id,
      calls: JSON.parse(row.calls as string),
      expiresAt: new Date(row.expires as number).toISOString(),
      status: row.status as Proposal['status'],
    };
  }
  claim(conversation: string, id: string) {
    const result = this.db
      .prepare(
        "UPDATE proposals SET status='executing' WHERE id=? AND conversation=? AND status='pending' AND expires>?",
      )
      .run(id, conversation, Date.now());
    if (!result.changes)
      throw new NliError(
        'ACTION_EXPIRED',
        'This action has expired or has already been handled. Request a new proposal if needed.',
        409,
      );
    return this.proposal(conversation, id);
  }
  status(id: string, status: Proposal['status']) {
    this.db.prepare('UPDATE proposals SET status=? WHERE id=?').run(status, id);
  }
  cancelPending(conversation: string) {
    this.db
      .prepare("UPDATE proposals SET status='cancelled' WHERE conversation=? AND status='pending'")
      .run(conversation);
  }
  audit(p: Principal, conversation: string, event: string, detail: Record<string, unknown> = {}) {
    this.db
      .prepare(
        'INSERT INTO audit(at,app,tenant,actor,conversation,event,detail) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        new Date().toISOString(),
        p.appId,
        p.tenantId,
        p.userId,
        conversation,
        event,
        JSON.stringify(detail),
      );
  }
  close() {
    this.db.close();
  }
}
