import { useSignals } from "@preact/signals-react/runtime";
import { AUTH_STATUS } from "~/enums";
import { authentication } from "~/signals";
// import ProfileDropdown from "./ProfileDropdown";

export const AuthButtons = ({
  loginSignUpPressed,
}: {
  loginSignUpPressed: () => void;
}) => {
  useSignals();

  const { status } = authentication;

  if (status.value === AUTH_STATUS.LOGGED_IN) {
    return null;
  } else {
    return (
      <>
        <div className="flex items-center gap-2">
          <button
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={() => {
              loginSignUpPressed();
            }}
          >
            Login / Sign Up
          </button>
        </div>
      </>
    );
  }
};
