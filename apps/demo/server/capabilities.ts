import type { HttpTool } from '@nli/backend';

const string = { type: 'string' };
export const customerSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'contact',
    'email',
    'industry',
    'status',
    'lastContact',
    'value',
    'owner',
    'color',
  ],
  properties: {
    id: string,
    name: string,
    contact: string,
    email: string,
    industry: string,
    status: { enum: ['Active', 'At risk', 'Prospect'] },
    lastContact: string,
    value: { type: 'number' },
    owner: string,
    color: string,
  },
};
export const taskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'customerId', 'customerName', 'title', 'status', 'createdAt'],
  properties: {
    id: string,
    customerId: string,
    customerName: string,
    title: string,
    status: { enum: ['Open', 'Done'] },
    createdAt: string,
  },
};
export const opportunitySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'customerId',
    'customerName',
    'title',
    'value',
    'stage',
    'probability',
    'closeDate',
  ],
  properties: {
    id: string,
    customerId: string,
    customerName: string,
    title: string,
    value: { type: 'number' },
    stage: string,
    probability: { type: 'number' },
    closeDate: string,
  },
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const records = (schema: Record<string, unknown>) =>
  object({ records: { type: 'array', items: schema }, total: { type: 'integer' } }, [
    'records',
    'total',
  ]);

export function crmCapabilities(origin: string): HttpTool[] {
  const base = {
    kind: 'read' as const,
    permissions: ['crm:read'],
    confirmation: false,
    timeoutMs: 8000,
  };
  return [
    {
      ...base,
      name: 'customers_search',
      description:
        'Search customers by name, status or days since last contact. Returns ordered customer records and IDs. Use inactiveDays=30 for customers not contacted in 30 days.',
      inputSchema: object({
        query: { type: 'string', maxLength: 100 },
        inactiveDays: { type: 'integer', minimum: 0, maximum: 3650 },
        status: { enum: ['Active', 'At risk', 'Prospect'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      }),
      outputSchema: records(customerSchema),
      endpoint: `${origin}/tools/customers/search`,
    },
    {
      ...base,
      name: 'customer_activity',
      description:
        'Retrieve recent activities for one customer by exact customer ID. Search customers first if the ID is unknown.',
      inputSchema: object({ customerId: { type: 'string', maxLength: 100 } }, ['customerId']),
      outputSchema: object(
        {
          customerName: string,
          records: {
            type: 'array',
            items: object({ date: string, type: string, description: string }, [
              'date',
              'type',
              'description',
            ]),
          },
        },
        ['customerName', 'records'],
      ),
      endpoint: `${origin}/tools/customers/activity`,
    },
    {
      ...base,
      name: 'opportunities_list',
      description:
        'List opportunities ordered by probability to close. Optionally restrict to the current month.',
      inputSchema: object({ thisMonth: { type: 'boolean' } }),
      outputSchema: records(opportunitySchema),
      endpoint: `${origin}/tools/opportunities/list`,
    },
    {
      ...base,
      name: 'tasks_list',
      description: 'List existing follow-up tasks, optionally filtering by Open or Done status.',
      inputSchema: object({ status: { enum: ['Open', 'Done'] } }),
      outputSchema: records(taskSchema),
      endpoint: `${origin}/tools/tasks/list`,
    },
    {
      ...base,
      name: 'tasks_create',
      description:
        'Create follow-up tasks for 1 to 10 explicitly selected customer IDs, with a task title. The host validates ownership and creates the batch atomically.',
      kind: 'write',
      permissions: ['crm:read', 'tasks:write'],
      confirmation: true,
      inputSchema: object(
        {
          customerIds: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            uniqueItems: true,
            items: { type: 'string', maxLength: 100 },
          },
          title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
        },
        ['customerIds', 'title'],
      ),
      outputSchema: records(taskSchema),
      endpoint: `${origin}/tools/tasks/create`,
    },
  ];
}
