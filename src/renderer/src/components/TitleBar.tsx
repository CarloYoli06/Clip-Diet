import { Clapperboard, Cpu, Zap } from 'lucide-react'
import type { SystemInfo } from '@shared/types'

interface TitleBarProps {
  system: SystemInfo | null
}

export function TitleBar({ system }: TitleBarProps): JSX.Element {
  return (
    <header className="app-drag flex h-10 shrink-0 items-center gap-2.5 pl-4 pr-[150px]">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
        <Clapperboard className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
      </div>
      <span className="text-[13px] font-semibold tracking-tight text-zinc-100">ClipDiet</span>
      <span className="hidden text-[12px] text-zinc-500 sm:inline">Compresor de video por lotes</span>

      <div className="ml-auto flex items-center gap-2">
        {system == null ? (
          <span className="text-[11px] text-zinc-600">Detectando hardware…</span>
        ) : system.nvencAvailable ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
            <Zap className="h-3 w-3" /> NVENC listo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-inset ring-white/10">
            <Cpu className="h-3 w-3" /> Solo CPU
          </span>
        )}
      </div>
    </header>
  )
}
