/// <reference types="vite/client" />
import type { ClipDietAPI } from '@shared/types'

declare global {
  interface Window {
    api: ClipDietAPI
  }
}

export {}
