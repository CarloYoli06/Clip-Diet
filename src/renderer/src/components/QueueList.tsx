import { ListVideo, Trash2 } from 'lucide-react'
import type { Job } from '@/types'
import { QueueItem } from './QueueItem'

interface QueueListProps {
  jobs: Job[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onReveal: (path: string) => void
  onClearCompleted: () => void
}

export function QueueList({ jobs, onRemove, onRetry, onReveal, onClearCompleted }: QueueListProps): JSX.Element {
  const completed = jobs.filter((j) => j.status === 'done').length

  return (
    <section className="panel flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <ListVideo className="h-4 w-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-200">Cola de procesamiento</h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">{jobs.length}</span>
        </div>
        <button
          id="clear-completed-header"
          type="button"
          onClick={onClearCompleted}
          disabled={completed === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" /> Limpiar completados
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {jobs.map((job) => (
          <QueueItem key={job.id} job={job} onRemove={onRemove} onRetry={onRetry} onReveal={onReveal} />
        ))}
      </ul>
    </section>
  )
}
