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
    status: 'queued' | 'running' | 'success' | 'error' | 'aborted';
    input?: unknown;
    output?: unknown;
    logs: string[];
    processId: string;
}
export interface WorkflowDebugEvent extends BaseRecord {
    workflowId: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
}
export interface WorkflowAISession extends BaseRecord {
    workflowId?: string;
    browserContext: Record<string, unknown>;
    messages: number;
}
export interface WorkflowValidation {
    valid: boolean;
    errors: string[];
    nodes: number;
}
export type ExecutorAdapter = (workflow: WorkflowRecord, input: unknown, context: RequestContext) => Promise<{
    output?: unknown;
    logs?: string[];
}> | {
    output?: unknown;
    logs?: string[];
};
export type WorkflowAIAgentAdapter = (input: {
    workflow?: WorkflowRecord;
    message: string;
    sessionId: string;
    mode: 'build' | 'debug' | 'run' | 'execute';
    preservedWorkflowContract?: string;
}, context: RequestContext) => Promise<{
    message: string;
    definitionPatch?: Record<string, unknown>;
    executeInput?: unknown;
    actions?: string[];
}> | {
    message: string;
    definitionPatch?: Record<string, unknown>;
    executeInput?: unknown;
    actions?: string[];
};
export interface NodesAdapter {
    importNodePackage?: (archive: unknown, context?: RequestContext) => Promise<unknown> | unknown;
    getObject?: (id: string, context?: RequestContext) => unknown;
}
export interface GigaAgentsAdapter {
    workflowAIAgent?: () => {
        run: (input: {
            message: string;
            workflow: WorkflowRecord;
            execute: (input?: unknown) => Promise<unknown>;
            browserContext: Record<string, unknown>;
        }, context: RequestContext) => Promise<{
            output?: string;
            actions?: string[];
            workflow?: unknown;
            validation?: unknown;
            execution?: unknown;
        }>;
    };
    runWorkflowAgent?: (input: {
        prompt: string;
        workflowId?: string;
        debug?: boolean;
        execute?: boolean;
    }, context?: RequestContext) => Promise<{
        artifact?: unknown;
    }> | {
        artifact?: unknown;
    };
}
export interface ProcessMonitoringLike {
    start?: (input: {
        kind: string;
        packageName: string;
        title: string;
        targetId?: string;
        context?: RequestContext;
        metadata?: Record<string, unknown>;
    }) => {
        id?: string;
        processId?: string;
    };
    register?: (input: {
        processId: string;
        kind?: string;
        packageName?: string;
        name?: string;
        metadata?: Record<string, unknown>;
    }, context?: RequestContext) => unknown;
    heartbeat?: (processId: string, input?: {
        status?: string;
        message?: string;
        metadata?: Record<string, unknown>;
    }) => unknown;
    appendLog?: (processId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => unknown;
    complete?: (processId: string, metadata?: Record<string, unknown>) => unknown;
    fail?: (processId: string, error: unknown, metadata?: Record<string, unknown>) => unknown;
    abort?: (processId: string, reason?: string) => unknown;
}
export interface WorkflowQueueStatus {
    processId: string;
    executionId: string;
    runId: string;
    workflowId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
    progress: number;
    source: 'executor-kafka' | 'local';
    updatedAt: string;
    logs: string[];
    metadata?: Record<string, unknown>;
}
export interface WorkflowExecutorPubSubBridge {
    queueWorkflowForExecution?: (config?: unknown) => {
        connect?: () => Promise<void>;
        disconnect?: () => Promise<void>;
        publish: (request: Record<string, unknown>) => Promise<void>;
    };
    consumeWorkflowExecutionEvents?: (options: {
        applyExecutionEvent: (event: Record<string, unknown>) => Promise<void> | void;
        config?: unknown;
        handleExecutionEventError?: (params: {
            error: unknown;
            event: unknown;
        }) => Promise<void> | void;
    }) => {
        start: () => Promise<void>;
        stop: (params?: {
            force?: boolean;
        }) => Promise<void>;
    };
    cancelRun?: (runId: string) => number | Promise<number>;
    cancelWorkflow?: (workflowId: string) => number | Promise<number>;
    getRunning?: (workflowId?: string | null) => Array<Record<string, unknown>>;
}
export declare const Workflows: {
    bindWithServer(_endpoint: string): /*elided*/ any;
    bindLogger(logger: unknown): /*elided*/ any;
    bindSockets(sockets: unknown): /*elided*/ any;
    bindProcessMonitor(monitor: ProcessMonitoringLike): /*elided*/ any;
    bindProcessMonitoring(monitor: ProcessMonitoringLike): /*elided*/ any;
    setExecutorAdapter(adapter: ExecutorAdapter): /*elided*/ any;
    bindNodes(adapter: NodesAdapter): /*elided*/ any;
    bindWorkflowAgent(adapter: WorkflowAIAgentAdapter): /*elided*/ any;
    useWorkflowAIAgent(adapter: WorkflowAIAgentAdapter | GigaAgentsAdapter): /*elided*/ any;
    bindGigaAgents(adapter: GigaAgentsAdapter): /*elided*/ any;
    configurePreservedWorkflowAI(adapter?: WorkflowAIAgentAdapter | {
        run: (input: {
            message: string;
            workflow: WorkflowRecord;
            execute: (input?: unknown) => Promise<unknown>;
            browserContext: Record<string, unknown>;
        }, context: RequestContext) => Promise<{
            output?: string;
            actions?: string[];
            execution?: unknown;
        }>;
    }): /*elided*/ any;
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
    abortExecution(executionId: string, context?: RequestContext): WorkflowExecution;
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
        workflowAIConfigured: boolean;
        panels: string[];
    };
    startAISession(workflowId?: string, browserContext?: Record<string, unknown>, context?: RequestContext): WorkflowAISession;
    buildWithAI(input: {
        message: string;
        workflowId?: string;
        sessionId?: string;
        name?: string;
    }, context?: RequestContext): Promise<{
        workflow: WorkflowRecord;
        sessionId: string;
        message: string;
        actions: string[];
    }>;
    debugWithAI(arg1: string, arg2: {
        message: string;
        sessionId?: string;
        execute?: boolean;
    } | string, arg3?: RequestContext): Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
    runWithAI(workflowId: string, message: string, context?: RequestContext): Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
    importNodePackage(archive: unknown, context?: RequestContext): Promise<{
        importedNode: unknown;
        workflowCatalogRefresh: boolean;
    }>;
    importNodePackageToWorkflow(workflowId: string, archive: unknown, position?: Record<string, unknown>, context?: RequestContext): Promise<{
        node: {
            id?: string;
            name?: string;
        };
        workflow: WorkflowRecord;
    }>;
    getDebugEvents(workflowId?: string, context?: RequestContext): WorkflowDebugEvent[];
    slash(args: string[], context?: RequestContext): string | WorkflowValidation | Promise<WorkflowExecution> | Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
    health(): PackageHealth;
};
export declare const Workflow: {
    bindWithServer(_endpoint: string): /*elided*/ any;
    bindLogger(logger: unknown): /*elided*/ any;
    bindSockets(sockets: unknown): /*elided*/ any;
    bindProcessMonitor(monitor: ProcessMonitoringLike): /*elided*/ any;
    bindProcessMonitoring(monitor: ProcessMonitoringLike): /*elided*/ any;
    setExecutorAdapter(adapter: ExecutorAdapter): /*elided*/ any;
    bindNodes(adapter: NodesAdapter): /*elided*/ any;
    bindWorkflowAgent(adapter: WorkflowAIAgentAdapter): /*elided*/ any;
    useWorkflowAIAgent(adapter: WorkflowAIAgentAdapter | GigaAgentsAdapter): /*elided*/ any;
    bindGigaAgents(adapter: GigaAgentsAdapter): /*elided*/ any;
    configurePreservedWorkflowAI(adapter?: WorkflowAIAgentAdapter | {
        run: (input: {
            message: string;
            workflow: WorkflowRecord;
            execute: (input?: unknown) => Promise<unknown>;
            browserContext: Record<string, unknown>;
        }, context: RequestContext) => Promise<{
            output?: string;
            actions?: string[];
            execution?: unknown;
        }>;
    }): /*elided*/ any;
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
    abortExecution(executionId: string, context?: RequestContext): WorkflowExecution;
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
        workflowAIConfigured: boolean;
        panels: string[];
    };
    startAISession(workflowId?: string, browserContext?: Record<string, unknown>, context?: RequestContext): WorkflowAISession;
    buildWithAI(input: {
        message: string;
        workflowId?: string;
        sessionId?: string;
        name?: string;
    }, context?: RequestContext): Promise<{
        workflow: WorkflowRecord;
        sessionId: string;
        message: string;
        actions: string[];
    }>;
    debugWithAI(arg1: string, arg2: {
        message: string;
        sessionId?: string;
        execute?: boolean;
    } | string, arg3?: RequestContext): Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
    runWithAI(workflowId: string, message: string, context?: RequestContext): Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
    importNodePackage(archive: unknown, context?: RequestContext): Promise<{
        importedNode: unknown;
        workflowCatalogRefresh: boolean;
    }>;
    importNodePackageToWorkflow(workflowId: string, archive: unknown, position?: Record<string, unknown>, context?: RequestContext): Promise<{
        node: {
            id?: string;
            name?: string;
        };
        workflow: WorkflowRecord;
    }>;
    getDebugEvents(workflowId?: string, context?: RequestContext): WorkflowDebugEvent[];
    slash(args: string[], context?: RequestContext): string | WorkflowValidation | Promise<WorkflowExecution> | Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
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
    handler: (args: string[], context: RequestContext) => string | WorkflowValidation | Promise<WorkflowExecution> | Promise<{
        sessionId: string;
        message: string;
        actions: string[];
        workflow: WorkflowRecord | undefined;
        execution: WorkflowExecution | undefined;
    }>;
}[];
export declare function openDesignerStub(workflowId?: string, context?: RequestContext): {
    mode: "stub";
    workflowId: string | undefined;
    title: string;
    context: {
        userId: string | undefined;
        organizationId: string | undefined;
    };
    panels: string[];
    workflowAIConfigured: boolean;
};
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
            workflowDebugEvents: (_: unknown, args: {
                workflowId?: string;
            }, ctx: RequestContext) => string;
            workflowQueueStatus: (_: unknown, args: {
                workflowId?: string;
            }) => string;
        };
        Mutation: {
            workflowCreate: (_: unknown, args: {
                name: string;
                description?: string;
            }, ctx: RequestContext) => WorkflowRecord;
            workflowExecute: (_: unknown, args: {
                id: string;
            }, ctx: RequestContext) => Promise<WorkflowExecution>;
            workflowDebugWithAI: (_: unknown, args: {
                id: string;
                message: string;
            }, ctx: RequestContext) => Promise<string>;
            workflowBuildWithAI: (_: unknown, args: {
                message: string;
                workflowId?: string;
            }, ctx: RequestContext) => Promise<string>;
            workflowImportNodePackage: (_: unknown, args: {
                workflowId: string;
                archive: string;
            }, ctx: RequestContext) => Promise<string>;
        };
    };
    migrations: string[];
};
export declare function createPackage(): PackageModule & {
    slashCommands: typeof workflowSlashCommands;
};
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './launcher.js';
