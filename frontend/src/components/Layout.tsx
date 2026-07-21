import { useEffect } from "react";
import { NavLink, Link, Outlet, useLocation } from "react-router-dom";
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
  Users,
  FileCog,
  BarChart3,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth, ROLE_LABELS } from "@/lib/auth";
import { api } from "@/lib/api";
import { personTint } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof ListChecks;
  end?: boolean;
  group: string;
  perms: string[];
}

const NAV: NavItem[] = [
  { to: "/", label: "Поручения", icon: ListChecks, end: true, group: "Работа", perms: ["dashboard.view", "tasks.view_own", "tasks.view_all"] },
  { to: "/analytics", label: "Аналитика", icon: BarChart3, group: "Работа", perms: ["dashboard.view"] },
  { to: "/upload", label: "Загрузка", icon: Upload, group: "Работа", perms: ["upload"] },
  { to: "/library", label: "Библиотека", icon: Library, group: "Память", perms: ["library.view"] },
  { to: "/protocols", label: "Протоколы", icon: FileText, group: "Память", perms: ["protocols.view"] },
  { to: "/chat", label: "Вопросы", icon: MessagesSquare, group: "Память", perms: ["qa.use"] },
  { to: "/users", label: "Пользователи", icon: Users, group: "Администрирование", perms: ["users.manage"] },
  { to: "/rating-rules", label: "Правила рейтинга", icon: SlidersHorizontal, group: "Администрирование", perms: ["rating_rules.manage"] },
  { to: "/protocol-template", label: "Шаблон протокола", icon: FileCog, group: "Администрирование", perms: ["templates.manage"] },
];

const GROUPS = ["Работа", "Память", "Администрирование"] as const;

/** Заголовок вкладки браузера по текущему маршруту (тип экрана, без динамики). */
function pageTitle(pathname: string): string {
  if (pathname === "/") return "Реестр поручений";
  if (pathname.startsWith("/analytics")) return "Аналитика";
  if (pathname.startsWith("/upload")) return "Загрузка";
  if (pathname.startsWith("/library")) return "Библиотека";
  if (pathname.startsWith("/transcriptions")) return "Транскрипт";
  if (pathname.startsWith("/protocols")) return "Протоколы";
  if (pathname.startsWith("/chat")) return "Вопросы";
  if (pathname.startsWith("/users")) return "Пользователи";
  if (pathname.startsWith("/rating-rules")) return "Правила рейтинга";
  if (pathname.startsWith("/protocol-template")) return "Шаблон протокола";
  return "";
}

export default function Layout() {
  const { theme, toggle } = useTheme();
  const { can, user, authEnabled, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const title = pageTitle(location.pathname);
    document.title = title ? `${title} — Цифровой Офис` : "Цифровой Офис";
  }, [location.pathname]);
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Управление пользователями имеет смысл только при включённой авторизации.
  const items = NAV.filter((n) => can(...n.perms) && (n.to !== "/users" || authEnabled));
  const groups = GROUPS.filter((g) => items.some((n) => n.group === g));

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row lg:overflow-hidden">
      <a
        href="#main"
        className="absolute left-3 top-3 z-[70] -translate-y-16 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg opacity-0 shadow-2 transition focus-visible:translate-y-0 focus-visible:opacity-100"
      >
        Перейти к содержимому
      </a>
      <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-surface/90 px-3 py-4 backdrop-blur lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex shrink-0 items-center justify-between gap-3 px-1">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Цифровой Офис — на главную">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-fg">
              <Building2 className="h-5 w-5" aria-hidden />
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold">Цифровой Офис</div>
              <div className="text-xs text-muted">встречи · протоколы</div>
            </div>
          </Link>
          {/* Компактные действия для мобильной шапки (на lg — в подвале сайдбара). */}
          <div className="flex items-center gap-1 lg:hidden">
            <button
              onClick={toggle}
              className="icon-btn"
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            </button>
            {authEnabled && user && (
              <button
                onClick={() => logout()}
                className="icon-btn"
                title={`Выйти (${user.full_name || user.username})`}
                aria-label={`Выйти из аккаунта ${user.full_name || user.username}`}
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {can("upload") && (
          <Link to="/upload" className="btn-primary hidden shrink-0 lg:inline-flex">
            <Plus className="h-4 w-4" /> Новая встреча
          </Link>
        )}

        <nav className="flex gap-1 overflow-x-auto lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-4 lg:overflow-y-auto">
          {groups.map((group) => (
            <div key={group} className="flex gap-1 lg:flex-col lg:gap-1">
              <div className="section-label hidden px-3 pb-1 lg:block">{group}</div>
              {items.filter((n) => n.group === group).map(({ to, label, icon: Icon, end }) => (
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
                        aria-hidden
                      />
                      <Icon className="h-4 w-4" aria-hidden />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="hidden shrink-0 flex-col gap-2 border-t border-border pt-3 lg:flex">
          <div className="flex items-center justify-between gap-2 px-2">
            <HealthDot ok={!!health?.openrouter} label="Распознавание речи (OpenRouter)" text="ASR" />
            <HealthDot ok={!!health?.dify_app} label="Протоколы и вопросы (Dify)" text="Dify" />
            <HealthDot ok={!!health?.max_configured} label="Бот MAX" text="MAX" />
          </div>
          <button
            onClick={toggle}
            className="btn-ghost justify-start"
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
            {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          </button>
          {authEnabled && user && (
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-elevated/50 p-2">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold"
                style={personTint(user.full_name || user.username)}
              >
                {(user.full_name || user.username).trim().charAt(0).toUpperCase() || "?"}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-semibold">{user.full_name || user.username}</div>
                <div className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</div>
              </div>
              <button
                onClick={() => logout()}
                className="icon-btn h-8 w-8"
                title="Выйти"
                aria-label={`Выйти из аккаунта ${user.full_name || user.username}`}
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main id="main" className="flex-1 overflow-y-auto">
        <div className="px-4 py-6 sm:px-6 lg:px-8">
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
    <span
      className="flex items-center gap-1.5 text-xs font-medium text-muted"
      title={`${label}: ${ok ? "настроено" : "не настроено"}`}
      aria-label={`${label}: ${ok ? "настроено" : "не настроено"}`}
    >
      <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-success" : "bg-border")} aria-hidden />
      {text}
    </span>
  );
}
