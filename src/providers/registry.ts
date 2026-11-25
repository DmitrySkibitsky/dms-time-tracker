import type { ProviderDescriptor } from "../core/types.ts";
import { clockifyDescriptor } from "./clockify/provider.ts";

/**
 * All built-in providers. To add a service, implement TrackerProvider in
 * src/providers/<name>/, export a ProviderDescriptor and list it here.
 */
export const providers: readonly ProviderDescriptor[] = [clockifyDescriptor];

export const DEFAULT_PROVIDER_ID = clockifyDescriptor.id;

export function findProvider(id: string): ProviderDescriptor | null {
    return providers.find(p => p.id === id) ?? null;
}
