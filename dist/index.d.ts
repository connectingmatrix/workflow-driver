import { type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { type BaseRecord } from './entity/repository.js';
export interface WorkflowRecord extends BaseRecord {
    name: string;
    description?: string;
    definition: Record<string, unknown>;
    publishedVersionId?: string;
}
export interface WorkflowVersion extends BaseRecord {
    workflowId: string;
    definition: Record<string, unknown>;
    version: number;
    published: boolean;
}
export interface WorkflowExecution extends BaseRecord {
    workflowId: string;
    status: 'queued' | 'running' | 'success' | 'error';
    input?: unknown;
    output?: unknown;
    logs: string[];
}
export interface WorkflowValidation {
    valid: boolean;
    errors: string[];
    nodes: number;
}
type ExecutorAdapter = (workflow: WorkflowRecord, input: unknown, context: RequestContext) => Promise<{
    output?: unknown;
    logs?: string[];
}>;
export declare const Workflows: {
    bindWithServer(_endpoint: string): /*elided*/ any;
    setExecutorAdapter(adapter: ExecutorAdapter): /*elided*/ any;
    getList(pagination?: PaginationOptions, context?: RequestContext): import("./contracts.js").ListResult<WorkflowRecord>;
    getObject(id: string, context?: RequestContext): WorkflowRecord | undefined;
    search(term: string, context?: RequestContext): WorkflowRecord[];
    create(input: {
        name: string;
        description?: string;
        definition?: Record<string, unknown>;
    }, context?: RequestContext): WorkflowRecord;
    update(id: string, patch: Partial<WorkflowRecord>, context?: RequestContext): WorkflowRecord;
    delete(id: string, context?: RequestContext): boolean;
    validate(id: string, context?: RequestContext): WorkflowValidation;
    execute(id: string, input?: unknown, context?: RequestContext): Promise<WorkflowExecution>;
    versions(workflowId: string, context?: RequestContext): WorkflowVersion[];
    versionsDelete(workflowId: string, versionId: string, context?: RequestContext): boolean;
    versionsPublish(workflowId: string, versionId: string, context?: RequestContext): WorkflowVersion;
    executions: {
        list(workflowId?: string, context?: RequestContext): WorkflowExecution[];
    };
    onWorkflowExecute(handler: (execution: WorkflowExecution) => void | Promise<void>): () => void;
    onWorkflowCatalog(handler: (workflow: WorkflowRecord) => void | Promise<void>): () => void;
    openDesigner(id: string, context?: RequestContext): {
        workflow: WorkflowRecord;
        designer: string;
        contract: string;
    };
    slash(args: string[], context?: RequestContext): string | WorkflowValidation | Promise<WorkflowExecution>;
    health(): PackageHealth;
};
export declare const Workflow: {
    bindWithServer(_endpoint: string): /*elided*/ any;
    setExecutorAdapter(adapter: ExecutorAdapter): /*elided*/ any;
    getList(pagination?: PaginationOptions, context?: RequestContext): import("./contracts.js").ListResult<WorkflowRecord>;
    getObject(id: string, context?: RequestContext): WorkflowRecord | undefined;
    search(term: string, context?: RequestContext): WorkflowRecord[];
    create(input: {
        name: string;
        description?: string;
        definition?: Record<string, unknown>;
    }, context?: RequestContext): WorkflowRecord;
    update(id: string, patch: Partial<WorkflowRecord>, context?: RequestContext): WorkflowRecord;
    delete(id: string, context?: RequestContext): boolean;
    validate(id: string, context?: RequestContext): WorkflowValidation;
    execute(id: string, input?: unknown, context?: RequestContext): Promise<WorkflowExecution>;
    versions(workflowId: string, context?: RequestContext): WorkflowVersion[];
    versionsDelete(workflowId: string, versionId: string, context?: RequestContext): boolean;
    versionsPublish(workflowId: string, versionId: string, context?: RequestContext): WorkflowVersion;
    executions: {
        list(workflowId?: string, context?: RequestContext): WorkflowExecution[];
    };
    onWorkflowExecute(handler: (execution: WorkflowExecution) => void | Promise<void>): () => void;
    onWorkflowCatalog(handler: (workflow: WorkflowRecord) => void | Promise<void>): () => void;
    openDesigner(id: string, context?: RequestContext): {
        workflow: WorkflowRecord;
        designer: string;
        contract: string;
    };
    slash(args: string[], context?: RequestContext): string | WorkflowValidation | Promise<WorkflowExecution>;
    health(): PackageHealth;
} & {
    versions: typeof Workflows.versions & {
        delete: typeof Workflows.versionsDelete;
        publish: typeof Workflows.versionsPublish;
    };
};
export declare const workflowSlashCommands: {
    command: string;
    owner: string;
    description: string;
    handler: (args: string[], context: RequestContext) => string | WorkflowValidation | Promise<WorkflowExecution>;
}[];
export declare const graphql: {
    namespace: string;
    typeDefs: string;
    resolvers: {
        Query: {
            workflowList: (_: unknown, args: PaginationOptions, ctx: RequestContext) => WorkflowRecord[];
            workflowGet: (_: unknown, args: {
                id: string;
            }, ctx: RequestContext) => WorkflowRecord | undefined;
            workflowHealth: () => "ok" | "degraded" | "down";
        };
        Mutation: {
            workflowCreate: (_: unknown, args: {
                name: string;
                description?: string;
            }, ctx: RequestContext) => WorkflowRecord;
            workflowExecute: (_: unknown, args: {
                id: string;
            }, ctx: RequestContext) => Promise<WorkflowExecution>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule & {
    slashCommands: typeof workflowSlashCommands;
};
export * from './contracts.js';
