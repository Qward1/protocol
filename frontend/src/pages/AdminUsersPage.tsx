import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, UserPlus, Trash2, ShieldCheck, KeyRound, Check, X, Ban } from "lucide-react";
import clsx from "clsx";
import { api, type Role, type User } from "@/lib/api";
import { PageHeader, Empty, Spinner, Skeleton, SectionTitle, ConfirmDialog } from "@/components/ui";
import { useAuth, ROLE_LABELS } from "@/lib/auth";
import { fmtDate, personTint } from "@/lib/utils";

const ROLES: Role[] = ["admin", "head", "staff", "executor"];

// Тон роли через семантические токены — без ручных dark:-веток.
const ROLE_TINT: Record<Role, string> = {
  admin: "bg-danger/15 text-danger",
  head: "bg-accent/15 text-accent",
  staff: "bg-info/15 text-info",
  executor: "bg-success/15 text-success",
};

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data: users, isLoading } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });

  const [form, setForm] = useState({ username: "", password: "", full_name: "", role: "executor" as Role });
  const [error, setError] = useState("");
  const [confirmDel, setConfirmDel] = useState<User | null>(null);

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
        <SectionTitle>Новый пользователь</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <input
            className="input"
            placeholder="Логин"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-label="Логин"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            className="input"
            placeholder="ФИО"
            aria-label="ФИО"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
            autoComplete="new-password"
            aria-label="Пароль"
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
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {/* Список пользователей */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ))}
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
                setConfirmDel(u);
              }}
            />
          ))}
        </div>
      )}

      {confirmDel && (
        <ConfirmDialog
          title="Удалить пользователя?"
          description={
            <>
              Учётная запись <span className="font-medium text-fg">«{confirmDel.username}»</span> будет удалена
              без возможности восстановления.
            </>
          }
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => {
            remove.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) });
          }}
          onClose={() => setConfirmDel(null)}
        />
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
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-semibold"
          style={personTint(u.full_name || u.username)}
        >
          {(u.full_name || u.username).trim().charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{u.full_name || u.username}</span>
            {isSelf && <span className="chip">вы</span>}
            {!u.is_active && <span className="chip border-transparent bg-danger/15 text-danger">заблокирован</span>}
          </div>
          <div className="text-xs text-muted">
            @{u.username} · создан {fmtDate(u.created_at)}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
          <select
            className={clsx("input h-9 w-auto py-1 font-semibold", ROLE_TINT[u.role])}
            value={u.role}
            onChange={(e) => onRole(e.target.value as Role)}
            aria-label={`Роль пользователя ${u.username}`}
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
          aria-label={editingPwd ? "Отменить сброс пароля" : `Сбросить пароль пользователя ${u.username}`}
          aria-expanded={editingPwd}
          onClick={() => setEditingPwd((v) => !v)}
        >
          <KeyRound className="h-4 w-4" aria-hidden />
        </button>
        <button
          className="icon-btn"
          title={u.is_active ? "Заблокировать" : "Разблокировать"}
          aria-label={u.is_active ? `Заблокировать ${u.username}` : `Разблокировать ${u.username}`}
          onClick={onToggleActive}
        >
          {u.is_active ? <Ban className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        </button>
        {!isSelf && (
          <button
            className="icon-btn hover:!border-danger/40 hover:!text-danger"
            title="Удалить"
            aria-label={`Удалить пользователя ${u.username}`}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {editingPwd && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            className="input h-9 max-w-xs py-1"
            type="password"
            placeholder="Новый пароль"
            autoComplete="new-password"
            aria-label={`Новый пароль для ${u.username}`}
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
            <Check className="h-4 w-4" aria-hidden /> Сохранить
          </button>
          <button className="btn-ghost h-9 py-1" onClick={() => { setPwd(""); setEditingPwd(false); }}>
            <X className="h-4 w-4" aria-hidden /> Отмена
          </button>
        </div>
      )}
    </div>
  );
}
