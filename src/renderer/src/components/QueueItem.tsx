import { AlertCircle, Ban, CheckCircle2, Clock, FileVideo, FolderSearch, Loader2, RotateCcw, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Job, JobStatus } from '@/types'
import { formatBytes, formatDuration, formatEta } from '@/lib/format'

const STATUS_META: Record<JobStatus, { label: string; className: string; icon: LucideIcon }> = {
  pending: { label: 'En espera', className: 'bg-zinc-800/80 text-zinc-400 ring-white/10', icon: Clock },
  compressing: { label: 'Comprimiendo...', className: 'bg-violet-500/10 text-violet-300 ring-violet-500/30', icon: Loader2 },
  done: { label: 'Completado', className: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25', icon: CheckCircle2 },
  error: { label: 'Error', className: 'bg-rose-500/10 text-rose-300 ring-rose-500/25', icon: AlertCircle },
  cancelled: { label: 'Cancelado', className: 'bg-amber-500/10 text-amber-300 ring-amber-500/25', icon: Ban }
}

interface QueueItemProps {
  job: Job
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  onReveal: (path: string) => void
}

export function QueueItem({ job, onRemove, onRetry, onReveal }: QueueItemProps): JSX.Element {
  const meta = STATUS_META[job.status]
  const StatusIcon = meta.icon
  const isActive = job.status === 'compressing'
  const isDone = job.status === 'done'
  const progress = isDone ? 100 : job.progress

  const ratio = isDone && job.outputSize != null && job.size > 0 ? 1 - job.outputSize / job.size : null
  const savedPct = ratio != null ? Math.abs(ratio * 100).toFixed(0) : null

  return (
    <li
      className={`group animate-fade-up rounded-xl border p-3.5 transition-colors ${
        isActive ? 'border-violet-500/30 bg-violet-500/[0.04]' : 'border-white/[0.06] bg-zinc-900/50 hover:border-white/10 hover:bg-zinc-900/80'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
            isDone ? 'bg-emerald-500/10 ring-emerald-500/20' : 'bg-zinc-800/80 ring-white/5'
          }`}
        >
          <FileVideo className={`h-5 w-5 ${isDone ? 'text-emerald-300' : 'text-zinc-400'}`} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100" title={job.path}>
            {job.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="tabular-nums">{formatBytes(job.size)}</span>
            {job.width > 0 && (
              <>
                <span className="text-zinc-700">•</span>
                <span className="tabular-nums">
                  {job.width}×{job.height}
                </span>
              </>
            )}
            {job.duration > 0 && (
              <>
                <span className="text-zinc-700">•</span>
                <span className="tabular-nums">{formatDuration(job.duration)}</span>
              </>
            )}
            {job.codec && job.codec !== 'desconocido' && (
              <>
                <span className="text-zinc-700">•</span>
                <span className="uppercase">{job.codec}</span>
              </>
            )}
          </p>
        </div>

        {isDone && job.outputSize != null && (
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-zinc-100">
              <span className="font-normal text-zinc-500">{formatBytes(job.size)} → </span>
              {formatBytes(job.outputSize)}
            </p>
            <p className={`text-xs font-medium tabular-nums ${ratio! >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {ratio! >= 0 ? `−${savedPct}% espacio ahorrado` : `+${savedPct}% más grande`}
            </p>
          </div>
        )}

        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${meta.className}`}>
          <StatusIcon className={`h-3 w-3 ${isActive ? 'animate-spin' : ''}`} />
          {meta.label}
        </span>

        <div className="flex shrink-0 items-center">
          {isDone && job.outputPath && (
            <button id={`reveal-${job.id}`} type="button" className="icon-btn" title="Mostrar en carpeta" onClick={() => onReveal(job.outputPath!)}>
              <FolderSearch className="h-4 w-4" />
            </button>
          )}
          {(job.status === 'error' || job.status === 'cancelled') && (
            <button id={`retry-${job.id}`} type="button" className="icon-btn" title="Reintentar" onClick={() => onRetry(job.id)}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            id={`remove-${job.id}`}
            type="button"
            className="icon-btn hover:!text-rose-300"
            title="Quitar de la lista"
            disabled={isActive}
            onClick={() => onRemove(job.id)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(isActive || isDone || job.status === 'cancelled') && (
        <div className="mt-3 flex items-center gap-3">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                isDone ? 'bg-emerald-500' : job.status === 'cancelled' ? 'bg-amber-500/60' : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
              }`}
              style={{ width: `${progress}%` }}
            />
            {isActive && (
              <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)] bg-[length:200%_100%]" />
            )}
          </div>
          <span className="w-12 text-right text-xs font-medium tabular-nums text-zinc-300">{progress.toFixed(isActive ? 1 : 0)}%</span>
        </div>
      )}

      {isActive && (
        <p className="mt-1.5 text-[11px] tabular-nums text-zinc-500">
          {job.fps ? `${Math.round(job.fps)} fps · ` : ''}Tiempo restante: {formatEta(job.etaSeconds)}
        </p>
      )}

      {job.status === 'error' && job.error && (
        <p className="mt-2 rounded-lg bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-300/90 ring-1 ring-inset ring-rose-500/15 select-text">{job.error}</p>
      )}
    </li>
  )
}
