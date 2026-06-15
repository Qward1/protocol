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
    <div className="flex min-h-screen flex-col lg:h-screen lg:flex-row lg:overflow-hidden">
      <aside className="flex shrink-0 flex-col border-b border-border bg-surface/95 backdrop-blur lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-fg shadow-sm">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="text-base font-extrabold">Цифровой Офис</div>
            <div className="text-xs font-medium text-muted">встречи / протоколы</div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:bg-elevated hover:text-fg",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <button onClick={toggle} className="btn-ghost m-3 hidden justify-start lg:flex">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
