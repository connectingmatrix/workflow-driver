import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { createUserSupabaseClient } from '@giga/general/decorators/integration/user-supabase-client';
import { decodeDashedAccessToken } from '@giga/shared/lib/helper';
import { readAppAccessToken } from '@giga/permissions/services/auth/app-auth-token';
import { parseAccessTokenPayload } from '@connectingmatrix/sockets/core/auth-token.socket';
import type { WorkflowQueueRequestContextSnapshot } from '@workflow/executor';
import type { WorkflowExecutionRequestContext } from '@giga/shared/types/contracts/workflow.types';

const parseTokenFromAuthHeader = (authorization?: string | null): string | null => {
  const raw = String(authorization || '').trim();
  if (!raw) return null;
  const tokenPayload = raw.replace(/^Bearer\s+/i, '').trim();
  if (!tokenPayload) return null;
  return parseAccessTokenPayload(tokenPayload) || tokenPayload;
};

const createAdminSupabase = (token: string, userId: string) => {
  const supabase = SupabaseClientAdmin();
  (supabase as any).__auth_user_id = userId;
  (supabase as any).__access_token = token;
  return supabase;
};

const createUserSupabase = (token: string) => {
  const appUser = readAppAccessToken(token);
  if (appUser?.sub) return createAdminSupabase(token, appUser.sub);

  const dashedUserId = decodeDashedAccessToken(token);
  if (dashedUserId) return createAdminSupabase(token, dashedUserId);

  return createUserSupabaseClient(token);
};

export const restoreWorkflowExecutionRequestContext = (snapshot: WorkflowQueueRequestContextSnapshot): WorkflowExecutionRequestContext => {
  const request = {
    headers: { ...(snapshot.headers || {}) },
    method: snapshot.method || undefined,
    protocol: snapshot.protocol || undefined,
    path: snapshot.path || undefined,
    originalUrl: snapshot.originalUrl || undefined,
    query: snapshot.query || undefined,
    body: snapshot.body,
    ip: snapshot.ip || undefined,
  } as WorkflowExecutionRequestContext['request'];

  if (snapshot.mode === 'admin') {
    return {
      request,
      supabase: SupabaseClientAdmin() as any,
      userId: snapshot.userId,
    };
  }

  const token = parseTokenFromAuthHeader(snapshot.authorization);
  if (!token) {
    throw new Error('Queued workflow request is missing an authorization token.');
  }
  request.headers.authorization = `Bearer ${token}`;

  return {
    request,
    supabase: createUserSupabase(token) as any,
    userId: snapshot.userId,
  };
};
