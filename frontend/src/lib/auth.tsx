import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setToken, type MeResponse, type Role, type User } from "@/lib/api";

interface AuthCtx {
  loading: boolean;
  authEnabled: boolean;
  authenticated: boolean;
  user: User | null;
  role: Role | null;
  permissions: string[];
  can: (...perms: string[]) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  loading: true,
  authEnabled: false,
  authenticated: false,
  user: null,
  role: null,
  permissions: [],
  can: () => false,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ["me"],
    queryFn: api.me,
    staleTime: 60_000,
    retry: false,
  });

  const permissions = data?.permissions ?? [];
  const can = (...perms: string[]) =>
    permissions.includes("*") || perms.some((p) => permissions.includes(p));

  async function login(username: string, password: string) {
    const res = await api.login(username, password);
    setToken(res.token);
    await qc.invalidateQueries({ queryKey: ["me"] });
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      setToken(null);
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["me"] });
    }
  }

  const value: AuthCtx = {
    loading: isLoading,
    authEnabled: data?.auth_enabled ?? false,
    authenticated: data?.authenticated ?? false,
    user: data?.user ?? null,
    role: (data?.user?.role as Role) ?? null,
    permissions,
    can,
    login,
    logout,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  head: "Глава",
  staff: "Сотрудник аппарата",
  executor: "Исполнитель",
};
