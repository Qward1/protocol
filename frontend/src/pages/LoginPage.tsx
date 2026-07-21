import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, LogIn, Lock, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api, type DemoAccount } from "@/lib/api";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Демо-аккаунты (пусто, если auth.seed_demo выключен) — для страницы демо-входа.
  const { data: demo } = useQuery({ queryKey: ["demo-accounts"], queryFn: api.demoAccounts, staleTime: Infinity });

  async function doLogin(u: string, p: string) {
    setError("");
    setBusy(true);
    try {
      await login(u, p);
    } catch (err: any) {
      setError(err?.message ?? "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Введите логин и пароль");
      return;
    }
    doLogin(username.trim(), password);
  }

  function loginAs(acc: DemoAccount) {
    setUsername(acc.username);
    setPassword(acc.password);
    doLogin(acc.username, acc.password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl2 bg-accent text-accent-fg">
            <Building2 className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Цифровой Офис</h1>
            <p className="mt-0.5 text-sm text-muted">Вход в систему</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <label className="block">
            <span className="section-label mb-1.5 block">Логин</span>
            <span className="relative block">
              <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input
                className="input pl-9"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                placeholder="admin"
              />
            </span>
          </label>

          <label className="block">
            <span className="section-label mb-1.5 block">Пароль</span>
            <span className="relative block">
              <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input
                type="password"
                className="input pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : <LogIn className="h-4 w-4" aria-hidden />}
            Войти
          </button>
        </form>

        {demo && demo.length > 0 && (
          <section className="card mt-4 p-5" aria-labelledby="demo-title">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-4 w-0.5 rounded-full bg-accent" aria-hidden />
              <h2 id="demo-title" className="text-[15px] font-semibold">
                Демо-доступ
              </h2>
            </div>
            <p className="mb-3 text-sm text-muted">
              Учебные учётные записи для разных ролей. Выберите роль, чтобы войти сразу.
            </p>
            <ul className="space-y-2">
              {demo.map((acc) => (
                <li
                  key={acc.username}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{acc.role_label}</div>
                    <div className="font-mono text-xs text-muted">
                      {acc.username} · {acc.password}
                    </div>
                  </div>
                  <button
                    className="btn-soft shrink-0"
                    onClick={() => loginAs(acc)}
                    disabled={busy}
                    aria-label={`Войти как ${acc.role_label}`}
                  >
                    <LogIn className="h-4 w-4" aria-hidden />
                    Войти
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
