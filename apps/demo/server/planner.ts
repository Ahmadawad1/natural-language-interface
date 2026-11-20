import type { Planner, PlannerInput, Plan } from '../../../packages/runtime/src/planner.js';

/** Deliberately narrow, offline demonstration. No generated business data. */
export class DemoPlanner implements Planner {
  name = 'demo';
  async plan(input: PlannerInput): Promise<Plan> {
    const text = input.message.toLowerCase().trim();
    const call = (name: string, args: Record<string, unknown> = {}): Plan =>
      input.tools.some((t) => t.name === name)
        ? { intent: 'tools', calls: [{ name, arguments: args }] }
        : {
            intent: 'unsupported',
            message: 'Your account does not have permission to use this capability.',
          };
    const lastCustomers = [...input.conversation.messages]
      .reverse()
      .flatMap((m) => m.results ?? [])
      .find((r) => r.tool === 'customers_search')?.data as
      { records: { id: string; name: string }[] } | undefined;
    if (/\b(create|add|draft)\b/.test(text) && /\b(tasks?|follow[ -]?ups?)\b/.test(text)) {
      let ids: string[] = [];
      const first = text.match(/first\s+(\d+|one|two|three|four|five)/);
      if (first && lastCustomers) {
        const count =
          Number(first[1]) || ({ one: 1, two: 2, three: 3, four: 4, five: 5 }[first[1]] ?? 0);
        if (count > 10)
          return { intent: 'clarify', message: 'Choose up to 10 customers per action.' };
        ids = lastCustomers.records.slice(0, count).map((c) => c.id);
      } else if (/\b(selected|selection)\b/.test(text)) ids = input.context.selectedIds ?? [];
      else if (/\b(these|them|those)\b/.test(text) && lastCustomers)
        ids = lastCustomers.records.map((c) => c.id);
      else if (lastCustomers)
        ids = lastCustomers.records
          .filter((c) => text.includes(c.name.toLowerCase()))
          .map((c) => c.id);
      if (!ids.length || ids.length > 10)
        return {
          intent: 'clarify',
          message:
            'Which customers should receive tasks? Search for customers first, then say “Create follow-up tasks for the first three,” or select up to 10 rows and ask for tasks for the selected customers.',
        };
      const title =
        input.message.match(/(?:titled|called)\s+[“"](.+?)[”"]/i)?.[1] ?? 'Follow up with customer';
      return call('tasks_create', { customerIds: ids, title });
    }
    if (/\b(activities|activity|summarize|summary)\b/.test(text)) {
      const customer =
        lastCustomers?.records.find((c) => text.includes(c.name.toLowerCase())) ??
        (lastCustomers?.records.length === 1 ? lastCustomers.records[0] : undefined);
      if (customer) return call('customer_activity', { customerId: customer.id });
      return {
        intent: 'clarify',
        message:
          'Search for the customer first (for example, “Find Acme”), then ask for their latest activities. This lets me use a verified customer ID.',
      };
    }
    if (/\b(opportunities|pipeline|deals|close this month)\b/.test(text))
      return call('opportunities_list', { thisMonth: /this month/.test(text) });
    if (/\b(tasks|to-do)\b/.test(text) && /\b(show|list|view|my|open)\b/.test(text))
      return call(
        'tasks_list',
        /\bopen\b/.test(text)
          ? { status: 'Open' }
          : /\b(done|completed)\b/.test(text)
            ? { status: 'Done' }
            : {},
      );
    if (/\b(customers?|accounts?|find|search)\b/.test(text)) {
      const days = text.match(/(\d+)\s*days/);
      const args: Record<string, unknown> = {};
      if (days) args.inactiveDays = Number(days[1]);
      else if (/not been contacted|haven.t been contacted|inactive|haven.t contacted/.test(text))
        return {
          intent: 'clarify',
          message:
            'How many days since the last contact? For example, “Show customers not contacted in 30 days.”',
        };
      if (/at risk/.test(text)) args.status = 'At risk';
      else if (/prospects?/.test(text)) args.status = 'Prospect';
      const find = text.match(/(?:find|search for|search)\s+(.+)/);
      if (find) args.query = find[1].replace(/\b(customers?|accounts?)\b/g, '').trim();
      return call('customers_search', args);
    }
    if (/^(hi|hello|help)|what can you|how (does|do)/.test(text))
      return {
        intent: 'info',
        message:
          'I can find customers, retrieve activities, show opportunities and create follow-up tasks after your confirmation. This is deterministic demo mode; connect Ollama for broader language understanding.',
      };
    return {
      intent: 'unsupported',
      message:
        'That request is not supported by the demo planner. Try finding inactive customers, viewing opportunities, or creating follow-up tasks. Connect Ollama for broader phrasing; available tools still define what I can do.',
    };
  }
}
