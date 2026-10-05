import type { KoharuTransport, CommandName } from './index'

/** Load Tauri only when a desktop host explicitly selects this adapter. */
export async function createTauriTransport(): Promise<KoharuTransport> {
  const [{ commands }, { Channel }] = await Promise.all([
    import('@koharu/bridge/protocol'),
    import('@aphrody/api/core'),
  ])
  return {
    invoke(command: CommandName, args: readonly unknown[]): Promise<unknown> {
      const callable = commands[command] as (...values: unknown[]) => Promise<unknown>
      return callable(...args)
    },
    channel<T>(receive: (value: T) => void) {
      return new Channel<T>(receive)
    },
  }
}
