import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ApplicationContext, Conversation, Message, ToolResult } from '@nli/protocol';
import { NliClient } from './client.js';
export { NliClient, readEvents } from './client.js';
export type { ClientOptions } from './client.js';
export type { ApplicationContext, Conversation, ToolResult } from '@nli/protocol';

export interface NliConfig {
  endpoint: string;
  appId: string;
  user: { id: string; name?: string; tenantId?: string };
  getToken: () => Promise<string>;
  context?: ApplicationContext;
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  accentColor?: string;
}
const ConfigContext = createContext<NliConfig | null>(null);
export function NliProvider({ children, ...config }: NliConfig & { children: ReactNode }) {
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}
interface Labels {
  title: string;
  subtitle: string;
  greeting: string;
  description: string;
  placeholder: string;
  send: string;
  close: string;
  open: string;
  newChat: string;
  confirm: string;
  cancel: string;
  source: string;
  footer: string;
  refresh: string;
}
const english: Labels = {
  title: 'Workspace assistant',
  subtitle: 'Connected to your application',
  greeting: 'Less navigating. More doing.',
  description:
    'Ask about your application data, find what needs attention, and turn your next step into action.',
  placeholder: 'Ask your workspace anything…',
  send: 'Send message',
  close: 'Close assistant',
  open: 'Ask assistant',
  newChat: 'New conversation',
  confirm: 'Confirm action',
  cancel: 'Cancel',
  source: 'Application result',
  footer: 'You review every change before it happens.',
  refresh: 'Reload conversation',
};
const spanish: Labels = {
  title: 'Asistente',
  subtitle: 'Conectado a tu aplicación',
  greeting: 'Menos clics. Más resultados.',
  description: 'Consulta tus datos y revisa los cambios antes de ejecutarlos.',
  placeholder: 'Pregunta a tu aplicación…',
  send: 'Enviar mensaje',
  close: 'Cerrar asistente',
  open: 'Abrir asistente',
  newChat: 'Nueva conversación',
  confirm: 'Confirmar acción',
  cancel: 'Cancelar',
  source: 'Resultado de la aplicación',
  footer: 'Revisas cada cambio antes de ejecutarlo.',
  refresh: 'Recargar conversación',
};
function Sparkle() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" fill="currentColor" />
    </svg>
  );
}
export interface AssistantProps {
  mode?: 'floating' | 'inline';
  placement?: 'right' | 'left';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  labels?: Partial<Labels>;
  suggestedPrompts?: string[];
  className?: string;
  style?: CSSProperties;
  onConversationChange?: (conversation: Conversation) => void;
  renderResult?: (result: ToolResult) => ReactNode;
}
export function Assistant(props: AssistantProps) {
  const config = useContext(ConfigContext);
  if (!config) throw new Error('Assistant must be rendered inside NliProvider.');
  return (
    <AssistantSession
      key={JSON.stringify([config.endpoint, config.appId, config.user.id, config.user.tenantId])}
      {...props}
    />
  );
}
function AssistantSession({
  mode = 'floating',
  placement = 'right',
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  title,
  labels: overrides,
  suggestedPrompts = ['What can you help me with?'],
  className = '',
  style,
  onConversationChange,
  renderResult,
}: AssistantProps) {
  const config = useContext(ConfigContext);
  if (!config) throw new Error('Assistant must be rendered inside NliProvider.');
  const {
    endpoint,
    appId,
    user,
    getToken,
    context,
    locale = 'en',
    theme = 'light',
    accentColor,
  } = config;
  const labels = { ...(locale.startsWith('es') ? spanish : english), ...overrides };
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const [expanded, setExpanded] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState('');
  const [planner, setPlanner] = useState('');
  const inputId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const client = useMemo(
    () => new NliClient({ endpoint, appId, getToken: () => getTokenRef.current() }),
    [endpoint, appId, user.id, user.tenantId],
  );
  const storageKey = `nli:${JSON.stringify([endpoint, appId, user.id, user.tenantId ?? ''])}`;
  const changeOpen = (value: boolean) => {
    setLocalOpen(value);
    onOpenChange?.(value);
    if (!value) launcher.current?.focus();
  };
  const persist = useCallback(
    (c: Conversation) => {
      setConversation(c);
      try {
        sessionStorage.setItem(storageKey, c.id);
      } catch {
        /* Storage can be unavailable in embedded browsers. */
      }
    },
    [storageKey],
  );
  useEffect(() => {
    let active = true;
    setConversation(null);
    setError('');
    client
      .capabilities()
      .then((result) => {
        if (active) setPlanner(result.planner);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storageKey);
    } catch {
      /* Optional persistence. */
    }
    if (saved)
      client
        .getConversation(saved)
        .then((c) => {
          if (active) persist(c);
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* Optional persistence. */
            }
          }
        });
    return () => {
      active = false;
    };
  }, [client, storageKey, persist]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation, status, optimistic]);
  useEffect(() => {
    if (open || mode === 'inline') textarea.current?.focus();
  }, [open, mode]);
  async function send(
    text?: string,
    confirmation?: { proposalId: string; decision: 'confirm' | 'cancel' },
  ) {
    if (sending.current || (!text?.trim() && !confirmation)) return;
    sending.current = true;
    setBusy(true);
    setError('');
    setInput('');
    setOptimistic(text ?? (confirmation?.decision === 'confirm' ? labels.confirm : labels.cancel));
    try {
      const c = conversation ?? (await client.createConversation());
      if (!alive.current) return;
      persist(c);
      await client.send(
        c.id,
        { ...(confirmation ? { confirmation } : { message: text!.trim() }), context, locale },
        (event) => {
          if (!alive.current) return;
          if (event.type === 'status') setStatus(event.content);
          if (event.type === 'conversation') {
            persist(event.conversation);
            onConversationChange?.(event.conversation);
          }
          if (event.type === 'error') throw new Error(event.content);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.');
    } finally {
      sending.current = false;
      setBusy(false);
      setStatus('');
      setOptimistic('');
      textarea.current?.focus();
    }
  }
  function reset() {
    if (busy) return;
    setConversation(null);
    setError('');
    setInput('');
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional persistence. */
    }
  }
  const lastProposal = conversation?.messages.filter((m) => m.proposal?.status === 'pending').at(-1)
    ?.proposal?.id;
  return (
    <div
      className={`nli-root nli-${mode} nli-${placement} ${expanded ? 'nli-expanded' : ''} ${className}`}
      data-theme={theme}
      lang={locale}
      style={{ ...style, ...(accentColor ? { '--nli-accent': accentColor } : {}) } as CSSProperties}
    >
      {mode === 'floating' && !open && (
        <button ref={launcher} className="nli-launcher" onClick={() => changeOpen(true)}>
          <Sparkle />
          {labels.open}
        </button>
      )}
      {(open || mode === 'inline') && (
        <section
          className="nli-panel"
          aria-label={title ?? labels.title}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && mode === 'floating') changeOpen(false);
          }}
        >
          <header className="nli-header">
            <div className="nli-brand-icon">
              <Sparkle />
            </div>
            <div className="nli-heading">
              <strong>{title ?? labels.title}</strong>
              <span>{labels.subtitle}</span>
            </div>
            <button
              className="nli-icon-button"
              title={labels.newChat}
              aria-label={labels.newChat}
              disabled={busy}
              onClick={reset}
            >
              ＋
            </button>
            {mode === 'floating' && (
              <>
                <button
                  className="nli-icon-button nli-expand"
                  aria-label={expanded ? 'Collapse assistant' : 'Expand assistant'}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? '⊡' : '⛶'}
                </button>
                <button
                  className="nli-icon-button"
                  aria-label={labels.close}
                  onClick={() => changeOpen(false)}
                >
                  ×
                </button>
              </>
            )}
          </header>
          <div className="nli-mode">
            <span className="nli-connected" />{' '}
            {planner
              ? planner === 'demo'
                ? 'Demo planner · live application data'
                : 'Local AI · Ollama'
              : 'Connecting to runtime…'}
            <span className="nli-private">Scoped access</span>
          </div>
          <div className="nli-messages">
            {!conversation?.messages.length && !optimistic && (
              <div className="nli-welcome">
                <div className="nli-welcome-symbol">
                  <Sparkle />
                </div>
                <span className="nli-eyebrow">YOUR WORKSPACE, IN A CONVERSATION</span>
                <h2>{labels.greeting}</h2>
                <p>{labels.description}</p>
                <div className="nli-suggestions">
                  {suggestedPrompts.map((prompt, i) => (
                    <button key={prompt} onClick={() => void send(prompt)} disabled={busy}>
                      <span aria-hidden="true">{['⌕', '◷', '☷'][i % 3]}</span>
                      {prompt}
                      <span className="nli-suggestion-plus" aria-hidden="true">
                        ＋
                      </span>
                    </button>
                  ))}
                </div>
                <div className="nli-welcome-note">
                  <span aria-hidden="true">◇</span>
                  <span>
                    Connected to your application.
                    <br />
                    Bounded by your permissions.
                  </span>
                </div>
              </div>
            )}
            {conversation?.messages.map((m) => (
              <div className={`nli-message nli-${m.role}`} key={m.id}>
                <div className="nli-message-label">
                  {m.role === 'user' ? (
                    (user.name ?? 'You')
                  ) : (
                    <>
                      <Sparkle />
                      {title ?? labels.title}
                    </>
                  )}
                </div>
                <div className={`nli-bubble ${m.error ? 'nli-error-bubble' : ''}`}>{m.content}</div>
                {m.results?.map((result, i) => (
                  <div className="nli-result" key={`${m.id}-${i}`}>
                    <div className="nli-result-source">
                      <span>{labels.source}</span>
                      <code>{result.tool}</code>
                    </div>
                    {renderResult ? (
                      renderResult(result)
                    ) : (
                      <ResultView result={result} locale={locale} />
                    )}
                  </div>
                ))}
                {m.proposal && (
                  <ProposalView
                    message={m}
                    messages={conversation.messages}
                    labels={labels}
                    disabled={busy || m.proposal.id !== lastProposal}
                    onDecision={(decision) =>
                      void send(undefined, { proposalId: m.proposal!.id, decision })
                    }
                  />
                )}
              </div>
            ))}
            {optimistic && (
              <div className="nli-message nli-user">
                <div className="nli-message-label">{user.name ?? 'You'}</div>
                <div className="nli-bubble">{optimistic}</div>
              </div>
            )}
            {busy && (
              <div className="nli-working" role="status">
                <span className="nli-spinner" />
                {status || 'Connecting…'}
              </div>
            )}
            {error && (
              <div className="nli-error" role="alert">
                {error}
                {conversation && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void client
                        .getConversation(conversation.id)
                        .then((c) => {
                          persist(c);
                          setError('');
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    {labels.refresh}
                  </button>
                )}
              </div>
            )}
            <div ref={end} />
          </div>
          <footer className="nli-composer">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <label className="nli-sr-only" htmlFor={inputId}>
                {labels.placeholder}
              </label>
              <textarea
                ref={textarea}
                id={inputId}
                value={input}
                disabled={busy}
                maxLength={4000}
                placeholder={labels.placeholder}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              <div className="nli-composer-bottom">
                <span>↵ Enter to send</span>
                <button type="submit" aria-label={labels.send} disabled={busy || !input.trim()}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="m4 4 16 8-16 8 3-8-3-8Zm3 8h13"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </form>
            <div className="nli-footer-note">◇ {labels.footer}</div>
            <a
              className="nli-powered"
              href="https://github.com/Ahmadawad1/natural-language-interface"
              target="_blank"
              rel="noreferrer"
            >
              Powered by <strong>Natural Language Interface</strong>
            </a>
          </footer>
        </section>
      )}
    </div>
  );
}
function ProposalView({
  message,
  messages,
  labels,
  disabled,
  onDecision,
}: {
  message: Message;
  messages: Message[];
  labels: Labels;
  disabled: boolean;
  onDecision: (decision: 'confirm' | 'cancel') => void;
}) {
  const p = message.proposal!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = Date.parse(p.expiresAt) <= now;
  const names = new Map<string, string>();
  messages
    .flatMap((m) => m.results ?? [])
    .forEach((r) => {
      const data = r.data as { records?: Record<string, unknown>[] };
      if (Array.isArray(data?.records))
        data.records.forEach((row) => {
          if (typeof row.id === 'string' && typeof row.name === 'string')
            names.set(row.id, row.name);
        });
    });
  return (
    <div className="nli-proposal">
      <div className="nli-proposal-title">
        <span>◇</span>{' '}
        {p.status === 'pending'
          ? expired
            ? 'Confirmation expired'
            : 'Review proposed action'
          : `Action ${p.status}`}
      </div>
      {p.calls.map((call, i) => (
        <div key={i}>
          <strong>{call.name.replaceAll('_', ' ')}</strong>
          {Array.isArray(call.arguments.customerIds) && (
            <ul>
              {call.arguments.customerIds.map((id) => (
                <li key={String(id)}>{names.get(String(id)) ?? String(id)}</li>
              ))}
            </ul>
          )}
          {typeof call.arguments.title === 'string' && <p>{call.arguments.title}</p>}
          <details>
            <summary>Exact action parameters</summary>
            <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
          </details>
        </div>
      ))}
      {p.status === 'pending' && (
        <div className="nli-proposal-actions">
          <button
            disabled={disabled || expired}
            className="nli-confirm"
            onClick={() => onDecision('confirm')}
          >
            {labels.confirm}
          </button>
          <button disabled={disabled} onClick={() => onDecision('cancel')}>
            {labels.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
function ResultView({ result, locale }: { result: ToolResult; locale: string }) {
  const data = result.data as { records?: unknown[]; total?: number; customerName?: string } | null;
  if (!data || !Array.isArray(data.records))
    return <pre>{JSON.stringify(result.data, null, 2)}</pre>;
  const records = data.records.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
  );
  if (!records.length) return <p className="nli-no-results">No matching records.</p>;
  const display = (value: unknown, key: string) => {
    if (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(value) &&
      !Number.isNaN(Date.parse(value))
    )
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
    return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  };
  return (
    <>
      <div className="nli-result-count">
        {data.customerName ? `${data.customerName} · ` : ''}
        {records.length}
        {typeof data.total === 'number' && data.total !== records.length
          ? ` of ${data.total}`
          : ''}{' '}
        records
      </div>
      <div className="nli-records">
        {records.map((row, i) => {
          const titleKey =
            ['name', 'title', 'type', 'id'].find((k) => typeof row[k] === 'string') ??
            Object.keys(row)[0];
          const detailKeys = Object.keys(row)
            .filter((k) => ![titleKey, 'id', 'color', 'customerId', 'email', 'owner'].includes(k))
            .slice(0, 6);
          return (
            <div className="nli-record" key={String(row.id ?? i)}>
              <strong>{display(row[titleKey], titleKey)}</strong>
              <dl>
                {detailKeys.map((k) => (
                  <div key={k}>
                    <dt>{k.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd>{display(row[k], k)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </>
  );
}
