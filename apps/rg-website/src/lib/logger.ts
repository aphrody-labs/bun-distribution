/**
 * Système de logging structuré pour l'application
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: string;
  data?: unknown;
}

class Logger {
  private context?: string;
  private timers = new Map<string, number>();

  constructor(context?: string) {
    this.context = context;
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      context: this.context,
      data,
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    // En développement, afficher les logs de manière lisible
    if (process.env.NODE_ENV === "development") {
      const emoji = {
        debug: "🔍",
        error: "❌",
        info: "ℹ️",
        warn: "⚠️",
      };

      const prefix = this.context ? `[${this.context}]` : "";
      // Utiliser console.warn/error uniquement pour le développement
      if (level === "error") {
        console.error(`${emoji[level]} ${prefix} ${message}`, data || "");
      } else if (level === "warn") {
        console.warn(`${emoji[level]} ${prefix} ${message}`, data || "");
      } else {
        console.info(`${emoji[level]} ${prefix} ${message}`, data || "");
      }
    } else {
      // En production, logger en JSON pour faciliter l'analyse (via stderr)
      console.error(JSON.stringify(entry));
    }
  }

  info(message: string, data?: unknown) {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown) {
    this.log("warn", message, data);
  }

  error(message: string, error?: unknown) {
    const errorData = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    this.log("error", message, errorData);
  }

  debug(message: string, data?: unknown) {
    if (process.env.NODE_ENV === "development") {
      this.log("debug", message, data);
    }
  }

  /**
   * Start a performance timer
   */
  time(label: string) {
    this.timers.set(label, Date.now());
  }

  /**
   * End a performance timer and log the duration
   */
  timeEnd(label: string) {
    const startTime = this.timers.get(label);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.debug(`${label}`, { duration: `${duration}ms` });
      this.timers.delete(label);
    }
  }

  /**
   * Create a child logger with nested context
   */
  child(subContext: string): Logger {
    const fullContext = this.context ? `${this.context}:${subContext}` : subContext;
    return new Logger(fullContext);
  }

  /**
   * Log HTTP request
   */
  http(method: string, path: string, statusCode: number, duration: number) {
    this.info(`${method} ${path}`, { duration: `${duration}ms`, statusCode });
  }
}

/**
 * Crée un logger avec un contexte spécifique
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}

/**
 * Logger par défaut
 */
export const logger = new Logger();
