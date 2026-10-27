import { Loader2, Play, Square, Trash2 } from 'lucide-react'
import type { Job } from '@/types'
import { formatBytes } from '@/lib/format'

interface ActionPanelProps {
  jobs: Job[]
  running: boolean
  stopping: boolean
  onStart: () => void
  onCancel: () => void
  onClearCompleted: () => void
}

export function ActionPanel({ jobs, running, stopping, onStart, onCancel, onClearCompleted }: ActionPanelProps): JSX.Element {
  const pending = jobs.filter((j) => j.status === 'pending').length
  const done = jobs.filter((j) => j.status === 'done')
  const doneOriginal = done.reduce((acc, j) => acc + j.size, 0)
  const doneCompressed = done.reduce((acc, j) => acc + (j.outputSize ?? 0), 0)
  const saved = Math.max(0, doneOriginal - doneCompressed)
  const savedPct = doneOriginal > 0 ? (saved / doneOriginal) * 100 : 0

  return (
    <section className="panel space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="En cola" value={String(pending)} />
        <Stat label="Listos" value={String(done.length)} />
        <Stat label="Ahorrado" value={done.length ? `${savedPct.toFixed(0)}%` : '—'} accent />
      </div>

      {done.length > 0 && (
        <p className="text-center text-[11px] text-zinc-500">
          {formatBytes(doneOriginal)} → <span className="text-zinc-300">{formatBytes(doneCompressed)}</span> ·{' '}
          <span className="text-emerald-400">{formatBytes(saved)} liberados</span>
        </p>
      )}

      {running ? (
        <button
          id="cancel-compression"
          type="button"
          onClick={onCancel}
          disabled={stopping}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30 transition hover:bg-rose-500/20 disabled:opacity-60"
        >
          {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
          {stopping ? 'Cancelando…' : 'Cancelar proceso actual'}
        </button>
      ) : (
        <button
          id="start-compression"
          type="button"
          onClick={onStart}
          disabled={pending === 0}
          className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/40 transition hover:shadow-violet-700/50 hover:brightness-110 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
        >
          <Play className="h-4 w-4 fill-current transition-transform group-hover:scale-110" />
          Iniciar Compresión
          {pending > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] tabular-nums">{pending}</span>}
        </button>
      )}

      <button
        id="clear-completed"
        type="button"
        onClick={onClearCompleted}
        disabled={done.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-white/10 transition hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> Limpiar completados
      </button>
    </section>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-xl bg-zinc-950/40 px-2 py-2.5 ring-1 ring-white/[0.06]">
      <p className={`text-lg font-semibold tabular-nums ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  )
}
