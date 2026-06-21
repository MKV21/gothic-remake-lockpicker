import type { InputKey } from './inputChain'

export type OutputProfile = 'moves' | 'keyboard' | 'xbox' | 'ps5' | 'switch'

export type OutputKeySpec = {
  label: string
  className: 'reset' | 'nav' | 'move'
}

const keyboard: Record<InputKey, OutputKeySpec> = {
  R: { label: 'R', className: 'reset' },
  W: { label: 'W', className: 'nav' },
  S: { label: 'S', className: 'nav' },
  A: { label: 'A', className: 'move' },
  D: { label: 'D', className: 'move' },
}

export const OUTPUT_PROFILES: Record<Exclude<OutputProfile, 'moves'>, Record<InputKey, OutputKeySpec>> = {
  keyboard,
  xbox: {
    R: { label: 'Y', className: 'reset' },
    W: { label: 'Up', className: 'nav' },
    S: { label: 'Down', className: 'nav' },
    A: { label: 'Left', className: 'move' },
    D: { label: 'Right', className: 'move' },
  },
  ps5: {
    R: { label: 'Triangle', className: 'reset' },
    W: { label: 'Up', className: 'nav' },
    S: { label: 'Down', className: 'nav' },
    A: { label: 'Left', className: 'move' },
    D: { label: 'Right', className: 'move' },
  },
  switch: {
    R: { label: 'X', className: 'reset' },
    W: { label: 'Up', className: 'nav' },
    S: { label: 'Down', className: 'nav' },
    A: { label: 'Left', className: 'move' },
    D: { label: 'Right', className: 'move' },
  },
}

export function outputProfileLabel(profile: OutputProfile): string {
  switch (profile) {
    case 'moves':
      return 'Moves'
    case 'keyboard':
      return 'Keyboard'
    case 'xbox':
      return 'Xbox'
    case 'ps5':
      return 'PS5'
    case 'switch':
      return 'Switch'
  }
}
