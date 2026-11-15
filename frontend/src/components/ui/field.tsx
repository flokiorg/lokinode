import * as React from "react"
import { cn } from "@/lib/utils"

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode
  errorText?: React.ReactNode
  optionalText?: React.ReactNode
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  function Field({ label, children, errorText, className, ...rest }, ref) {
    return (
      <div ref={ref} className={cn("flex flex-col gap-[6px]", className)} {...rest}>
        {label && (
          <label className="text-gray-400 text-[11px] font-label uppercase tracking-[0.08em]">
            {label}
          </label>
        )}
        {children}
        {errorText && (
          <span className="text-red-400 text-[12px]">{errorText}</span>
        )}
      </div>
    )
  }
)
