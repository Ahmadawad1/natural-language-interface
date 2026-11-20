import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Code2,
  Copy,
  Database,
  FileCheck2,
  LayoutDashboard,
  ListTodo,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { Assistant, NliClient, NliProvider, type Conversation } from '@nli/react';
import type { ToolDefinition } from '@nli/protocol';
import type { Customer, Opportunity, Task } from '../server/database';
import '@nli/react/styles.css';
import './styles.css';

interface Session {
  token: string;
  hostToken: string;
  user: { id: string; name: string; workspace: string };
}
let sessionPromise: Promise<Session> | undefined;
let sessionExpires = 0;
async function session(): Promise<Session> {
  if (!sessionPromise || Date.now() > sessionExpires) {
    sessionExpires = Date.now() + 10 * 60000;
    sessionPromise = fetch('/api/session', { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error('The demo session could not start. Check the CRM API.');
        return r.json() as Promise<Session>;
      })
      .catch((e) => {
        sessionPromise = undefined;
        throw e;
      });
  }
  return sessionPromise;
}
const getToken = async () => (await session()).token;
async function api<T>(path: string, method = 'GET'): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: { Authorization: `Bearer ${(await session()).hostToken}` },
  });
  if (!r.ok)
    throw new Error((await r.json()).error ?? 'The CRM API could not complete this request.');
  return r.json();
}
const currency = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
const daysSince = (date: string) => Math.floor((Date.now() - Date.parse(date)) / 86400000);
type Page = 'Customers' | 'Pipeline' | 'Tasks' | 'Integration';

