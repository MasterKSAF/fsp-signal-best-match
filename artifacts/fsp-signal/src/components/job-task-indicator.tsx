import { ClipboardList } from 'lucide-react';
import { Link } from 'wouter';
import './job-task-indicator.css';

export type JobTaskAvailability = { hasTask?: boolean; taskCount?: number; taskHref?: string | null };

export function JobTaskIndicator({ job }: { job: JobTaskAvailability }) {
  if (!job.hasTask) return null;
  const content = <><ClipboardList size={14} aria-hidden="true"/><span>С заданием{job.taskCount && job.taskCount > 1 ? ` · ${job.taskCount}` : ''}</span></>;
  return job.taskHref
    ? <Link className="job-task-indicator" href={job.taskHref} aria-label="Открыть задания по вакансии">{content}</Link>
    : <span className="job-task-indicator" aria-label="Для вакансии предусмотрено задание">{content}</span>;
}
