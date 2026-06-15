import { NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import {
  LayoutDashboard,
  Upload,
  FileText,
  MessagesSquare,
  Library,
  Moon,
  Sun,
  Building2,
} from "lucide-react";
import { useTheme } from "@/lib/theme";

const NAV = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard, end: true },
  { to: "/upload", label: "Загрузка", icon: Upload },
  { to: "/library", label: "Библиотека", icon: Library },
  { to: "/protocols", label: "Протоколы", icon: FileText },
  { to: "/chat", label: "Вопросы", icon: MessagesSquare },
];

export default function Layout() {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-fg">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold">Цифровой Офис</div>
            <div className="text-xs text-muted">встречи · протоколы</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <button onClick={toggle} className="btn-ghost m-3 justify-start">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
