import * as React from 'react'
import { cn } from '../../lib/utils'

const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('animate-pulse rounded-md bg-bg-3', className)}
      aria-hidden="true"
      {...props}
    />
  )
)
Skeleton.displayName = 'Skeleton'

export { Skeleton }
