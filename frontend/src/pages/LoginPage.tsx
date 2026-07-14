import { useState } from "react";
import { Building2, LogIn, Lock, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Введите логин и пароль");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err?.message ?? "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div
            className="grid h-14 w-14 place-items-center rounded-xl2 text-accent-fg shadow-glow"
            style={{ backgroundImage: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-2)))" }}
          >
            <Building2 className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">Цифровой Офис</h1>
            <p className="mt-0.5 text-sm text-muted">Вход в систему</p>
          </div>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <label className="block">
            <span className="section-label mb-1.5 block">Логин</span>
            <span className="relative block">
              <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                className="input pl-9"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="admin"
              />
            </span>
          </label>

          <label className="block">
            <span className="section-label mb-1.5 block">Пароль</span>
            <span className="relative block">
              <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
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

          {error && <p className="text-sm text-rose-500">{error}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner /> : <LogIn className="h-4 w-4" />}
            Войти
          </button>
        </form>
      </div>
    </div>
  );
}
