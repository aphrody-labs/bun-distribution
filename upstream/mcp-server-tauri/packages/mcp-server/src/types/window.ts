/**
 * Window type definitions for multi-webview support.
 */

/**
 * Information about a webview window.
 */
export interface WindowInfo {
   label: string;
   title?: string;
   url?: string;
   focused: boolean;
   visible: boolean;
   isMain: boolean;
}

/**
 * Response from the list_windows command.
 */
export interface ListWindowsResponse {
   windows: WindowInfo[];
   defaultWindow: string;
   totalCount: number;
}

/**
 * Context about which window was used for an operation.
 */
export interface WindowContext {
   windowLabel: string;
   totalWindows: number;
   warning?: string;
}
