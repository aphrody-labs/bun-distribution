// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Toast.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { clsx } from "clsx";
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast as SonnerToast } from "sonner";

import { Icon, type IconSource, renderIcon } from "./Icon";

export const TOAST_TIMEOUT = 4000;

/** M3 snackbar action: a text button in `inverse-primary`. */
const actionButtonClassName = clsx(
  "inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 outline-none",
  "text-label-large text-inverse-primary transition-colors duration-200 ease-standard",
  "hover:bg-inverse-primary/8 active:bg-inverse-primary/10 focus-visible:bg-inverse-primary/10",
);

/** M3 snackbar container: `inverse-surface`, extra-small corners, level 3. */
const toastClassName = clsx(
  "w-full overflow-hidden rounded-extra-small py-1.5 pl-4 pr-2 shadow-md3-3",
  "flex min-h-12 items-center",
  "cursor-default select-none",
  "bg-inverse-surface",
  "text-body-medium text-inverse-on-surface",
);

export type ToastId<T = string | number> = T;
type ToastType = "info" | "success" | "error" | "warning";
export type ToastMessage = ReactNode | { title: ReactNode; body?: ReactNode };
type ToastPromiseData = unknown;
type ToastPromise<T = ToastPromiseData> = Promise<T> | (() => Promise<T>);
type ToastAction = {
  label: string;
  onClick: () => void;
  className?: string;
};
type ToastCloseEvent =
  "on-dismiss" | "on-auto-close" | "on-action" | "on-cancel";

interface ToastOptions {
  id?: ToastId;
  ref?: React.Ref<HTMLDivElement>;
  type?: ToastType;
  /** A Material Symbols name, an element or an icon component. */
  icon?: IconSource;
  duration?: number;
  action?: ToastAction;
  cancel?:
    | (Omit<ToastAction, "onClick"> & {
        onClick?: ToastAction["onClick"];
      })
    | string;
  onClose?: (data: { id: ToastId; event: ToastCloseEvent }) => void;
  onDismiss?: (id: ToastId) => void;
  onAutoClose?: (id: ToastId) => void;
  important?: boolean;
  style?: CSSProperties;
  className?: string;
}

interface PromiseToastOptions<T = ToastPromiseData> extends Omit<
  ToastOptions,
  "ref" | "icon" | "type" | "action" | "cancel" | "onClose"
> {
  loading: ToastMessage;
  success: ToastMessage | ((data: T) => ToastMessage);
  error: ToastMessage | ((error: unknown) => ToastMessage);
  loader?: ReactNode;
  showLoader?: boolean;
  onClose?: (data: {
    id: ToastId;
    event: Extract<ToastCloseEvent, "on-dismiss" | "on-auto-close">;
  }) => void;
}

type CustomToastOptions = Omit<
  ToastOptions,
  "type" | "icon" | "action" | "cancel" | "onDismiss" | "onClose"
>;

interface ToastProps extends Pick<
  ToastOptions,
  "type" | "icon" | "action" | "cancel" | "onDismiss" | "onClose"
> {
  id: ToastId;
  message: ToastMessage | ((id: ToastId) => ToastMessage);
  closable?: boolean;
}

/**
 * Material Symbols per toast type. Container roles are the readable accents on the
 * `inverse-surface` of a snackbar, in both light and dark schemes.
 */
const icons: Record<ToastType, { name: string; className: string }> = {
  success: { name: "check_circle", className: "text-success-container" },
  error: { name: "error", className: "text-error-container" },
  info: { name: "info", className: "text-inverse-primary" },
  warning: { name: "warning", className: "text-warning-container" },
};

const typeIcon = (type: ToastType) => (
  <Icon
    name={icons[type].name}
    size={20}
    filled
    className={icons[type].className}
  />
);

/** Small indeterminate circular indicator shown while a promise toast is pending. */
const ToastLoader = () => (
  <span
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 circular spinner drawn as a bordered span; a native <progress> cannot render the rotating arc.
    role="progressbar"
    aria-label="Loading"
    className="block size-5 animate-spin rounded-full border-2 border-inverse-primary border-t-transparent"
  />
);

