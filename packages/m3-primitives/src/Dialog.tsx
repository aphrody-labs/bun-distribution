// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/Dialog.tsx), MIT, rebuilt on Material Design 3.
"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { type ButtonHTMLAttributes, type ReactElement, type ReactNode, forwardRef, useEffect, useState } from "react";
import { type FieldValues, type UseFormHandleSubmit } from "react-hook-form";

import { type AsChildProp, asChildProps, createPortalScope, withClassName } from "./base-ui";
import { Icon, type IconSource, renderIcon } from "./Icon";
import { Loader } from "./Loader";
import { Form, type FormProps } from "./forms/Form";

export interface DialogState {
  open: boolean;
}

export interface DialogOptions {
  onSubmit?(): void;
}

export interface UseDialogProps extends DialogOptions {
  id: number;
}

class DialogManager {
  private idGenerator = 0;
  private listeners = new Map<number, Set<(state: DialogState) => void>>();
  private states = new Map<number, DialogState>();
  private components = new Map<number, React.FC>();

  create(dialog: (props: UseDialogProps) => ReactElement, options?: DialogOptions) {
    const id = this.getId();

    this.components.set(id, () => dialog({ id, ...options }));
    this.states.set(id, { open: true });
    this.listeners.set(id, new Set());

    this.notifyGlobalListeners();

    return new Promise<void>(res => {
      const checkInterval = setInterval(() => {
        if (!this.components.has(id)) {
          clearInterval(checkInterval);
          res();
        }
      }, 100);
    });
  }

  getId() {
    return ++this.idGenerator;
  }

  getState(id: number): DialogState | undefined {
    return this.states.get(id);
  }

  setState(id: number, state: Partial<DialogState>) {
    const current = this.states.get(id);
    if (!current) return;

    const newState = { ...current, ...state };
    this.states.set(id, newState);

    const listeners = this.listeners.get(id);
    if (listeners) {
      listeners.forEach(listener => listener(newState));
    }
  }

  subscribe(id: number, listener: (state: DialogState) => void) {
    const listeners = this.listeners.get(id);
    if (listeners) {
      listeners.add(listener);
    }

    return () => {
      const registered = this.listeners.get(id);
      if (registered) {
        registered.delete(listener);
      }
    };
  }

  private globalListeners = new Set<() => void>();

  subscribeGlobal(listener: () => void) {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private notifyGlobalListeners() {
    this.globalListeners.forEach(listener => listener());
  }

  getComponents() {
    return Array.from(this.components.entries());
  }

  isAnyDialogOpen() {
    return Array.from(this.states.values()).some(s => s.open);
  }

  remove(id: number) {
    const state = this.getState(id);

    if (!state) {
      console.error(new Error(`Dialog ${id} not registered!`));
    } else if (state.open === false) {
      this.components.delete(id);
      this.states.delete(id);
      this.listeners.delete(id);
      this.notifyGlobalListeners();
    }
  }
}

export const dialogManager = new DialogManager();

function Remover({ id }: { id: number }) {
  useEffect(
    () => () => {
      dialogManager.remove(id);
    },
    [id],
  );

  return null;
}

export function useDialog(props: UseDialogProps) {
  const [state, setState] = useState<DialogState>(() => {
    const initialState = dialogManager.getState(props.id);
    if (!initialState) throw new Error(`Dialog ${props.id} does not exist!`);
    return initialState;
  });

  useEffect(() => {
    return dialogManager.subscribe(props.id, setState);
  }, [props.id]);

  return {
    ...props,
    state,
  };
}

export function Dialogs() {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    return dialogManager.subscribeGlobal(() => {
      forceUpdate({});
    });
  }, []);

  const dialogs = dialogManager.getComponents();

  return (
    <>
      {dialogs.map(([id, DialogComponent]) => (
        <DialogComponent key={id} />
      ))}
    </>
  );
}

/**
 * M3 dialog motion in CSS, driven by Base UI's `data-starting-style` / `data-ending-style`:
 * enter emphasized-decelerate (medium2, 300 ms), exit emphasized-accelerate (short4, 200 ms).
 * Base UI keeps the dialog mounted until the exit transition ends.
 */
const scrimMotion = clsx(
  "transition-opacity duration-300 ease-emphasized-decelerate",
  "data-starting-style:opacity-0",
  "data-ending-style:opacity-0 data-ending-style:duration-200 data-ending-style:ease-emphasized-accelerate",
);
const surfaceMotion = clsx(
  "transition-[opacity,scale] duration-300 ease-emphasized-decelerate",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-200 data-ending-style:ease-emphasized-accelerate",
);

/** M3 basic-dialog container: `surface-container-high`, extra-large corners, level 3, 24dp padding. */
export const dialogSurfaceClassNames = clsx(
  "flex min-w-[280px] max-w-[560px] flex-col p-6",
  "rounded-extra-large bg-surface-container-high text-on-surface shadow-md3-3",
);

