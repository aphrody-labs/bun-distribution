import type { commands as nativeCommands } from '@aphrody/koharu-bridge/protocol'

/** The Rust command surface remains the authority for argument and result types. */
export type CommandMap = typeof nativeCommands
export type CommandName = keyof CommandMap
export type CommandArguments<Name extends CommandName> = Parameters<CommandMap[Name]>
export type CommandResult<Name extends CommandName> = ReturnType<CommandMap[Name]>

/** Hosts carry command arguments without requiring Tauri in the SDK runtime. */
export interface KoharuTransport {
  invoke(command: CommandName, args: readonly unknown[]): Promise<unknown>
  channel?<T>(receive: (value: T) => void): unknown
}

export class KoharuClient {
  constructor(private readonly transport: KoharuTransport) {}

  call<Name extends CommandName>(
    command: Name,
    ...args: CommandArguments<Name>
  ): CommandResult<Name> {
    return this.transport.invoke(command, args) as CommandResult<Name>
  }

  channel<T>(receive: (value: T) => void): unknown {
    if (!this.transport.channel) throw new Error('This Koharu transport does not support channels.')
    return this.transport.channel(receive)
  }
}
