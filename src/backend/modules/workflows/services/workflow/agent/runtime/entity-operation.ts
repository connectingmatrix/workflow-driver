import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import {
  isAuthEntityOrOperationBlocked,
  listAgentEntityCapabilities,
  listAgentEntityNames,
  resolveAgentEntityClass,
} from '@connectingmatrix/ai-agents/services/agent/capabilities/entity-capability-registry';

type QueryBuilder<T = unknown> = {
  many?: () => Promise<T[]>;
  single?: () => Promise<T | null>;
  orderBy?: (field: string, direction?: string) => QueryBuilder<T>;
  limit?: (count: number) => QueryBuilder<T>;
  offset?: (count: number) => QueryBuilder<T>;
  whereIn?: (field: string, values: unknown[]) => QueryBuilder<T>;
};

type EntityClass = {
  load?: (id?: string) => Record<string, unknown>;
  create?: (payload: Record<string, unknown>) => Promise<unknown>;
  find?: (where?: Record<string, unknown>) => QueryBuilder<unknown>;
  single?: (where: string | Record<string, unknown>) => Promise<unknown>;
  bySlug?: (slug: string, where?: Record<string, unknown>) => Promise<unknown>;
};

const text = (value: unknown): string => String(value ?? '').trim();
const lower = (value: unknown): string => text(value).toLowerCase();
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const forbiddenAuthOperations = new Set([
  'signin',
  'signout',
  'signup',
  'login',
  'logout',
  'reset_password',
  'change_password',
  'forgot_password',
  'refresh_token',
  'set_session',
]);
const destructiveOperations = new Set(['delete', 'remove', 'unlink', 'detach']);
const adminTerms = /root|super.?admin|paid|platform|reset.?login|deactivate|disable|all users|subscription|plan policy|usage/i;

const requireContext = () => EntityRequestContext.current();

const normalizeEntityName = (value: unknown): string => {
  const raw = text(value).replace(/Entity$/i, '');
  if (!raw) return '';
  return raw[0].toUpperCase() + raw.slice(1);
};

const inferTreeRelation = (parentEntity: string, childEntity: string, requested?: string): string => {
  if (requested) return requested;
  const parent = normalizeEntityName(parentEntity);
  const child = normalizeEntityName(childEntity);
  if (parent === 'Channel' && child === 'Channel') return 'children';
  if (parent === 'Channel' && child === 'Category') return 'categories';
  if (parent === 'Channel' && child === 'Subject') return 'subjects';
  if (parent === 'Channel' && child === 'Post') return 'posts';
  if (parent === 'Category' && child === 'Subject') return 'subjects';
  if (parent === 'Category' && child === 'Post') return 'posts';
  if (parent === 'Subject' && child === 'Post') return 'posts';
  return child ? `${child[0].toLowerCase()}${child.slice(1)}s` : 'children';
};

