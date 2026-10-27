export type JobStatus = 'pending' | 'compressing' | 'done' | 'error' | 'cancelled'

export interface Job {
  id: string
  path: string
  name: string
  size: number
  duration: number
  width: number
  height: number
  codec: string
  status: JobStatus
  progress: number
  fps: number | null
  etaSeconds: number | null
  outputPath?: string
  outputSize?: number
  error?: string
}
