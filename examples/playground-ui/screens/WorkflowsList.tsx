import { useState, useEffect } from 'react';
import { Play, Pause, Clock, CheckCircle, AlertCircle, GitBranch, Activity, Plus, Edit, MessageSquare, ExternalLink } from 'lucide-react';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { useNavigate } from 'react-router';
import { listWorkflows, subscribeWorkflowCatalog } from '@giga/dataloader/client/legacy/dataloaders';
import { useUiDataContext } from '../contexts/AuthSessionContext';
import { chatRoute } from '../data/chatRoute';
import type { EntityRecord } from '@giga/dataloader/client/legacy/orm';

interface ChatAttachment {
    id: string;
    name: string;
    context: string;
    lastUsed: string;
    messageCount: number;
}

interface Workflow {
    id: string;
    name: string;
    description: string;
    running: number;
    queued: number;
    totalExecutions: number;
    lastRun: string;
    status: 'active' | 'paused' | 'error';
    versions: number;
    attachedChats: ChatAttachment[];
    executions: WorkflowExecution[];
    versionHistory: WorkflowVersion[];
}

interface WorkflowExecution {
    id: string;
    workflowId: string;
    version: string;
    status: 'running' | 'completed' | 'failed' | 'queued';
    startedAt: string;
    completedAt?: string;
    duration?: string;
    progress?: number;
}

interface WorkflowVersion {
    id: string;
    version: string;
    createdAt: string;
    createdBy: string;
    changes: string;
    active: boolean;
}

type WorkflowRecord = EntityRecord & {
    status: Workflow['status'];
    data: {
        running: number;
        queued: number;
        totalExecutions: number;
        lastRun: string;
        versionCount: number;
        attachedChats: ChatAttachment[];
        executions: WorkflowExecution[];
        versions: WorkflowVersion[];
    };
};