/** M3 dialog actions are text buttons; `danger` is the destructive tone. */
const dialogActionStyles = cva(
  [
    "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-3 outline-none",
    "text-label-large transition-colors duration-200 ease-standard",
    "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
    "disabled:pointer-events-none disabled:text-on-surface/38",
  ],
  {
    variants: {
      tone: {
        primary: "text-primary hover:bg-primary/8 active:bg-primary/10 focus-visible:bg-primary/10",
        danger: "text-error hover:bg-error/8 active:bg-error/10 focus-visible:bg-error/10",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

const DialogAction = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }>(
  ({ danger, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx(dialogActionStyles({ tone: danger ? "danger" : "primary" }), className)}
      {...props}
    />
  ),
);

DialogAction.displayName = "DialogAction";

export interface DialogProps<S extends FieldValues>
  extends Omit<DialogPrimitive.Root.Props, "children">, Omit<FormProps<S>, "onSubmit"> {
  title?: string;
  dialog: ReturnType<typeof useDialog>;
  loading?: boolean;
  trigger?: ReactNode;
  ctaLabel?: string;
  ctaSecondLabel?: string;
  onSubmit?: ReturnType<UseFormHandleSubmit<S>>;
  onSubmitSecond?: ReturnType<UseFormHandleSubmit<S>>;
  children?: ReactNode;
  ctaDanger?: boolean;
  cancelDanger?: boolean;
  closeLabel?: string;
  cancelLabel?: string;
  cancelBtn?: boolean;
  description?: ReactNode;
  onCancelled?: boolean | (() => void);
  submitDisabled?: boolean;
  transformOrigin?: string;
  buttonsSideContent?: ReactNode;
  invertButtonFocus?: boolean;
  errorMessageException?: string;
  formClassName?: string;
  /** M3 hero icon: a Material Symbols name, an element or an icon component. */
  icon?: IconSource;
  hideButtons?: boolean;
  hideHeader?: boolean;
  ignoreClickOutside?: boolean;
}

export function Dialog<S extends FieldValues>({
  form,
  dialog,
  onSubmit,
  onSubmitSecond,
  onCancelled = true,
  invertButtonFocus,
  ...props
}: DialogProps<S>) {
  const setOpen = (v: boolean) => dialogManager.setState(dialog.id, { open: v });

  const cancelButton = (
    <DialogClose asChild>
      <DialogAction danger={props.cancelDanger} onClick={typeof onCancelled === "function" ? onCancelled : undefined}>
        {props.cancelLabel || "Cancel"}
      </DialogAction>
    </DialogClose>
  );

  const closeButton = (
    <DialogClose asChild>
      <DialogAction disabled={props.loading} onClick={typeof onCancelled === "function" ? onCancelled : undefined}>
        {props.closeLabel || "Close"}
      </DialogAction>
    </DialogClose>
  );

  const disableCheck = props.errorMessageException
    ? !form.formState.isValid &&
      !form.formState.errors.root?.serverError?.message?.startsWith(props.errorMessageException as string)
    : !form.formState.isValid;

  const submitDisabled = form.formState.isSubmitting || props.submitDisabled || disableCheck;

  const submitButton = props.ctaLabel ? (
    !props.ctaSecondLabel ? (
      <DialogAction
        type="submit"
        disabled={submitDisabled}
        danger={props.ctaDanger}
        onClick={async (e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault();
          await onSubmit?.(e);
          dialog.onSubmit?.();
        }}
      >
        {props.ctaLabel}
      </DialogAction>
    ) : (
      <div className="flex flex-row gap-x-2">
        <DialogAction
          type="submit"
          disabled={submitDisabled}
          danger={props.ctaDanger}
          onClick={async (e: React.MouseEvent<HTMLElement>) => {
            e.preventDefault();
            await onSubmit?.(e);
            dialog.onSubmit?.();
          }}
        >
          {props.ctaLabel}
        </DialogAction>
        <DialogAction
          type="submit"
          disabled={submitDisabled}
          onClick={async (e: React.MouseEvent<HTMLElement>) => {
            e.preventDefault();
            await onSubmitSecond?.(e);
            dialog.onSubmit?.();
          }}
        >
          {props.ctaSecondLabel}
        </DialogAction>
      </div>
    )
  ) : null;

  const showActions =
    props.buttonsSideContent || (!props.hideButtons && (submitButton || props.cancelBtn || onCancelled));

  return (
    <DialogPrimitive.Root
      open={dialog.state.open}
      onOpenChange={open => setOpen(open)}
      disablePointerDismissal={props.ignoreClickOutside}
    >
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className={clsx("fixed inset-0 z-[102] bg-scrim/32", scrimMotion)} />
        <DialogPrimitive.Viewport className="fixed inset-0 z-[103] grid place-items-center overflow-y-auto">
          <DialogPrimitive.Popup
            className={clsx("my-8 outline-none", surfaceMotion)}
            style={{ transformOrigin: props.transformOrigin || "center" }}
          >
            <Form
              form={form}
              onSubmit={async e => {
                e?.preventDefault();
                if (onSubmit) {
                  await onSubmit(e);
                }
              }}
              className={clsx(dialogSurfaceClassNames, props.formClassName)}
            >
              {!props.hideHeader && (
                <div
                  className={clsx("mb-4 flex flex-col gap-4", props.icon ? "items-center text-center" : "items-start")}
                >
                  {props.icon && <span className="flex text-secondary">{renderIcon(props.icon, { size: 24 })}</span>}
                  <DialogPrimitive.Title className="text-headline-small text-on-surface">
                    {props.title}
                  </DialogPrimitive.Title>
                </div>
              )}
              <div className="flex-1 overflow-auto text-body-medium text-on-surface-variant">
                {props.description && (
                  <DialogPrimitive.Description className="mb-4 text-body-medium text-on-surface-variant">
                    {props.description}
                  </DialogPrimitive.Description>
                )}

                {props.children}
              </div>
              {showActions && (
                <div className="mt-6 flex items-center justify-end gap-2">
                  {form.formState.isSubmitting && <Loader />}
                  {props.buttonsSideContent && <div>{props.buttonsSideContent}</div>}
                  <div className="grow" />
                  {!props.hideButtons && (
                    <div className={clsx(invertButtonFocus ? "flex-row-reverse" : "flex-row", "flex gap-2")}>
                      {invertButtonFocus ? (
                        <>
                          {submitButton}
                          {props.cancelBtn && cancelButton}
                          {onCancelled && closeButton}
                        </>
                      ) : (
                        <>
                          {onCancelled && closeButton}
                          {props.cancelBtn && cancelButton}
                          {submitButton}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Form>
            <Remover id={dialog.id} />
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogRoot = DialogPrimitive.Root;

export interface DialogTriggerProps extends DialogPrimitive.Trigger.Props, AsChildProp {}

export const DialogTrigger = forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ asChild, children, ...props }, ref) => (
    <DialogPrimitive.Trigger ref={ref} {...asChildProps(asChild, children)} {...props} />
  ),
);
DialogTrigger.displayName = "DialogTrigger";

const { Portal: DialogPortal, EnsurePortal } = createPortalScope(DialogPrimitive.Portal, "DialogPortal");
export { DialogPortal };

export interface DialogCloseProps extends DialogPrimitive.Close.Props, AsChildProp {}

export const DialogClose = forwardRef<HTMLButtonElement, DialogCloseProps>(({ asChild, children, ...props }, ref) => (
  <DialogPrimitive.Close ref={ref} {...asChildProps(asChild, children)} {...props} />
));
DialogClose.displayName = "DialogClose";

/** M3 scrim (Base UI `Dialog.Backdrop`): `scrim` at 32 %. */
export const DialogOverlay = ({ className, ...props }: DialogPrimitive.Backdrop.Props) => (
  <DialogPrimitive.Backdrop
    className={withClassName(clsx("fixed inset-0 z-50 bg-scrim/32", scrimMotion), className)}
    {...props}
  />
);

DialogOverlay.displayName = "DialogOverlay";

export interface DialogContentProps extends DialogPrimitive.Popup.Props {
  /** Radix name for the portal's `keepMounted`. */
  forceMount?: boolean;
}

/**
 * Composable M3 basic dialog: portal (unless inside `DialogPortal`), scrim and a centered
 * Base UI popup (focus trap, Escape and outside-press dismissal, `role="dialog"`), with a
 * trailing close icon button.
 */
export const DialogContent = ({ className, children, forceMount, ...props }: DialogContentProps) => (
  <EnsurePortal keepMounted={forceMount}>
    <DialogOverlay />
    <DialogPrimitive.Popup
      className={withClassName(
        clsx(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2 gap-4 outline-none",
          dialogSurfaceClassNames,
          surfaceMotion,
        ),
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={clsx(
          "absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-full outline-none",
          "text-on-surface-variant transition-colors duration-200 ease-standard",
          "hover:bg-on-surface-variant/8 active:bg-on-surface-variant/10",
          "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary",
          "disabled:pointer-events-none",
        )}
      >
        <Icon name="close" size={24} />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Popup>
  </EnsurePortal>
);

DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("flex flex-col gap-4 text-left", className)} {...props} />
);

DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("flex flex-row flex-wrap items-center justify-end gap-2 pt-2", className)} {...props} />
);

DialogFooter.displayName = "DialogFooter";

export const DialogTitle = ({ className, ...props }: DialogPrimitive.Title.Props) => (
  <DialogPrimitive.Title className={withClassName("text-headline-small text-on-surface", className)} {...props} />
);

DialogTitle.displayName = "DialogTitle";

export const DialogDescription = ({ className, ...props }: DialogPrimitive.Description.Props) => (
  <DialogPrimitive.Description
    className={withClassName("text-body-medium text-on-surface-variant", className)}
    {...props}
  />
);

DialogDescription.displayName = "DialogDescription";
