import assert from 'node:assert/strict';
import test from 'node:test';
import { signAppAccessToken } from '@giga/permissions/services/auth/app-auth-token';
import { restoreWorkflowExecutionRequestContext } from '../../../../src/services/workflow/queue/runtime/restoreWorkflowRequestContext';

test('restoreWorkflowExecutionRequestContext extracts access token from cookie style authorization', () => {
  const restored = restoreWorkflowExecutionRequestContext({
    mode: 'user',
    userId: 'user_1',
    authorization: 'Bearer access_token=dashed:user_1;refresh_token=refresh_1',
    headers: {
      authorization: 'Bearer access_token=dashed:user_1;refresh_token=refresh_1',
    },
    method: 'POST',
    protocol: 'http',
    host: 'localhost:3001',
    origin: 'http://localhost:5174',
    path: '/api/v2/graphql',
    originalUrl: '/api/v2/graphql',
    query: null,
    body: null,
    ip: '127.0.0.1',
  });

  assert.equal((restored.supabase as any).__access_token, 'dashed:user_1');
  assert.equal((restored.supabase as any).__auth_user_id, 'user_1');
  assert.equal(restored.request.headers.authorization, 'Bearer dashed:user_1');
});

test('restoreWorkflowExecutionRequestContext keeps app auth tokens on the admin-backed path', () => {
  const token = signAppAccessToken({ iat: Math.floor(Date.now() / 1000), sub: 'user_2', ver: 'giga-app-auth' });
  const restored = restoreWorkflowExecutionRequestContext({
    mode: 'user',
    userId: 'user_2',
    authorization: `Bearer ${token}`,
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    protocol: 'http',
    host: 'localhost:3001',
    origin: 'http://localhost:5174',
    path: '/api/v2/graphql',
    originalUrl: '/api/v2/graphql',
    query: null,
    body: null,
    ip: '127.0.0.1',
  });

  assert.equal((restored.supabase as any).__access_token, token);
  assert.equal((restored.supabase as any).__auth_user_id, 'user_2');
  assert.equal(restored.request.headers.authorization, `Bearer ${token}`);
});

test('restoreWorkflowExecutionRequestContext returns admin supabase for admin mode snapshots', () => {
  const restored = restoreWorkflowExecutionRequestContext({
    mode: 'admin',
    userId: 'root-user',
    authorization: null,
    headers: {},
    method: 'POST',
    protocol: 'http',
    host: 'localhost:3001',
    origin: 'http://localhost:5174',
    path: '/api/v2/graphql',
    originalUrl: '/api/v2/graphql',
    query: null,
    body: null,
    ip: '127.0.0.1',
  });
  assert.equal(restored.userId, 'root-user');
});

test('restoreWorkflowExecutionRequestContext normalizes optional request fields in admin mode', () => {
  const restored = restoreWorkflowExecutionRequestContext({
    mode: 'admin',
    userId: 'root-user',
    authorization: null,
    headers: undefined,
    method: '',
    protocol: '',
    host: '',
    origin: '',
    path: '',
    originalUrl: '',
    query: null,
    body: null,
    ip: '',
  });
  assert.equal(restored.request.method, undefined);
  assert.equal(restored.request.protocol, undefined);
  assert.equal(restored.request.path, undefined);
});

test('restoreWorkflowExecutionRequestContext throws when user mode snapshot has no token', () => {
  assert.throws(
    () =>
      restoreWorkflowExecutionRequestContext({
        mode: 'user',
        userId: 'user_3',
        authorization: null,
        headers: {},
        method: 'POST',
        protocol: 'http',
        host: 'localhost:3001',
        origin: 'http://localhost:5174',
        path: '/api/v2/graphql',
        originalUrl: '/api/v2/graphql',
        query: null,
        body: null,
        ip: '127.0.0.1',
      }),
    /missing an authorization token/,
  );
});

test('restoreWorkflowExecutionRequestContext falls back to user supabase for plain bearer tokens', () => {
  const token = 'plain-user-token';
  const restored = restoreWorkflowExecutionRequestContext({
    mode: 'user',
    userId: 'user-plain',
    authorization: `Bearer ${token}`,
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    protocol: 'http',
    host: 'localhost:3001',
    origin: 'http://localhost:5174',
    path: '/api/v2/graphql',
    originalUrl: '/api/v2/graphql',
    query: null,
    body: null,
    ip: '127.0.0.1',
  });
  assert.equal(restored.request.headers.authorization, `Bearer ${token}`);
  assert.equal(restored.userId, 'user-plain');
});
