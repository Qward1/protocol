import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, ShieldCheck, KeyRound, Check, X, Ban } from "lucide-react";
import clsx from "clsx";
import { api, type Role, type User } from "@/lib/api";
import { PageHeader, Empty, Spinner } from "@/components/ui";
import { useAuth, ROLE_LABELS } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";

const ROLES: Role[] = ["admin", "head", "staff", "executor"];

const ROLE_TINT: Record<Role, string> = {
  admin: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  head: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  staff: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  executor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
};

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

  const [form, setForm] = useState({ username: "", password: "", full_name: "", role: "executor" as Role });
  const [error, setError] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      setForm({ username: "", password: "", full_name: "", role: "executor" });
      setError("");
      invalidate();
    },
    onError: (e: any) => setError(e?.message ?? "Не удалось создать пользователя"),
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<User> & { password?: string } }) =>
      api.updateUser(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: invalidate,
    onError: (e: any) => setError(e?.message ?? "Не удалось удалить пользователя"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Пользователи"
        subtitle="Управление учётными записями, ролями и доступом к системе."
      />

      {/* Создание пользователя */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Новый пользователь</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <input
            className="input"
            placeholder="Логин"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            className="input"
            placeholder="ФИО"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <select
            className="input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            className="btn-primary"
            disabled={create.isPending || !form.username.trim() || !form.password}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner /> : <UserPlus className="h-4 w-4" />}
            Создать
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
      </div>

      {/* Список пользователей */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-accent" />
        </div>
      ) : !users?.length ? (
        <Empty icon={Users} title="Пользователей пока нет" />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <UserRow
              key={u.id}
              u={u}
              isSelf={u.id === me?.id}
              onRole={(role) => update.mutate({ id: u.id, patch: { role } })}
              onToggleActive={() => update.mutate({ id: u.id, patch: { is_active: !u.is_active } })}
              onResetPassword={(password) => update.mutate({ id: u.id, patch: { password } })}
              onDelete={() => {
                setError("");
                if (confirm(`Удалить пользователя «${u.username}»?`)) remove.mutate(u.id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserRow({
  u,
  isSelf,
  onRole,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  u: User;
  isSelf: boolean;
  onRole: (role: Role) => void;
  onToggleActive: () => void;
  onResetPassword: (password: string) => void;
  onDelete: () => void;
}) {
  const [pwd, setPwd] = useState("");
  const [editingPwd, setEditingPwd] = useState(false);

  return (
    <div className={clsx("card p-4", !u.is_active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/12 text-sm font-bold text-accent">
          {(u.full_name || u.username).trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{u.full_name || u.username}</span>
            {isSelf && <span className="chip">вы</span>}
            {!u.is_active && <span className="chip text-rose-500">заблокирован</span>}
          </div>
          <div className="text-xs text-muted">
            @{u.username} · создан {fmtDate(u.created_at)}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted" />
          <select
            className={clsx("input h-9 w-auto py-1 font-semibold", ROLE_TINT[u.role])}
            value={u.role}
            onChange={(e) => onRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>

        <button
          className="icon-btn"
          title={editingPwd ? "Отменить" : "Сбросить пароль"}
          onClick={() => setEditingPwd((v) => !v)}
        >
          <KeyRound className="h-4 w-4" />
        </button>
        <button
          className="icon-btn"
          title={u.is_active ? "Заблокировать" : "Разблокировать"}
          onClick={onToggleActive}
        >
          {u.is_active ? <Ban className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </button>
        {!isSelf && (
          <button className="icon-btn hover:!text-rose-500" title="Удалить" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {editingPwd && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
          <input
            className="input h-9 max-w-xs py-1"
            type="password"
            placeholder="Новый пароль"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <button
            className="btn-primary h-9 py-1"
            disabled={!pwd}
            onClick={() => {
              onResetPassword(pwd);
              setPwd("");
              setEditingPwd(false);
            }}
          >
            <Check className="h-4 w-4" /> Сохранить
          </button>
          <button className="btn-ghost h-9 py-1" onClick={() => { setPwd(""); setEditingPwd(false); }}>
            <X className="h-4 w-4" /> Отмена
          </button>
        </div>
      )}
    </div>
  );
}
