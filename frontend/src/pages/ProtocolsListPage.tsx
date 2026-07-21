import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, ChevronRight, ListChecks, CalendarDays, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, Empty, Skeleton } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export default function ProtocolsListPage() {
  const { data, isLoading } = useQuery({ queryKey: ["protocols"], queryFn: api.listProtocols });

  return (
    <div>
      <PageHeader
        icon={FileText}
        title="Протоколы"
        subtitle="Сформированные протоколы совещаний и связанные с ними поручения."
      />
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-4 p-4">
              <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : !data?.length ? (
        <Empty
          icon={FileText}
          title="Протоколов пока нет"
          hint="Откройте запись на странице «Библиотека» и нажмите «Сформировать протокол»."
          action={
            <Link to="/upload" className="btn-primary">
              <Upload className="h-4 w-4" /> Новая встреча
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((p) => (
            <Link key={p.id} to={`/protocols/${p.id}`} className="card-link group flex items-center gap-4 p-4">
              <div className="icon-box h-12 w-12 shrink-0">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{p.title || "Без названия"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3.5 w-3.5" /> {p.tasks_count} поручений
                  </span>
                  {p.date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" /> {p.date}
                    </span>
                  )}
                  <span>создан {fmtDate(p.created_at)}</span>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