const ToastComponent = forwardRef<HTMLDivElement, ToastProps>(
  ({ closable = true, action, cancel, ...props }, ref) => {
    const message =
      typeof props.message === "function"
        ? props.message(props.id)
        : props.message;

    const title =
      message && typeof message === "object" && "title" in message
        ? message.title
        : message;

    const body =
      message && typeof message === "object" && "body" in message
        ? message.body
        : undefined;

    const multiline = !!body;

    return (
      <div
        ref={ref}
        className={clsx(
          "pointer-events-auto flex w-full gap-3",
          multiline ? "items-start" : "items-center",
        )}
      >
        {(props.icon || props.type) && (
          <div className={clsx("flex shrink-0", multiline && "mt-2.5")}>
            {props.icon
              ? renderIcon(props.icon, { size: 20 })
              : props.type && typeIcon(props.type)}
          </div>
        )}

        <div className="flex grow flex-col py-2">
          {title && (
            <span
              className="text-body-medium text-inverse-on-surface"
              style={{ wordBreak: "break-word" }}
            >
              {title}
            </span>
          )}

          {body && (
            <div
              className="mt-0.5 text-body-medium text-inverse-on-surface/80"
              style={{ wordBreak: "break-word" }}
            >
              {body}
            </div>
          )}
        </div>

        {(action || cancel) && (
          <div className="flex shrink-0 items-center gap-1">
            {cancel && (
              <button
                type="button"
                onClick={() => {
                  if (typeof cancel === "object") cancel.onClick?.();
                  props.onClose?.({
                    id: props.id,
                    event: "on-cancel",
                  });
                  toast.dismiss(props.id);
                }}
                className={clsx(
                  actionButtonClassName,
                  typeof cancel === "object" ? cancel.className : null,
                )}
              >
                {typeof cancel === "object" ? cancel.label : cancel}
              </button>
            )}

            {action && (
              <button
                type="button"
                onClick={() => {
                  action.onClick();
                  props.onClose?.({
                    id: props.id,
                    event: "on-action",
                  });
                  toast.dismiss(props.id);
                }}
                className={clsx(actionButtonClassName, action.className)}
              >
                {action.label}
              </button>
            )}
          </div>
        )}

        {closable && (
          <button
            type="button"
            aria-label="Close"
            className={clsx(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-full outline-none",
              "text-inverse-on-surface transition-colors duration-200 ease-standard",
              "hover:bg-inverse-on-surface/8 active:bg-inverse-on-surface/10 focus-visible:bg-inverse-on-surface/10",
            )}
            onClick={() => {
              props.onDismiss?.(props.id);
              props.onClose?.({
                id: props.id,
                event: "on-dismiss",
              });
              toast.dismiss(props.id);
            }}
          >
            <Icon name="close" size={20} />
          </button>
        )}
      </div>
    );
  },
);

ToastComponent.displayName = "Toast";

interface PromiseToastProps<T = ToastPromiseData> extends Pick<
  PromiseToastOptions<T>,
  | "loading"
  | "success"
  | "error"
  | "onDismiss"
  | "onAutoClose"
  | "onClose"
  | "loader"
  | "showLoader"
> {
  id: ToastId;
  promise: ToastPromise<T>;
  duration?: number;
}

