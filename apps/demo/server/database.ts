import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { NliError, type Principal } from '@nli/backend';

export interface Customer {
  id: string;
  name: string;
  contact: string;
  email: string;
  industry: string;
  status: 'Active' | 'At risk' | 'Prospect';
  lastContact: string;
  value: number;
  owner: string;
  color: string;
}
export interface Task {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  status: 'Open' | 'Done';
  createdAt: string;
}
export interface Opportunity {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  value: number;
  stage: string;
  probability: number;
  closeDate: string;
}
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
export class CrmDatabase {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY, tenant TEXT NOT NULL, customer TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS executions(key TEXT PRIMARY KEY, request TEXT NOT NULL, result TEXT NOT NULL);`);
    if (!(this.db.prepare('SELECT COUNT(*) AS count FROM customers').get()!.count as number))
      this.seed();
  }
  private seed() {
    const rows: [string, string, string, Customer['status'], number, number, string][] = [
      ['Acme Corporation', 'Olivia Chen', 'Technology', 'Active', 42, 48000, '#6d64c8'],
      ['Layers', 'James Wilson', 'Design', 'Active', 8, 24000, '#a85c43'],
      ['Sisyphus', 'Amara Okafor', 'Technology', 'At risk', 67, 36000, '#488c77'],
      ['Circooles', 'Noah Williams', 'Finance', 'Active', 35, 72000, '#5577b3'],
      ['Catalog', 'Sofia Martinez', 'Commerce', 'Prospect', 5, 18000, '#bc6c92'],
      ['Quotient', 'Liam Anderson', 'Analytics', 'Active', 51, 54000, '#bf8d39'],
      ['Hourglass', 'Emma Thompson', 'Operations', 'At risk', 78, 30000, '#6a839d'],
      ['Command+R', 'Ethan Park', 'Technology', 'Active', 12, 42000, '#8758a5'],
      ['Goodwell', 'Maya Patel', 'Healthcare', 'Prospect', 3, 15000, '#469a91'],
      ['Northstar', 'Lucas Brown', 'Logistics', 'Active', 24, 60000, '#747a40'],
    ];
    for (const [index, [name, contact, industry, status, days, value, color]] of rows.entries()) {
      const customer: Customer = {
        id: `cus_${index + 1}`,
        name,
        contact,
        email: `${contact.split(' ')[0].toLowerCase()}@${name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
        industry,
        status,
        lastContact: daysAgo(days),
        value,
        owner: 'Alex Morgan',
        color,
      };
      this.db
        .prepare('INSERT INTO customers VALUES(?,?,?)')
        .run(customer.id, 'meridian-demo', JSON.stringify(customer));
      for (const [i, [type, description]] of [
        ['Email', `Sent ${contact.split(' ')[0]} a proposal for the next renewal.`],
        ['Meeting', 'Discussed onboarding progress and the team’s next priorities.'],
        ['Note', 'Requested a follow-up on the updated implementation timeline.'],
      ].entries()) {
        this.db
          .prepare('INSERT INTO activities VALUES(?,?,?,?)')
          .run(
            randomUUID(),
            'meridian-demo',
            customer.id,
            JSON.stringify({ date: daysAgo(days + i * 7), type, description }),
          );
      }
      if (index < 6) {
        const now = new Date();
        const closeDate = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 25 + index),
        ).toISOString();
        const opp: Opportunity = {
          id: `opp_${index + 1}`,
          customerId: customer.id,
          customerName: name,
          title: `${name} · annual expansion`,
          value,
          stage: index % 2 ? 'Proposal' : 'Negotiation',
          probability: 90 - index * 8,
          closeDate,
        };
        this.db
          .prepare('INSERT INTO opportunities VALUES(?,?,?)')
          .run(opp.id, 'meridian-demo', JSON.stringify(opp));
      }
    }
    const initialTask: Task = {
      id: 'task_initial',
      customerId: 'cus_2',
      customerName: 'Layers',
      title: 'Send the onboarding checklist',
      status: 'Open',
      createdAt: daysAgo(1),
    };
    this.db
      .prepare('INSERT INTO tasks VALUES(?,?,?)')
      .run(initialTask.id, 'meridian-demo', JSON.stringify(initialTask));
  }
  customers(p: Principal): Customer[] {
    return this.db
      .prepare('SELECT data FROM customers WHERE tenant=? ORDER BY rowid')
      .all(p.tenantId)
      .map((row) => JSON.parse(row.data as string));
  }
  search(
    p: Principal,
    args: { query?: string; inactiveDays?: number; status?: string; limit?: number },
  ) {
    const records = this.customers(p).filter(
      (c) =>
        (!args.query ||
          `${c.name} ${c.contact}`.toLowerCase().includes(args.query.toLowerCase())) &&
        (!args.status || c.status === args.status) &&
        (args.inactiveDays === undefined ||
          Date.now() - Date.parse(c.lastContact) >= args.inactiveDays * 86400000),
    );
    return { records: records.slice(0, args.limit ?? 50), total: records.length };
  }
  activity(p: Principal, customerId: string) {
    const customer = this.customers(p).find((c) => c.id === customerId);
    if (!customer) throw new NliError('NOT_FOUND', 'Customer not found.', 404);
    return {
      customerName: customer.name,
      records: this.db
        .prepare('SELECT data FROM activities WHERE tenant=? AND customer=? ORDER BY rowid')
        .all(p.tenantId, customerId)
        .map((row) => JSON.parse(row.data as string)),
    };
  }
  opportunities(p: Principal, thisMonth?: boolean) {
    const month = new Date().toISOString().slice(0, 7);
    const records = (
      this.db
        .prepare('SELECT data FROM opportunities WHERE tenant=?')
        .all(p.tenantId)
        .map((row) => JSON.parse(row.data as string)) as Opportunity[]
    )
      .filter((o) => !thisMonth || o.closeDate.startsWith(month))
      .sort((a, b) => b.probability - a.probability);
    return { records, total: records.length };
  }
  tasks(p: Principal, status?: Task['status']) {
    const all = this.db
      .prepare('SELECT data FROM tasks WHERE tenant=? ORDER BY rowid DESC')
      .all(p.tenantId)
      .map((row) => JSON.parse(row.data as string)) as Task[];
    const records = all.filter((task) => !status || task.status === status);
    return { records, total: records.length };
  }
  createTasks(
    p: Principal,
    args: { customerIds: string[]; title: string },
    idempotencyKey: string,
  ) {
    const key = JSON.stringify([p.appId, p.tenantId, p.userId, 'tasks_create', idempotencyKey]);
    const fingerprint = JSON.stringify(args);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db
        .prepare('SELECT request,result FROM executions WHERE key=?')
        .get(key);
      if (previous) {
        if (previous.request !== fingerprint)
          throw new NliError(
            'IDEMPOTENCY_CONFLICT',
            'This key was already used for a different request.',
            409,
          );
        this.db.exec('COMMIT');
        return JSON.parse(previous.result as string);
      }
      const customers = args.customerIds.map((id) => this.customers(p).find((c) => c.id === id));
      if (customers.some((c) => !c))
        throw new NliError(
          'NOT_FOUND',
          'One or more customers are not available in this workspace.',
          404,
        );
      const records: Task[] = customers.map((c) => ({
        id: randomUUID(),
        customerId: c!.id,
        customerName: c!.name,
        title: args.title.trim(),
        status: 'Open',
        createdAt: new Date().toISOString(),
      }));
      for (const task of records)
        this.db
          .prepare('INSERT INTO tasks VALUES(?,?,?)')
          .run(task.id, p.tenantId, JSON.stringify(task));
      const result = { records, total: records.length };
      this.db
        .prepare('INSERT INTO executions VALUES(?,?,?)')
        .run(key, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  completeTask(p: Principal, id: string) {
    const task = this.tasks(p).records.find((t) => t.id === id);
    if (!task) throw new NliError('NOT_FOUND', 'Task not found.', 404);
    task.status = 'Done';
    this.db
      .prepare('UPDATE tasks SET data=? WHERE id=? AND tenant=?')
      .run(JSON.stringify(task), id, p.tenantId);
    return task;
  }
  close() {
    this.db.close();
  }
}