const extractPayload = (input: Record<string, unknown>): Record<string, unknown> => {
  const payload = record(input.payload || input.data || input.values || input.node || input.entityData || input.body);
  if (Object.keys(payload).length) return payload;
  const ignored = new Set([
    'entity',
    'type',
    'resource',
    'model',
    'operation',
    'action',
    'id',
    'entityId',
    'parentId',
    'parentEntity',
    'childId',
    'childEntity',
    'targetId',
    'targetEntity',
    'relation',
    'collection',
    'confirmed',
    'context',
    'where',
    'filter',
    'prompt',
    'message',
    'query',
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (!ignored.has(key) && value !== undefined) output[key] = value;
  return output;
};

const loadRelationManager = (Entity: EntityClass, id: string, relation: string) => {
  if (!Entity.load) throw new Error('Entity does not support load().');
  const ref = Entity.load(id) as Record<string, unknown>;
  const manager = ref[relation] as Record<string, unknown> | undefined;
  if (!manager) throw new Error(`Relation ${relation} is not defined on entity.`);
  return manager;
};

const callRelation = async (manager: Record<string, unknown>, operation: string, input: Record<string, unknown>) => {
  const where = record(input.where || input.filter);
  const payload = extractPayload(input);
  if (operation === 'create') {
    const create = manager.create as ((payload: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (!create) throw new Error('Relation create is not available.');
    return create(payload);
  }
  if (['list', 'many', 'read', 'find'].includes(operation)) {
    const find = manager.find as ((where?: Record<string, unknown>) => QueryBuilder<unknown>) | undefined;
    const query = find ? find(where) : (manager as QueryBuilder<unknown>);
    if (typeof query.many === 'function') return query.many();
    const relationList = manager.list as (() => Promise<unknown[]>) | undefined;
    if (relationList) return relationList();
    return [];
  }
  if (['single', 'get'].includes(operation)) {
    const single = manager.single as ((where?: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (single) return single(Object.keys(where).length ? where : payload);
    const find = manager.find as ((where?: Record<string, unknown>) => QueryBuilder<unknown>) | undefined;
    const query = find ? find(Object.keys(where).length ? where : payload) : (manager as QueryBuilder<unknown>);
    if (typeof query.single === 'function') return query.single();
    return null;
  }
  if (operation === 'attach' || operation === 'link') {
    const attach = (manager.attach || manager.link) as ((child: unknown) => Promise<unknown>) | undefined;
    if (!attach) throw new Error('Relation attach/link is not available.');
    return attach(input.childId || input.targetId || input.id || payload);
  }
  if (operation === 'detach' || operation === 'unlink') {
    const detach = (manager.detach || manager.unlink) as ((child: unknown) => Promise<unknown>) | undefined;
    if (!detach) throw new Error('Relation detach/unlink is not available.');
    return detach(input.childId || input.targetId || input.id || payload);
  }
  throw new Error(`Relation operation ${operation} is not supported.`);
};

const checkConfirmation = (operation: string, input: Record<string, unknown>) => {
  const confirmed = input.confirmed === true || record(input.context).confirmed === true;
  const cancelOnDestructive = input.cancelOnDestructive === true || input.cancel_on_destructive === true;
  const prompt = text(input.prompt || input.message || input.query);
  if ((destructiveOperations.has(operation) || adminTerms.test(prompt)) && !confirmed) {
    if (cancelOnDestructive) return { status: 'cancelled', summary: 'Operation cancelled by destructive-operation policy.', input };
    return {
      status: 'confirmation_required',
      summary: 'Confirmation is required before executing this entity operation.',
      reason: destructiveOperations.has(operation) ? 'destructive operation' : 'admin-sensitive operation',
      input,
    };
  }
  return null;
};

const summarizeCapabilityMatch = (input: Record<string, unknown>) => {
  const prompt = text(input.prompt || input.message || input.query);
  return {
    summary:
      'Entity operation stayed in planning mode. Use the capability list to emit a structured entity.operation/tree.operation with entity, operation, id/where/data/relation.',
    prompt,
    entities: listAgentEntityNames(),
    capabilities: listAgentEntityCapabilities().slice(0, 300),
  };
};

const inferRefetchSignals = (entity: string, relation: string, operation: string) => {
  const target = `${entity} ${relation}`.toLowerCase();
  const mutating = ['create', 'update', 'delete', 'remove', 'attach', 'detach', 'link', 'unlink'].includes(operation);
  if (!mutating) return [] as string[];
  const signals = new Set<string>();
  if (/channel|category|subject|post|tree/.test(target)) signals.add('user-tree');
  if (/organisation|organization/.test(target)) signals.add('org-tree');
  if (/workflow/.test(target)) signals.add('workflow-list');
  if (/chat|message/.test(target)) signals.add('chat');
  if (/artifact|attachment|file/.test(target)) signals.add('artifacts');
  return Array.from(signals);
};

const readEntityId = (value: unknown): string => {
  const row = record(value);
  const getId = row.getId as (() => unknown) | undefined;
  if (typeof getId === 'function') return text(getId.call(value));
  return text(row.id || row.entityId || row.entity_id || record(row.data).id || record(row.payload).id);
};

const relationLookupWhere = (entityName: string, value: string): Array<Record<string, unknown>> => {
  if (!value) return [];
  if (entityName === 'Post') return [{ title: value }, { slug: value }];
  return [{ name: value }, { slug: value }];
};

const resolveEntityIdByName = async (entityName: string, id: string, name: string): Promise<string> => {
  if (id) return id;
  if (!entityName || !name) return '';
  const Entity = resolveAgentEntityClass(entityName) as EntityClass;
  if (!Entity.find) return '';
  for (const where of relationLookupWhere(entityName, name)) {
    const found = await Entity.find(where).single?.();
    const foundId = readEntityId(found);
    if (foundId) return foundId;
  }
  return '';
};

const buildRelationInput = (input: Record<string, unknown>, operation: string) => {
  const parentEntity = normalizeEntityName(
    input.parentEntity ||
      input.parent_entity ||
      input.ownerEntity ||
      input.owner_entity ||
      input.entity ||
      input.type ||
      input.resource ||
      input.model,
  );
  const childEntity = normalizeEntityName(
    input.childEntity ||
      input.child_entity ||
      input.targetEntity ||
      input.target_entity ||
      input.childType ||
      input.targetType ||
      input.child ||
      input.target ||
      input.entity,
  );
  const relation = inferTreeRelation(parentEntity, childEntity, text(input.relation || input.collection));
  const parentId = text(
    input.parentId ||
      input.parent_id ||
      input.ownerId ||
      input.owner_id ||
      input.channelId ||
      input.channel_id ||
      input.categoryId ||
      input.category_id ||
      input.subjectId ||
      input.subject_id ||
      input.postId ||
      input.post_id,
  );
  const parentName = text(
    input.parentName ||
      input.parent_name ||
      input.ownerName ||
      input.owner_name ||
      input.channelName ||
      input.channel_name ||
      input.categoryName ||
      input.category_name ||
      input.subjectName ||
      input.subject_name ||
      input.postTitle ||
      input.post_title,
  );
  const childId = text(input.childId || input.child_id || input.targetId || input.target_id || input.id || input.entityId || input.entity_id);
  const childName = text(
    input.childName ||
      input.child_name ||
      input.targetName ||
      input.target_name ||
      input.subjectName ||
      input.subject_name ||
      input.categoryName ||
      input.category_name ||
      input.channelName ||
      input.channel_name ||
      input.postTitle ||
      input.post_title,
  );
  if (!parentEntity) throw new Error(`${operation} requires parentEntity/entity.`);
  return { parentEntity, childEntity, relation, parentId, parentName, childId, childName };
};

const executeRelationOperation = async (input: Record<string, unknown>, operation: string) => {
  const { parentEntity, childEntity, relation, parentId, parentName, childId, childName } = buildRelationInput(input, operation);
  const resolvedParentId = await resolveEntityIdByName(parentEntity, parentId, parentName);
  if (!resolvedParentId) throw new Error(`${operation} requires parentId.`);
  const resolvedChildId = await resolveEntityIdByName(childEntity, childId, childName);
  const Parent = resolveAgentEntityClass(parentEntity) as EntityClass;
  const relationInput = {
    ...input,
    id: resolvedChildId || input.id,
    childId: resolvedChildId || input.childId,
    targetId: resolvedChildId || input.targetId,
  };
  const data = await callRelation(loadRelationManager(Parent, resolvedParentId, relation), operation, relationInput);
  return {
    summary: `${parentEntity}.${relation}.${operation}${childEntity ? ` ${childEntity}` : ''} completed.`,
    data,
    parentEntity,
    parentId: resolvedParentId,
    childEntity,
    childId: resolvedChildId || null,
    relation,
    effects: { refetch: inferRefetchSignals(parentEntity, relation, operation) },
  };
};

export const batchEntityOperations = async (items: unknown[]) => {
  const outputs: unknown[] = [];
  for (const item of list(items).map(record)) outputs.push(await executeEntityAgentOperation(item));
  return { summary: `Executed ${outputs.length} entity operation(s).`, outputs };
};

export const executeEntityAgentOperation = async (input: Record<string, unknown>) => {
  requireContext();
  const operation = lower(input.operation || input.action || 'auto');
  if (forbiddenAuthOperations.has(operation)) throw new Error(`Auth operation ${operation} is intentionally not available to the AI agent.`);
  if (operation === 'auto') return summarizeCapabilityMatch(input);
  if (operation === 'capabilities' || operation === 'list_capabilities')
    return { entities: listAgentEntityNames(), capabilities: listAgentEntityCapabilities() };
  if (operation === 'batch') return batchEntityOperations(list(input.items || input.operations));

  if (
    ['link', 'unlink', 'attach', 'detach'].includes(operation) &&
    (input.parentEntity || input.parentId || input.relation || input.childEntity || input.targetEntity)
  ) {
    const confirmation = checkConfirmation(operation, input);
    if (confirmation) return confirmation;
    return executeRelationOperation(input, operation);
  }

  const entityName = normalizeEntityName(input.entity || input.type || input.resource || input.model);
  if (!entityName) throw new Error('entity.operation requires entity.');
  if (isAuthEntityOrOperationBlocked(entityName, operation)) throw new Error(`Blocked auth operation/entity: ${entityName}.${operation}`);
  if (entityName === 'Post' && ['link', 'unlink', 'attach', 'detach'].includes(operation) && !input.parentEntity && !input.parentId) {
    throw new Error('Post cannot be linked/unlinked directly. Use Subject.posts.attach/detach or another parent relation manager.');
  }

  const confirmation = checkConfirmation(operation, input);
  if (confirmation) return confirmation;

  const Entity = resolveAgentEntityClass(entityName) as EntityClass;
  const id = text(input.id || input.entityId || input.entity_id || input.ownerId || input.owner_id);
  const relation = text(input.relation || input.collection);
  if (entityName === 'Post' && ['link', 'unlink'].includes(operation)) {
    throw new Error('Post cannot be linked/unlinked directly. Use a parent relation such as Subject.posts.attach/detach.');
  }
  const payload = extractPayload(input);
  const where = record(input.where || input.filter || (Object.keys(payload).length ? payload : {}));
  const slug = text(input.slug || where.slug || payload.slug);

  if (relation) {
    const parentId = text(input.parentId || input.parent_id || id || record(input.parent).id);
    if (!parentId) throw new Error('relation operation requires parent id.');
    const data = await callRelation(loadRelationManager(Entity, parentId, relation), operation, input);
    return {
      summary: `${entityName}.${relation}.${operation} completed.`,
      data,
      effects: { refetch: inferRefetchSignals(entityName, relation, operation) },
    };
  }
  if (operation === 'create') {
    if (!Entity.create) throw new Error(`${entityName}.create is not available.`);
    const result = await Entity.create(payload);
    return { summary: `${entityName}.create completed.`, data: result, effects: { refetch: inferRefetchSignals(entityName, '', operation) } };
  }
  if (operation === 'update') {
    if (!id) throw new Error('update requires id.');
    const entity = Entity.load?.(id) as { update?: (patch: Record<string, unknown>) => Promise<unknown> } | undefined;
    if (!entity?.update) throw new Error(`${entityName}.load(id).update is not available.`);
    const result = await entity.update(payload);
    return { summary: `${entityName}.update completed.`, data: result, effects: { refetch: inferRefetchSignals(entityName, '', operation) } };
  }
  if (operation === 'delete' || operation === 'remove') {
    if (!id) throw new Error('delete requires id.');
    const entity = Entity.load?.(id) as { delete?: () => Promise<unknown> } | undefined;
    if (!entity?.delete) throw new Error(`${entityName}.load(id).delete is not available.`);
    const result = await entity.delete();
    return { summary: `${entityName}.delete completed.`, data: result, effects: { refetch: inferRefetchSignals(entityName, '', operation) } };
  }
  if (['read', 'single', 'get'].includes(operation)) {
    if (slug && Entity.bySlug) return { summary: `${entityName}.bySlug completed.`, data: await Entity.bySlug(slug, where) };
    if (slug && Entity.find) return { summary: `${entityName}.find(slug).single completed.`, data: await Entity.find({ ...where, slug }).single?.() };
    if (Entity.single) return { summary: `${entityName}.single completed.`, data: await Entity.single(id || where) };
    return { summary: `${entityName}.find.single completed.`, data: (await Entity.find?.(where).single?.()) || null };
  }
  if (operation === 'by_slug' || operation === 'get_by_slug') {
    if (!slug) throw new Error('get_by_slug requires slug.');
    if (Entity.bySlug) return { summary: `${entityName}.bySlug completed.`, data: await Entity.bySlug(slug, where) };
    return { summary: `${entityName}.find(slug).single completed.`, data: (await Entity.find?.({ ...where, slug }).single?.()) || null };
  }
  if (operation === 'list' || operation === 'many' || operation === 'find')
    return { summary: `${entityName}.find.many completed.`, data: (await Entity.find?.(where).many?.()) || [] };
  if (operation === 'execute' || operation === 'publish') {
    const loaded = Entity.load?.(id) as Record<string, unknown> | undefined;
    const method = loaded?.[operation] as ((payload?: Record<string, unknown>) => Promise<unknown>) | undefined;
    if (!method) throw new Error(`${entityName}.${operation} is not available.`);
    const result = await method.call(loaded, payload);
    return { summary: `${entityName}.${operation} completed.`, data: result, effects: { refetch: inferRefetchSignals(entityName, '', operation) } };
  }
  throw new Error(`Unsupported entity operation: ${operation}`);
};
