import { useQuery } from "@tanstack/react-query";
import { healthApi } from "@/api/health";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Reads Foundation Cloud metadata from the app-wide health query cache.
 * CloudAccessGate owns the fetch; disabling this observer's query function
 * prevents consumers from adding another health request when they mount.
 */
export function useCloudInstance() {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: false,
  });

  return healthQuery.data?.cloud ?? null;
}

/**
 * True for any hosted Foundation deployment whose browser is only the control
 * plane. Davaria Cloud sets the explicit feature flag; upstream Paperclip Cloud
 * continues to be recognized by its stack metadata.
 */
export function useFoundationCloudExecution() {
  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: false,
  });

  return Boolean(
    healthQuery.data?.cloud ||
      healthQuery.data?.features?.foundationCloudExecutionEnabled,
  );
}
