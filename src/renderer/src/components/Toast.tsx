import { Info } from 'lucide-react'

export function Toast({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-fade-up">
      <div className="flex items-center gap-2 rounded-xl bg-zinc-800/95 px-4 py-2.5 text-sm text-zinc-200 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <Info className="h-4 w-4 text-violet-300" />
        {message}
      </div>
    </div>
  )
}
