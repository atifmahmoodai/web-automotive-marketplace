import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applySettings } from "../lib/format";
import { isStaff, type SessionUser } from "../../../shared/schemas";
import type { Meta, Unread } from "../../../shared/types";
import { api, ApiError, setCsrfToken } from "./client";

interface MeResponse {
  user: SessionUser;
  csrfToken: string;
}

/** The signed-in member, or null for a visitor. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const r = await api<MeResponse>("/auth/me");
        setCsrfToken(r.csrfToken);
        return r.user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

function useSignIn(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, string>) => api<MeResponse>(path, { method: "POST", body: input }),
    onSuccess: (r) => {
      setCsrfToken(r.csrfToken);
      qc.setQueryData(["me"], r.user);
      // Search results carry "saved" hearts for the signed-in member.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });
}
export const useLogin = () => useSignIn("/auth/login");
export const useRegister = () => useSignIn("/auth/register");

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      setCsrfToken("");
      qc.clear();
      qc.setQueryData(["me"], null);
      // Drop cached API answers so the next person on this device doesn't see them offline.
      navigator.serviceWorker?.controller?.postMessage({ type: "signed-out" });
    },
  });
}

/** Site name, currency and limits (public). */
export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: async () => {
      const m = await api<Meta>("/meta");
      applySettings(m.settings);
      return m;
    },
    staleTime: 10 * 60_000,
  });
}

/** Badge counts, refreshed every minute while the app is open. */
export function useUnread(enabled: boolean) {
  return useQuery({
    queryKey: ["unread"],
    queryFn: () => api<Unread>("/unread"),
    enabled,
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
}

export const staff = (u: SessionUser | null | undefined) => isStaff(u?.role);
export const isAdmin = (u: SessionUser | null | undefined) => u?.role === "admin";
