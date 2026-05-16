import { type PackageLauncherPanel, type RequestContext } from './contracts.js';
export declare function createConnectingmatrixWorkflowsStubLauncher(context?: RequestContext): PackageLauncherPanel;
export declare const createStubLauncher: typeof createConnectingmatrixWorkflowsStubLauncher;
export declare const Launcher: {
    open: typeof createConnectingmatrixWorkflowsStubLauncher;
    mode: "stub";
};
export declare const launcher: typeof createConnectingmatrixWorkflowsStubLauncher;