function App() {
  const [page, setPage] = useState<Page>('Customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [user, setUser] = useState<Session['user']>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All customers');
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Customer>();
  const detailDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail) detailDialog.current?.showModal();
  }, [detail]);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [s, c, t, o] = await Promise.all([
        session(),
        api<{ records: Customer[] }>('customers'),
        api<{ records: Task[] }>('tasks'),
        api<{ records: Opportunity[] }>('opportunities'),
      ]);
      setUser(s.user);
      setCustomers(c.records);
      setTasks(t.records);
      setOpportunities(o.records);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load workspace.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const onConversationChange = useCallback(
    (c: Conversation) => {
      if (c.messages.at(-1)?.results?.some((r) => r.tool === 'tasks_create')) {
        void refresh();
        setNotice('The CRM confirmed the new tasks. View them in Tasks.');
      }
    },
    [refresh],
  );
  const shown = useMemo(
    () =>
      customers.filter(
        (c) =>
          `${c.name} ${c.contact} ${c.industry}`.toLowerCase().includes(query.toLowerCase()) &&
          (filter === 'All customers' ||
            (filter === 'Needs attention' ? daysSince(c.lastContact) >= 30 : c.status === filter)),
      ),
    [customers, query, filter],
  );
  const navigate = (next: Page) => {
    setPage(next);
    setSidebarOpen(false);
    setDetail(undefined);
  };
  const toggleSelected = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <div className={`workspace ${dark ? 'dark' : ''} ${assistantOpen ? 'assistant-visible' : ''}`}>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('Customers');
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          meridian<span className="brand-period">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => setNotice('You’re in the local Meridian demo workspace.')}
        >
          <span className="workspace-avatar">M</span>
          <span>
            Meridian workspace<small>Demo environment</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          <button
            className={page === 'Customers' ? 'nav-active' : ''}
            onClick={() => navigate('Customers')}
          >
            <Users size={18} />
            Customers<span className="nav-count">{customers.length || '—'}</span>
          </button>
          <button
            className={page === 'Pipeline' ? 'nav-active' : ''}
            onClick={() => navigate('Pipeline')}
          >
            <LayoutDashboard size={18} />
            Pipeline
          </button>
          <button
            className={page === 'Tasks' ? 'nav-active' : ''}
            onClick={() => navigate('Tasks')}
          >
            <ListTodo size={18} />
            Tasks
            {tasks.filter((t) => t.status === 'Open').length > 0 && (
              <span className="nav-count">{tasks.filter((t) => t.status === 'Open').length}</span>
            )}
          </button>
        </nav>
        <div className="nav-label developer-label">DEVELOPER</div>
        <nav aria-label="Developer navigation">
          <button
            className={page === 'Integration' ? 'nav-active' : ''}
            onClick={() => navigate('Integration')}
          >
            <Code2 size={18} />
            Integration
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="connected-card">
            <div className="connected-card-icon">
              <Sparkles size={16} />
              <span>One layer. More possibilities.</span>
            </div>
            <p>Your application, with a conversational superpower.</p>
            <button onClick={() => navigate('Integration')}>
              Explore the integration <Code2 size={14} />
            </button>
          </div>
          <button
            className="help-button"
            onClick={() => {
              setAssistantOpen(true);
              setNotice(
                'Try “Show customers not contacted in 30 days,” then “Create follow-up tasks for the first three.”',
              );
            }}
          >
            <CircleHelp size={17} />
            Quick start
          </button>
          <div className="user-profile">
            <span className="person-avatar">AM</span>
            <span>
              <strong>Alex Morgan</strong>
              <small>Workspace admin</small>
            </span>
            <button
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              title="Toggle theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <PanelLeftClose size={19} />
            </button>
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="sandbox-label">
              <span />
              Local sandbox
            </span>
            <span className="topbar-divider" />
            <button className="topbar-assistant" onClick={() => setAssistantOpen(!assistantOpen)}>
              <Sparkles size={15} />
              Assistant
            </button>
            <span className="person-avatar small">AM</span>
          </div>
        </header>
        <main className="main-content">
          <div className="demo-strip">
            <span className="demo-pill">LIVE DEMO</span>
            <p>A familiar workspace. A new way to work.</p>
            <button onClick={() => navigate('Integration')}>
              Meet the integration <Code2 size={14} />
            </button>
          </div>
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {page === 'Integration'
                  ? 'BUILT TO FIT YOUR PRODUCT'
                  : 'YOUR RELATIONSHIPS, IN FOCUS'}
              </div>
              <h1>{page}</h1>
              <p>
                {
                  {
                    Customers: 'Good relationships start with staying in the loop.',
                    Pipeline: 'A clear view of your next opportunities.',
                    Tasks: 'Turn a conversation into your next step.',
                    Integration: 'Your interface. Your data. A little more possibility.',
                  }[page]
                }
              </p>
            </div>
            <button className="primary-button" onClick={() => setAssistantOpen(true)}>
              <Sparkles size={16} />
              Ask assistant
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                onClick={() => {
                  setLoading(true);
                  void refresh();
                }}
              >
                Retry connection
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">Connecting to your workspace…</div>
          ) : page === 'Customers' ? (
            <>
              <div className="metrics">
                <Metric
                  label="Total customers"
                  value={String(customers.length)}
                  icon={<Users size={17} />}
                  foot={`${customers.filter((c) => c.status === 'Active').length} active relationships`}
                  chart="blue"
                />
                <Metric
                  label="Customer value"
                  value={currency(customers.reduce((sum, c) => sum + c.value, 0))}
                  icon={<Activity size={17} />}
                  foot="Across your customer portfolio"
                  chart="green"
                />
                <Metric
                  label="Needs attention"
                  value={String(customers.filter((c) => daysSince(c.lastContact) >= 30).length)}
                  icon={<FileCheck2 size={17} />}
                  foot="No contact in the last 30 days"
                  chart="amber"
                />
              </div>
              <div className="insight-banner">
                <div className="insight-icon">
                  <Sparkles size={20} />
                </div>
                <div>
                  <strong>A little follow-up goes a long way.</strong>
                  <p>Find the customers waiting to hear from you, then plan your next move.</p>
                </div>
                <button
                  onClick={() => {
                    setFilter('Needs attention');
                    setAssistantOpen(true);
                  }}
                >
                  Find opportunities
                </button>
              </div>
              <section className="customer-section" aria-label="Customer directory">
                <div className="table-section-header">
                  <div>
                    <h2>
                      Customer directory <span>{shown.length}</span>
                    </h2>
                    <p>Your people, all in one place.</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Show directory information"
                    onClick={() =>
                      setNotice(
                        'These are seeded demo records served by the CRM API. Assistant actions create persisted tasks.',
                      )
                    }
                  >
                    <MoreHorizontal size={20} />
                  </button>
                </div>
                <div className="table-toolbar">
                  <div className="filter-tabs">
                    {['All customers', 'Needs attention'].map((f) => (
                      <button
                        className={filter === f ? 'filter-active' : ''}
                        onClick={() => setFilter(f)}
                        key={f}
                      >
                        {f}
                        {f === 'Needs attention' && (
                          <span>
                            {customers.filter((c) => daysSince(c.lastContact) >= 30).length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="table-controls">
                    <label className="search-input">
                      <Search size={16} />
                      <input
                        aria-label="Search customers"
                        value={query}
                        placeholder="Search customers…"
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <label className="status-filter">
                      <Settings2 size={15} />
                      <select
                        aria-label="Filter by customer status"
                        value={['Active', 'At risk', 'Prospect'].includes(filter) ? filter : ''}
                        onChange={(e) => setFilter(e.target.value || 'All customers')}
                      >
                        <option value="">Status</option>
                        <option>Active</option>
                        <option>At risk</option>
                        <option>Prospect</option>
                      </select>
                      <ChevronDown size={12} />
                    </label>
                  </div>
                </div>
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>{selected.length} selected</span>
                    <button
                      onClick={() => {
                        setAssistantOpen(true);
                        setNotice(
                          'Ask “Create follow-up tasks for the selected customers” to review a proposal.',
                        );
                      }}
                    >
                      Create tasks with assistant
                    </button>
                    <button onClick={() => setSelected([])}>Clear</button>
                  </div>
                )}
                <div className="table-scroll">
                  <table className="customer-table">
                    <thead>
                      <tr>
                        <th className="checkbox-cell">
                          <input
                            type="checkbox"
                            aria-label="Select all visible customers"
                            checked={
                              shown.length > 0 && shown.every((c) => selected.includes(c.id))
                            }
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...new Set([...ids, ...shown.map((c) => c.id)])]
                                  : ids.filter((id) => !shown.some((c) => c.id === id)),
                              )
                            }
                          />
                        </th>
                        <th>
                          Company <ChevronDown size={12} />
                        </th>
                        <th>Status</th>
                        <th>Last contact</th>
                        <th className="value-column">Value</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((c) => (
                        <tr key={c.id} className={selected.includes(c.id) ? 'selected-row' : ''}>
                          <td className="checkbox-cell">
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.name}`}
                              checked={selected.includes(c.id)}
                              onChange={() => toggleSelected(c.id)}
                            />
                          </td>
                          <td>
                            <button className="company-button" onClick={() => setDetail(c)}>
                              <span
                                className="company-avatar"
                                style={{ '--company-color': c.color } as React.CSSProperties}
                              >
                                {c.name === 'Acme Corporation' ? 'A' : c.name.slice(0, 1)}
                              </span>
                              <span>
                                <strong>{c.name}</strong>
                                <small>
                                  {c.contact} · {c.industry}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <span
                              className={`status-badge ${c.status.toLowerCase().replace(' ', '-')}`}
                            >
                              <i />
                              {c.status}
                            </span>
                          </td>
                          <td>
                            <span
                              className={
                                daysSince(c.lastContact) >= 30 ? 'stale-contact' : 'contact-age'
                              }
                            >
                              {daysSince(c.lastContact)} days ago
                            </span>
                          </td>
                          <td className="value-column">{currency(c.value)}</td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`View ${c.name}`}
                              onClick={() => setDetail(c)}
                            >
                              <MoreHorizontal size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!shown.length && (
                    <div className="empty-state">
                      <Search size={28} />
                      <h3>No customers found</h3>
                      <p>Try a different search or clear your filters.</p>
                      <button
                        onClick={() => {
                          setQuery('');
                          setFilter('All customers');
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
                <div className="table-footer">
                  <span>
                    Showing {shown.length} of {customers.length} customers
                  </span>
                  <span>
                    <Database size={12} />
                    Connected to CRM API
                  </span>
                </div>
              </section>
              <div className="page-footnote">
                <ShieldCheck size={14} />
                <span>
                  The assistant uses your application’s permissions. Every change is yours to
                  approve.
                </span>
              </div>
            </>
          ) : page === 'Pipeline' ? (
            <>
              <div className="metrics">
                <Metric
                  label="Open pipeline"
                  value={currency(opportunities.reduce((a, o) => a + o.value, 0))}
                  icon={<LayoutDashboard size={17} />}
                  foot={`${opportunities.length} opportunities`}
                  chart="green"
                />
                <Metric
                  label="Weighted value"
                  value={currency(
                    opportunities.reduce((a, o) => a + (o.value * o.probability) / 100, 0),
                  )}
                  icon={<Activity size={17} />}
                  foot="Value × recorded probability"
                  chart="blue"
                />
              </div>
              <div className="pipeline-board">
                {['Proposal', 'Negotiation'].map((stage) => (
                  <section key={stage}>
                    <div className="pipeline-stage">
                      <span>{stage}</span>
                      <span>{opportunities.filter((o) => o.stage === stage).length}</span>
                    </div>
                    {opportunities
                      .filter((o) => o.stage === stage)
                      .map((o) => (
                        <article className="opportunity-card" key={o.id}>
                          <span className="opportunity-company">{o.customerName}</span>
                          <h3>{o.title}</h3>
                          <strong>{currency(o.value)}</strong>
                          <div className="probability">
                            <span style={{ width: `${o.probability}%` }} />
                          </div>
                          <footer>
                            <span>{o.probability}% probability</span>
                            <span>
                              {new Date(o.closeDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </footer>
                        </article>
                      ))}
                  </section>
                ))}
              </div>
              <p className="page-footnote">
                Probabilities are stored CRM fields, not AI predictions.
              </p>
            </>
          ) : page === 'Tasks' ? (
            <section className="tasks-section">
              <div className="table-section-header">
                <div>
                  <h2>
                    Your follow-ups <span>{tasks.length}</span>
                  </h2>
                  <p>Changes made by the assistant appear here after the CRM confirms them.</p>
                </div>
                <button className="secondary-button" onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>
              {tasks.length ? (
                tasks.map((task) => (
                  <article
                    className={`task-row ${task.status === 'Done' ? 'task-done' : ''}`}
                    key={task.id}
                  >
                    <button
                      className="task-check"
                      aria-label={`Complete ${task.title} for ${task.customerName}`}
                      disabled={task.status === 'Done'}
                      onClick={() =>
                        void api(`tasks/${task.id}/complete`, 'POST')
                          .then(refresh)
                          .catch((e) => setError(e.message))
                      }
                    >
                      {task.status === 'Done' && <Check size={15} />}
                    </button>
                    <div>
                      <h3>{task.title}</h3>
                      <p>
                        {task.customerName} <span>·</span>{' '}
                        {new Date(task.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                    <span
                      className={`status-badge ${task.status === 'Done' ? 'active' : 'prospect'}`}
                    >
                      {task.status}
                    </span>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <CheckCheck size={30} />
                  <h3>A clean slate</h3>
                  <p>Ask the assistant to create your next follow-up.</p>
                </div>
              )}
            </section>
          ) : (
            <Integration dark={dark} user={user} />
          )}
        </main>
      </div>
      {user && (
        <NliProvider
          endpoint="/runtime"
          appId="meridian"
          user={user}
          getToken={getToken}
          context={{ page, selectedIds: selected }}
          theme={dark ? 'dark' : 'light'}
          locale="en"
        >
          <Assistant
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            title="Meridian assistant"
            suggestedPrompts={[
              'Show customers not contacted in 30 days',
              'Which opportunities close this month?',
              'Show my open tasks',
            ]}
            onConversationChange={onConversationChange}
          />
        </NliProvider>
      )}
      {detail && (
        <dialog
          ref={detailDialog}
          className="customer-modal"
          aria-label={`${detail.name} details`}
          onCancel={() => setDetail(undefined)}
        >
          <button
            className="modal-close icon-button"
            aria-label="Close customer details"
            onClick={() => setDetail(undefined)}
          >
            <X size={20} />
          </button>
          <span
            className="company-avatar large"
            style={{ '--company-color': detail.color } as React.CSSProperties}
          >
            {detail.name[0]}
          </span>
          <h2>{detail.name}</h2>
          <p>
            {detail.industry} · {detail.status}
          </p>
          <dl>
            <dt>Primary contact</dt>
            <dd>{detail.contact}</dd>
            <dt>Email</dt>
            <dd>{detail.email}</dd>
            <dt>Customer value</dt>
            <dd>{currency(detail.value)}</dd>
            <dt>Last contact</dt>
            <dd>{new Date(detail.lastContact).toLocaleDateString()}</dd>
            <dt>Account owner</dt>
            <dd>{detail.owner}</dd>
          </dl>
          <button
            className="primary-button"
            onClick={() => {
              setSelected([detail.id]);
              setDetail(undefined);
              setAssistantOpen(true);
              setNotice(
                'Customer selected. Ask the assistant to create a follow-up for the selected customer.',
              );
            }}
          >
            <Sparkles size={15} />
            Plan a follow-up
          </button>
        </dialog>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  foot,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  foot: string;
  chart: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <div className="metric-value">{value}</div>
      <p>{foot}</p>
    </article>
  );
}
const integrationCode = `import { NliProvider, Assistant } from '@nli/react';
import '@nli/react/styles.css';

<NliProvider
  endpoint="https://runtime.your-company.com"
  appId="your-app"
  user={{ id: currentUser.id }}
  getToken={fetchTokenFromYourBackend}
  context={{ page: 'customers', selectedIds }}
>
  <Assistant mode="floating" />
</NliProvider>`;
function Integration({ dark, user }: { dark: boolean; user?: Session['user'] }) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [planner, setPlanner] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inline, setInline] = useState(false);
  useEffect(() => {
    void new NliClient({ endpoint: '/runtime', appId: 'meridian', getToken })
      .capabilities()
      .then((r) => {
        setTools(r.tools);
        setPlanner(r.planner);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="integration-content">
      <div className="integration-overview">
        <span className="integration-icon">
          <Code2 size={25} />
        </span>
        <div>
          <h2>Fits into the product you already have.</h2>
          <p>A React component, a bounded runtime, and the capabilities you choose to expose.</p>
        </div>
      </div>
      <div className="integration-flow">
        <span>Your frontend</span>
        <span>＋</span>
        <span>NLI SDK</span>
        <span>↔</span>
        <span>Runtime</span>
        <span>↔</span>
        <span>Your API</span>
      </div>
      <section className="code-section">
        <header>
          <h3>Start with a component</h3>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(integrationCode)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
                .catch(() => setError('Clipboard unavailable. Select the code to copy it.'))
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </header>
        <pre>
          <code>{integrationCode}</code>
        </pre>
      </section>
      <section className="capabilities-section">
        <div className="table-section-header">
          <div>
            <h2>
              Registered capabilities <span>{tools.length}</span>
            </h2>
            <p>Live from this session’s authorized tool registry.</p>
          </div>
          <span className="planner-badge">
            {planner === 'demo' ? 'Demo planner' : planner === 'ollama' ? 'Ollama' : 'Connecting'}
          </span>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {tools.map((tool) => (
          <details className="capability" key={tool.name}>
            <summary>
              <Code2 size={16} />
              <span>
                <strong>{tool.name}</strong>
                <small>{tool.description}</small>
              </span>
              <span className={`tool-kind ${tool.kind}`}>
                {tool.confirmation ? 'Confirm to write' : 'Read only'}
              </span>
            </summary>
            <div>
              <p>
                Permissions: <code>{tool.permissions.join(', ')}</code> · Timeout:{' '}
                {tool.timeoutMs / 1000}s
              </p>
              <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
            </div>
          </details>
        ))}
      </section>
      <section className="inline-section">
        <div>
          <h3>Floating or part of your page.</h3>
          <p>The same SDK supports an inline assistant.</p>
        </div>
        <button className="secondary-button" onClick={() => setInline(!inline)}>
          {inline ? 'Close inline preview' : 'Try inline mode'}
        </button>
        {inline && user && (
          <NliProvider
            endpoint="/runtime"
            appId="meridian"
            user={user}
            getToken={getToken}
            theme={dark ? 'dark' : 'light'}
          >
            <Assistant
              mode="inline"
              title="Inline assistant"
              suggestedPrompts={['Show all customers']}
            />
          </NliProvider>
        )}
      </section>
      <div className="integration-note">
        <BookOpen size={19} />
        <p>
          See <code>docs/integration.md</code> in the repository for token issuance, backend
          adapters, schemas, permissions, and deployment boundaries.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
