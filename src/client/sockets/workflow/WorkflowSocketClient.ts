import { io, Socket } from 'socket.io-client';
import { API_ORIGIN, WORKFLOW_WS_URL } from '@giga/dataloader/client/legacy/graphql/env';
import { resolveSocketConfig } from '../core/socket-url';

export type WorkflowSocketEvent = {
    type: 'workflow:catalog:status' | 'workflow:execution:update' | 'workflow:event';
    payload: unknown;
};

export class WorkflowSocketClient {
    private socket: Socket | null = null;

    public constructor(private readonly token: string) {}

    public connect(handler: (event: WorkflowSocketEvent) => void): () => void {
        const { url, path } = resolveSocketConfig(WORKFLOW_WS_URL, { url: API_ORIGIN, path: '/ws/workflow' });
        const socket = io(url, { path, transports: ['websocket'], auth: { token: this.token } });
        this.socket = socket;
        socket.on('workflow:catalog:status', (payload: unknown) => handler({ type: 'workflow:catalog:status', payload }));
        socket.on('workflow:execution:update', (payload: unknown) => handler({ type: 'workflow:execution:update', payload }));
        socket.on('workflow:event', (payload: unknown) => handler({ type: 'workflow:event', payload }));
        return () => {
            socket.removeAllListeners();
            socket.disconnect();
            if (this.socket === socket) this.socket = null;
        };
    }
}
