/** Types de sanction de modération. */
export enum SanctionType {
  Warn = "warn",
  Mute = "mute",
  Kick = "kick",
  Ban = "ban",
  Unmute = "unmute",
  Unban = "unban",
  Note = "note",
}

/** Origine d'une sanction (qui / quoi l'a émise). */
export enum SanctionIssuerType {
  User = "user",
  Bot = "bot",
  Staff = "staff",
  System = "system",
}
