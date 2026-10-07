import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown } from "lucide-react";
import { opportunityApi } from "./opportunity-ui";
export function MicroEvidenceSummary({ candidateId, resumeId }: { candidateId: number; resumeId: number }) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["micro-evidence", candidateId, resumeId],
    queryFn: () =>
      opportunityApi<any[]>(`/employer/micro-evidence/${candidateId}?resumeId=${resumeId}`),
    enabled: open && Number.isInteger(resumeId) && resumeId > 0,
    staleTime: 0,
  });
  return (
    <section className="opportunity-detail">
      <button
        className="button secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <BookOpen size={16} /> Практика от компаний <ChevronDown size={15} />
      </button>
      {open && (
        <div className="opportunity-list">
          {query.isLoading && (
            <small role="status">Загружаем разрешённые результаты…</small>
          )}
          {query.isError && (
            <small role="alert">
              Результаты недоступны. Кандидат мог изменить разрешения.
            </small>
          )}
          {query.data?.length === 0 && (
            <small>Для этого резюме пока нет открытых результатов практики.</small>
          )}
          {!query.isError &&
            query.data?.map((item) => (
              <div key={item.id}>
                <b>
                  {item.competency} · {item.result?.total}/{item.result?.max}
                </b>
                <p>
                  {item.companyName} ·{" "}
                  {new Date(item.result.evaluatedAt).toLocaleDateString(
                    "ru-RU",
                  )}{" "}
                  · версия {item.result.templateVersion}
                </p>
                <small>{item.result.feedback}</small>
                <p>
                  <small>{item.limits}</small>
                </p>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