export default function WorkflowsList() {
    const context = useUiDataContext();
    const navigate = useNavigate();
    const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'executions' | 'versions' | 'chats'>('executions');
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        let unsubscribe: () => void = () => undefined;
        setLoading(true);
        setError(null);

        const loadWorkflowList = async () => {
            const result = await listWorkflows(context);
            const rows = result.rows as WorkflowRecord[];
            const nextWorkflows = rows.map((row) => ({
                id: row.id,
                name: row.title,
                description: row.subtitle,
                running: row.data.running,
                queued: row.data.queued,
                totalExecutions: row.data.totalExecutions,
                lastRun: row.data.lastRun,
                status: row.status,
                versions: row.data.versionCount,
                attachedChats: row.data.attachedChats,
                executions: row.data.executions,
                versionHistory: row.data.versions
            }));

            if (active) {
                setWorkflows(nextWorkflows);
                setSelectedWorkflow((current) => current || nextWorkflows[0]?.id || null);
                if (nextWorkflows.length === 0) navigate('/workflow-builder', { replace: true });
                setLoading(false);
            }
        };

        void loadWorkflowList().catch((failure: Error) => {
            if (active) {
                setError(failure);
                setLoading(false);
            }
        });
        try {
            unsubscribe = subscribeWorkflowCatalog(context, () => void loadWorkflowList().catch((failure: Error) => setError(failure)));
        } catch (failure) {
            if (failure instanceof Error) setError(failure);
        }
        return () => {
            active = false;
            unsubscribe();
        };
    }, [context, navigate, reloadKey]);

    const selectedWorkflowData = workflows.find((w) => w.id === selectedWorkflow);

    if (loading) {
        return (
            <div className="p-6">
                <LoadingState type="skeleton-list" count={8} />
            </div>
        );
    }

    if (error) return <ErrorState title="Failed to load workflows" message={error.message} onRetry={() => setReloadKey((value) => value + 1)} />;

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'active':
                return <Play className="w-4 h-4 text-green-500" />;
            case 'paused':
                return <Pause className="w-4 h-4 text-yellow-500" />;
            case 'error':
                return <AlertCircle className="w-4 h-4 text-red-500" />;
            default:
                return null;
        }
    };

    const getExecutionStatusBadge = (status: string) => {
        switch (status) {
            case 'running':
                return <Badge variant="info">Running</Badge>;
            case 'completed':
                return <Badge variant="success">Completed</Badge>;
            case 'failed':
                return <Badge variant="danger">Failed</Badge>;
            case 'queued':
                return <Badge variant="warning">Queued</Badge>;
            default:
                return null;
        }
    };

    return (
        <div className="h-full min-h-0 bg-background dark:bg-[#0a0a0a]">
            <div className="flex h-full min-h-0">
                {/* Left Sidebar - Workflows List */}
                <div className="giga-scrollbar w-96 overflow-y-auto border-r border-border bg-white dark:border-[#2a2a2a] dark:bg-[#0f0f0f]">
                    <div className="p-6 border-b border-border dark:border-[#2a2a2a]">
                        <div className="flex items-center justify-between mb-2">
                            <h1 className="text-2xl font-bold dark:text-gray-100">Workflows</h1>
                            <Button size="sm" onClick={() => navigate('/workflow-builder')} className="gap-2">
                                <Plus className="w-4 h-4" />
                                New
                            </Button>
                        </div>
                        <p className="text-sm text-muted-foreground dark:text-gray-400">{workflows.length} workflows</p>
                    </div>

                    <div className="divide-y divide-border dark:divide-[#2a2a2a]">
                        {workflows.map((workflow) => (
                            <div
                                key={workflow.id}
                                onClick={() => setSelectedWorkflow(workflow.id)}
                                className={`p-4 cursor-pointer hover:bg-secondary/50 dark:hover:bg-[#1a1a1a] transition-colors ${selectedWorkflow === workflow.id ? 'bg-primary/5 dark:bg-primary/10 border-l-4 border-primary' : ''}`}
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        {getStatusIcon(workflow.status)}
                                        <h3 className="font-semibold dark:text-gray-100">{workflow.name}</h3>
                                    </div>
                                </div>

                                <p className="text-sm text-muted-foreground dark:text-gray-400 mb-3">{workflow.description}</p>

                                <div className="flex items-center gap-4 text-xs">
                                    {workflow.running > 0 && (
                                        <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                            <span className="font-medium">{workflow.running} running</span>
                                        </div>
                                    )}
                                    {workflow.queued > 0 && (
                                        <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                                            <Clock className="w-3 h-3" />
                                            <span className="font-medium">{workflow.queued} queued</span>
                                        </div>
                                    )}
                                    <span className="text-muted-foreground dark:text-gray-500">{workflow.totalExecutions.toLocaleString()} total</span>
                                </div>

                                <div className="mt-2 text-xs text-muted-foreground dark:text-gray-500">Last run: {workflow.lastRun}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Panel - Workflow Details */}
                <div className="giga-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {selectedWorkflowData ? (
                        <div>
                            {/* Header */}
                            <div className="border-b border-border dark:border-[#2a2a2a] bg-white dark:bg-[#0f0f0f] sticky top-0 z-10">
                                <div className="p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h2 className="text-2xl font-bold dark:text-gray-100 mb-2">{selectedWorkflowData.name}</h2>
                                            <p className="text-muted-foreground dark:text-gray-400">{selectedWorkflowData.description}</p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2">
                                                {getStatusIcon(selectedWorkflowData.status)}
                                                <span className="text-sm font-medium capitalize dark:text-gray-300">{selectedWorkflowData.status}</span>
                                            </div>
                                            <Button size="sm" onClick={() => navigate(`/workflow-editor?id=${selectedWorkflow}&mode=edit`)} className="gap-2">
                                                <Edit className="w-4 h-4" />
                                                Edit
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="grid grid-cols-4 gap-4 mb-6">
                                        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Activity className="w-4 h-4 text-green-600 dark:text-green-400" />
                                                <span className="text-xs text-muted-foreground dark:text-gray-400">Running</span>
                                            </div>
                                            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{selectedWorkflowData.running}</div>
                                        </Card>

                                        <Card className="bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                                                <span className="text-xs text-muted-foreground dark:text-gray-400">Queued</span>
                                            </div>
                                            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{selectedWorkflowData.queued}</div>
                                        </Card>

                                        <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                                            <div className="flex items-center gap-2 mb-1">
                                                <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                                <span className="text-xs text-muted-foreground dark:text-gray-400">Total Executions</span>
                                            </div>
                                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{selectedWorkflowData.totalExecutions.toLocaleString()}</div>
                                        </Card>

                                        <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                                            <div className="flex items-center gap-2 mb-1">
                                                <GitBranch className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                                <span className="text-xs text-muted-foreground dark:text-gray-400">Versions</span>
                                            </div>
                                            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{selectedWorkflowData.versions}</div>
                                        </Card>
                                    </div>

                                    {/* Tabs */}
                                    <div className="flex gap-4 border-b border-border dark:border-[#2a2a2a]">
                                        <button
                                            onClick={() => setActiveTab('executions')}
                                            className={`pb-3 px-1 font-medium transition-colors relative ${
                                                activeTab === 'executions' ? 'text-primary dark:text-primary' : 'text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200'
                                            }`}
                                        >
                                            Executions
                                            {activeTab === 'executions' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('versions')}
                                            className={`pb-3 px-1 font-medium transition-colors relative ${
                                                activeTab === 'versions' ? 'text-primary dark:text-primary' : 'text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200'
                                            }`}
                                        >
                                            Versions
                                            {activeTab === 'versions' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('chats')}
                                            className={`pb-3 px-1 font-medium transition-colors relative ${
                                                activeTab === 'chats' ? 'text-primary dark:text-primary' : 'text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <MessageSquare className="w-4 h-4" />
                                                Attached Chats
                                                {selectedWorkflowData && selectedWorkflowData.attachedChats.length > 0 && (
                                                    <Badge variant="default" className="ml-1 text-xs">
                                                        {selectedWorkflowData.attachedChats.length}
                                                    </Badge>
                                                )}
                                            </div>
                                            {activeTab === 'chats' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Tab Content */}
                            <div className="p-6">
                                {activeTab === 'executions' ? (
                                    <div className="space-y-3">
                                        <h3 className="font-semibold mb-4 dark:text-gray-100">Execution History</h3>
                                        {selectedWorkflowData.executions.map((execution) => (
                                            <Card
                                                key={execution.id}
                                                className="hover:border-primary/50 dark:hover:border-primary/50 transition-colors cursor-pointer"
                                                onClick={() => navigate(`/workflow-editor?id=${execution.workflowId}&executionId=${execution.id}&mode=readonly`)}
                                            >
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        {getExecutionStatusBadge(execution.status)}
                                                        <span className="text-sm font-mono text-muted-foreground dark:text-gray-400">{execution.id}</span>
                                                    </div>
                                                    <span className="text-xs text-muted-foreground dark:text-gray-500">{execution.version}</span>
                                                </div>

                                                {execution.status === 'running' && execution.progress !== undefined && (
                                                    <div className="mb-3">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs text-muted-foreground dark:text-gray-400">Progress</span>
                                                            <span className="text-xs font-medium dark:text-gray-300">{execution.progress}%</span>
                                                        </div>
                                                        <div className="h-2 bg-secondary dark:bg-[#2a2a2a] rounded-full overflow-hidden">
                                                            <div className="h-full bg-primary transition-all duration-500 ease-out relative overflow-hidden" style={{ width: `${execution.progress}%` }}>
                                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-4 text-xs text-muted-foreground dark:text-gray-500">
                                                    <span>Started: {execution.startedAt}</span>
                                                    {execution.completedAt && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Completed: {execution.completedAt}</span>
                                                        </>
                                                    )}
                                                    {execution.duration && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Duration: {execution.duration}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                ) : activeTab === 'versions' ? (
                                    <div className="space-y-3">
                                        <h3 className="font-semibold mb-4 dark:text-gray-100">Version History</h3>
                                        {selectedWorkflowData.versionHistory.map((version) => (
                                            <Card key={version.id} className={`hover:border-primary/50 dark:hover:border-primary/50 transition-colors ${version.active ? 'border-primary dark:border-primary' : ''}`}>
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                                            <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h4 className="font-semibold dark:text-gray-100">{version.version}</h4>
                                                                {version.active && <Badge variant="success">Active</Badge>}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground dark:text-gray-500 mt-1">
                                                                {version.createdAt} by {version.createdBy}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <p className="text-sm text-muted-foreground dark:text-gray-400">{version.changes}</p>
                                            </Card>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <h3 className="font-semibold dark:text-gray-100 flex items-center gap-2">
                                            <MessageSquare className="w-5 h-5" />
                                            Attached Chats
                                        </h3>

                                        {selectedWorkflowData.attachedChats.length > 0 ? (
                                            <div className="space-y-3">
                                                {selectedWorkflowData.attachedChats.map((chat) => (
                                                    <Card key={chat.id} className="hover:border-primary/50 dark:hover:border-primary/50 transition-all">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <h4 className="font-medium dark:text-gray-100 truncate">{chat.name}</h4>
                                                                    <span className="text-xs text-muted-foreground dark:text-gray-500">{chat.messageCount} messages</span>
                                                                </div>
                                                                <p className="text-sm text-muted-foreground dark:text-gray-400">{chat.context}</p>
                                                                <p className="text-xs text-muted-foreground dark:text-gray-500 mt-1">Last used: {chat.lastUsed}</p>
                                                            </div>
                                                            <Button size="sm" variant="outline" onClick={() => navigate(chatRoute(undefined, '', { workflowId: selectedWorkflowData.id }))} className="gap-2 flex-shrink-0">
                                                                <ExternalLink className="w-3.5 h-3.5" />
                                                                Open Chat
                                                            </Button>
                                                        </div>
                                                    </Card>
                                                ))}
                                            </div>
                                        ) : (
                                            <Card className="text-center py-12">
                                                <div className="w-16 h-16 bg-secondary dark:bg-[#2a2a2a] rounded-full flex items-center justify-center mx-auto mb-4">
                                                    <MessageSquare className="w-8 h-8 text-muted-foreground dark:text-gray-500" />
                                                </div>
                                                <h4 className="font-semibold mb-2 dark:text-gray-100">No chats attached</h4>
                                                <p className="text-sm text-muted-foreground dark:text-gray-400">This workflow is not attached to any chats yet</p>
                                            </Card>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <div className="text-center">
                                <Activity className="w-12 h-12 text-muted-foreground dark:text-gray-600 mx-auto mb-4" />
                                <h3 className="text-lg font-semibold mb-2 dark:text-gray-300">No workflow selected</h3>
                                <p className="text-sm text-muted-foreground dark:text-gray-400">Select a workflow from the list to view details</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
