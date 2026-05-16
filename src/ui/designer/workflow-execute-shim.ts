import type { JsonObject } from '@/orm/types';

export const executeBackend = async (descriptor: JsonObject): Promise<JsonObject> => {
    throw new Error(`Browser workflow preview cannot run backend handler "${String(descriptor.key || descriptor.function || 'unknown')}" directly. Execute the workflow through the backend runtime.`);
};
