import { randomUUID } from 'node:crypto';
import { NliError, ToolRegistry } from '@nli/backend';
import type {
  ApplicationContext,
  Message,
  Principal,
  StreamEvent,
  ToolResult,
} from '@nli/protocol';
import type { Planner } from './planner.js';
import { RuntimeStore } from './store.js';

const message = (
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {},
): Message => ({ id: randomUUID(), role, content, createdAt: new Date().toISOString(), ...extra });
export class RuntimeEngine {
  constructor(
    readonly store: RuntimeStore,
    readonly registry: ToolRegistry,
    readonly planner: Planner,
  ) {}
  async turn(
    p: Principal,
    id: string,
    request: {
      message?: string;
      confirmation?: { proposalId: string; decision: 'confirm' | 'cancel' };
      context?: ApplicationContext;
      locale?: string;
    },
    emit: (e: StreamEvent) => void = () => {},
  ) {
    this.store.lock(p, id);
    try {
      const conversation = this.store.get(p, id);
      if (conversation.messages.length >= 200)
        throw new NliError('SESSION_FULL', 'Start a new conversation to continue.', 409);
      let confirmation = request.confirmation;
      const text = request.message?.trim() ?? '';
      if (!confirmation && /^(confirm|cancel)[.!]?$/i.test(text)) {
        const pending = this.store.pending(id);
        if (pending)
          confirmation = {
            proposalId: pending.id,
            decision: /^confirm/i.test(text) ? 'confirm' : 'cancel',
          };
        else {
          this.store.append(p, id, message('user', text));
          this.store.append(
            p,
            id,
            message(
              'assistant',
              'There is no pending action. Request a change first so you can review it.',
            ),
          );
          return this.finish(p, id, emit);
        }
      }
      this.store.append(
        p,
        id,
        message(
          'user',
          confirmation
            ? confirmation.decision === 'confirm'
              ? 'Confirm this action.'
              : 'Cancel this action.'
            : text,
        ),
      );
      if (confirmation) {
        const proposal = this.store.proposal(id, confirmation.proposalId);
        if (confirmation.decision === 'cancel') {
          if (proposal.status !== 'pending')
            throw new NliError('ACTION_HANDLED', 'This action has already been handled.', 409);
          this.store.status(proposal.id, 'cancelled');
          this.store.audit(p, id, 'action.cancelled', { proposalId: proposal.id });
          this.store.append(p, id, message('assistant', 'Action cancelled. No changes were made.'));
        } else {
          // Reauthorize at confirmation using the current verified token, before claiming or executing.
          for (const call of proposal.calls) this.registry.validate(p, call);
          this.store.claim(id, proposal.id);
          this.store.audit(p, id, 'action.confirmed', { proposalId: proposal.id });
          const results: ToolResult[] = [];
          try {
            for (const [index, call] of proposal.calls.entries()) {
              emit({ type: 'status', content: `Executing ${call.name}…` });
              this.store.audit(p, id, 'tool.started', { tool: call.name, proposalId: proposal.id });
              results.push(await this.registry.execute(p, call, `${proposal.id}:${index}`));
              this.store.audit(p, id, 'tool.succeeded', {
                tool: call.name,
                proposalId: proposal.id,
              });
            }
            this.store.status(proposal.id, 'succeeded');
            this.store.append(
              p,
              id,
              message(
                'assistant',
                `The application confirmed ${results.length === 1 ? 'the action' : `${results.length} actions`}. Review the returned records below.`,
                { results },
              ),
            );
          } catch (error) {
            this.store.status(proposal.id, 'unknown');
            this.store.audit(p, id, 'action.unknown', {
              proposalId: proposal.id,
              completed: results.length,
            });
            this.store.append(
              p,
              id,
              message(
                'assistant',
                `The application did not confirm all changes. ${results.length} operation(s) returned a verified result. Check the host application before requesting another change; this action will not be retried automatically. ${this.safeError(error)}`,
                { results, error: true },
              ),
            );
          }
        }
        return this.finish(p, id, emit);
      }
      // A new request supersedes an unconfirmed action, avoiding stale contextual approvals.
      this.store.cancelPending(id);
      emit({ type: 'status', content: 'Understanding your request…' });
      const plan = await this.planner.plan({
        message: text,
        conversation,
        tools: this.registry.available(p),
        context: request.context ?? {},
        locale: request.locale ?? 'en',
      });
      if (plan.intent !== 'tools') {
        this.store.append(p, id, message('assistant', plan.message));
      } else {
        if (!plan.calls.length || plan.calls.length > 4)
          throw new NliError('INVALID_PLAN', 'Please ask for one bounded workflow at a time.');
        const definitions = plan.calls.map((call) => this.registry.validate(p, call));
        const requiresApproval = definitions.some((t) => t.kind === 'write' || t.confirmation);
        if (requiresApproval && definitions.some((t) => t.kind === 'read' && !t.confirmation))
          throw new NliError(
            'MIXED_PLAN',
            'Please retrieve the records first, then ask for the change you want to make.',
          );
        if (requiresApproval) {
          const proposal = this.store.propose(id, plan.calls);
          this.store.audit(p, id, 'action.proposed', {
            proposalId: proposal.id,
            tools: plan.calls.map((c) => c.name),
          });
          this.store.append(
            p,
            id,
            message(
              'assistant',
              'Review this proposed action. Nothing has changed yet. Confirmation expires in 5 minutes.',
              { proposal },
            ),
          );
        } else {
          const results: ToolResult[] = [];
          for (const call of plan.calls) {
            emit({ type: 'status', content: `Reading from ${call.name}…` });
            results.push(await this.registry.execute(p, call, randomUUID()));
            this.store.audit(p, id, 'tool.succeeded', { tool: call.name });
          }
          this.store.append(
            p,
            id,
            message('assistant', 'Here are the results returned by your application.', { results }),
          );
        }
      }
      return this.finish(p, id, emit);
    } catch (error) {
      this.store.audit(p, id, 'request.failed', {
        code: error instanceof NliError ? error.code : 'INTERNAL',
      });
      this.store.append(p, id, message('assistant', this.safeError(error), { error: true }));
      return this.finish(p, id, emit);
    } finally {
      this.store.unlock(id);
    }
  }
  private safeError(error: unknown) {
    return error instanceof NliError
      ? error.message
      : 'The request could not be completed. Please try again.';
  }
  private finish(p: Principal, id: string, emit: (e: StreamEvent) => void) {
    const c = this.store.get(p, id);
    emit({ type: 'conversation', conversation: c });
    return c;
  }
}
