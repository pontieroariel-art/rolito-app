interface LoadingSpinnerProps {
  fullScreen?: boolean
  className?:  string
}

export default function LoadingSpinner({ fullScreen, className }: LoadingSpinnerProps) {
  const spinner = (
    <div className="flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (fullScreen) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${className ?? 'bg-[#F1EFE8]'}`}>
        {spinner}
      </div>
    )
  }
  return spinner
}
