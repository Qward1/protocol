import { NavLink, Link, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ListChecks,
  Upload,
  FileText,
  MessagesSquare,
  Library,
  Moon,
  Sun,
  Building2,
  Plus,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";

const NAV = [
  { to: "/", label: "Поручения", icon: ListChecks, end: true, group: "Работа" },
  { to: "/upload", label: "Загрузка", icon: Upload, group: "Работа" },
  { to: "/library", label: "Библиотека", icon: Library, group: "Память" },
  { to: "/protocols", label: "Протоколы", icon: FileText, group: "Память" },
  { to: "/chat", label: "Вопросы", icon: MessagesSquare, group: "Память" },
];

const GROUPS = ["Работа", "Память"] as const;

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row lg:overflow-hidden">
      <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-surface/90 px-3 py-4 backdrop-blur lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-1">
          <Link to="/" className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-xl2 text-accent-fg shadow-glow"
              style={{ backgroundImage: "linear-gradient(135deg, rgb(var(--accent)), rgb(var(--accent-2)))" }}
            >
              <Building2 className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-extrabold">Цифровой Офис</div>
              <div className="text-xs font-medium text-muted">встречи · протоколы</div>
            </div>
          </Link>
          <button onClick={toggle} className="icon-btn lg:hidden" title="Сменить тему">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <Link to="/upload" className="btn-primary hidden lg:inline-flex">
          <Plus className="h-4 w-4" /> Новая встреча
        </Link>

        <nav className="flex gap-1 overflow-x-auto lg:flex-1 lg:flex-col lg:gap-4 lg:overflow-visible">
          {GROUPS.map((group) => (
            <div key={group} className="flex gap-1 lg:flex-col lg:gap-1">
              <div className="section-label hidden px-3 pb-1 lg:block">{group}</div>
              {NAV.filter((n) => n.group === group).map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    clsx(
                      "group relative flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                      isActive
                        ? "bg-accent/12 text-accent"
                        : "text-muted hover:bg-elevated hover:text-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={clsx(
                          "absolute left-0 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent transition-opacity lg:block",
                          isActive ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <Icon className="h-4 w-4" />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="hidden flex-col gap-2 border-t border-border/70 pt-3 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <HealthDot ok={!!health?.openrouter} label="ASR (распознавание речи)" text="ASR" />
            <HealthDot ok={!!health?.dify_app} label="Dify (протоколы, Q&A)" text="Dify" />
            <HealthDot ok={!!health?.max_configured} label="Бот MAX" text="MAX" />
          </div>
          <button onClick={toggle} className="btn-ghost justify-start">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function HealthDot({ ok, label, text }: { ok: boolean; label: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted" title={label}>
      <span
        className={clsx(
          "h-2 w-2 rounded-full",
          ok ? "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129_/_0.15)]" : "bg-border",
        )}
      />
      {text}
    </span>
  );
}