const PromiseToast = <T extends ToastPromiseData>({
  showLoader = true,
  ...props
}: PromiseToastProps<T>) => {
  const [type, setType] = useState<ToastType>();
  const [message, setMessage] = useState<ToastMessage>(props.loading);
  const { id, promise, duration } = props;

  // Latest props for the message formatters and close callbacks: callers pass them inline, so
  // they must not restart the promise flow on every render.
  const latestProps = useRef(props);
  useEffect(() => {
    latestProps.current = props;
  });

  useEffect(() => {
    const resolve = async () => {
      try {
        const res = await (promise instanceof Promise ? promise : promise());
        const { success } = latestProps.current;
        setMessage(typeof success === "function" ? success(res) : success);
        setType("success");
      } catch (err) {
        const { error } = latestProps.current;
        setMessage(typeof error === "function" ? error(err) : error);
        setType("error");
      }

      setTimeout(() => {
        latestProps.current.onAutoClose?.(id);
        latestProps.current.onClose?.({ id, event: "on-auto-close" });
        toast.dismiss(id);
      }, duration || TOAST_TIMEOUT);
    };

    resolve();
  }, [id, promise, duration]);

  return (
    <ToastComponent
      id={id}
      type={type}
      message={message}
      icon={!type && showLoader && (props.loader ?? <ToastLoader />)}
      closable={!!type}
      onDismiss={props.onDismiss}
      onClose={({ id: closedId, event }) => {
        if (event === "on-action" || event === "on-cancel") return;
        props.onClose?.({ id: closedId, event });
      }}
    />
  );
};

const renderToast = (
  message: ToastMessage | ((id: ToastId) => ToastMessage),
  {
    ref,
    type,
    icon,
    action,
    cancel,
    onDismiss,
    onClose,
    onAutoClose,
    className,
    ...options
  }: ToastOptions = {},
) => {
  return SonnerToast.custom(
    (id) => (
      <ToastComponent
        id={id}
        ref={ref}
        type={type}
        icon={icon}
        message={message}
        action={action}
        cancel={cancel}
        onDismiss={onDismiss}
        onClose={onClose}
      />
    ),
    {
      className: clsx(toastClassName, className),
      onAutoClose: ({ id }) => {
        onAutoClose?.(id);
        onClose?.({ id, event: "on-auto-close" });
      },
      ...options,
    },
  );
};

const renderCustomToast = (
  jsx: Parameters<typeof SonnerToast.custom>[0],
  { onAutoClose, className, ...options }: CustomToastOptions = {},
) => {
  return SonnerToast.custom(jsx, {
    className: clsx(toastClassName, className),
    onAutoClose: ({ id }) => onAutoClose?.(id),
    ...options,
  });
};

const renderPromiseToast = <T extends ToastPromiseData>(
  promise: ToastPromise<T>,
  {
    loading,
    success,
    error,
    onDismiss,
    onAutoClose,
    onClose,
    duration,
    className,
    loader,
    showLoader,
    ...options
  }: PromiseToastOptions<T>,
) => {
  return SonnerToast.custom(
    (id) => (
      <PromiseToast
        id={id}
        promise={promise}
        loading={loading}
        success={success}
        error={error}
        duration={duration}
        onDismiss={onDismiss}
        onAutoClose={onAutoClose}
        onClose={onClose}
        loader={loader}
        showLoader={showLoader}
      />
    ),
    {
      duration: Infinity,
      className: clsx(toastClassName, className),
      ...options,
    },
  );
};

export const toast = Object.assign(renderToast, {
  info: (
    message: ToastMessage | ((id: ToastId) => ToastMessage),
    options?: Omit<ToastOptions, "type">,
  ) => {
    return renderToast(message, { ...options, type: "info" });
  },
  success: (
    message: ToastMessage | ((id: ToastId) => ToastMessage),
    options?: Omit<ToastOptions, "type">,
  ) => {
    return renderToast(message, { ...options, type: "success" });
  },
  error: (
    message: ToastMessage | ((id: ToastId) => ToastMessage),
    options?: Omit<ToastOptions, "type">,
  ) => {
    return renderToast(message, { ...options, type: "error" });
  },
  warning: (
    message: ToastMessage | ((id: ToastId) => ToastMessage),
    options?: Omit<ToastOptions, "type">,
  ) => {
    return renderToast(message, { ...options, type: "warning" });
  },
  custom: renderCustomToast,
  promise: renderPromiseToast,
  dismiss: SonnerToast.dismiss,
});

export { Toaster } from "sonner";
