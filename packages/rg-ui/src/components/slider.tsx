/* eslint-disable react/no-array-index-key -- Thumb indices identify persistent handles while values change. */
"use client";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { type PrimitiveProps } from "../lib/render";
import { cn } from "../lib/utils";
type SliderProps = Omit<
  PrimitiveProps<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "onValueCommitted"
> & {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  minStepsBetweenThumbs?: number;
  inverted?: boolean;
};
function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  minStepsBetweenThumbs,
  inverted = false,
  orientation = "horizontal",
  dir,
  ...props
}: SliderProps) {
  if (inverted && orientation === "vertical")
    throw new Error("Inverted vertical sliders require an owner-supported Base UI primitive");
  const values = value ?? defaultValue ?? [props.min ?? 0];
  const slider = (
    <SliderPrimitive.Root
      {...props}
      value={value}
      defaultValue={defaultValue ?? [props.min ?? 0]}
      onValueChange={onValueChange}
      onValueCommitted={onValueCommit}
      thumbCollisionBehavior="none"
      minStepsBetweenValues={minStepsBetweenThumbs}
      orientation={orientation}
      data-slot="slider"
      className={cn("relative w-full touch-none select-none", className)}
    >
      <SliderPrimitive.Control className="relative flex w-full items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-24 data-[orientation=vertical]:w-5">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2"
        >
          <SliderPrimitive.Indicator data-slot="slider-range" className="absolute rounded-full bg-primary" />
        </SliderPrimitive.Track>
        {values.map((_, index) => (
          <SliderPrimitive.Thumb
            key={"thumb-" + index}
            index={index}
            data-slot="slider-thumb"
            className="block size-5 rounded-full border-2 border-primary bg-background transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
  return inverted || dir ? (
    <DirectionProvider direction={inverted ? (dir === "rtl" ? "ltr" : "rtl") : dir === "rtl" ? "rtl" : "ltr"}>
      {slider}
    </DirectionProvider>
  ) : (
    slider
  );
}
export { Slider };
