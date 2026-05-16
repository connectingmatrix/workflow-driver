import { restoreWorkflowExecutionRequestContext } from '../queue/runtime/restoreWorkflowRequestContext';

const text = (value: unknown) => String(value || '').trim();
const headers = (value: unknown) => {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((result, entry) => {
    const key = text(entry[0]).toLowerCase();
    const current = entry[1];
    if (!key) return result;
    if (current && typeof current === 'object') return result;
    result[key] = text(current);
    return result;
  }, {});
};

export const createWorkflowExecutorRequestContext = (request: unknown, session: { accessToken?: unknown; mode?: unknown; userId: string }) =>
  restoreWorkflowExecutionRequestContext({
    authorization: `Bearer ${text(session.accessToken)}`,
    headers: headers((request as Record<string, unknown>)?.headers),
    method: text((request as Record<string, unknown>)?.method) || null,
    mode: text(session.mode) === 'admin' ? 'admin' : 'user',
    originalUrl: text((request as Record<string, unknown>)?.originalUrl || (request as Record<string, unknown>)?.url) || null,
    path: text((request as Record<string, unknown>)?.path || (request as Record<string, unknown>)?.url) || null,
    protocol: text((request as Record<string, unknown>)?.protocol) || null,
    userId: text(session.userId),
  });
