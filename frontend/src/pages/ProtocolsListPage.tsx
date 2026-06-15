import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Card, PageHeader, Empty, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export default function ProtocolsListPage() {
  const { data, isLoading } = useQuery({ queryKey: ["protocols"], queryFn: api.listProtocols });

  return (
    <div>
      <PageHeader title="Протоколы" subtitle="Сформированные протоколы совещаний и поручения." />
      {isLoading ? (
        <Spinner className="h-6 w-6" />
      ) : !data?.length ? (
        <Empty title="Протоколов пока нет" hint="Откройте запись и нажмите «Сформировать протокол»." />
      ) : (
        <div className="space-y-2">
          {data.map((p) => (
            <Link key={p.id} to={`/protocols/${p.id}`}>
              <Card className="flex items-center justify-between transition-colors hover:border-accent/50">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">{p.title || "Без названия"}</div>
                    <div className="text-xs text-muted">
                      {p.date || "—"} · создан {fmtDate(p.created_at)}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
