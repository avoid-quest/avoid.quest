import { useQuery } from "convex/react";
import { api } from "@/lib/convex";

/**
 * Hook for user by username
 */
export function useUserByUsername(username: string) {
  return useQuery(api.api.users.getByUsername, { username });
}

/**
 * Hook for users list
 */
export function useUsers(limit = 50) {
  return useQuery(api.api.users.getUsers, { limit });
}
