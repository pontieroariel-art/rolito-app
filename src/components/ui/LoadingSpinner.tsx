interface LoadingSpinnerProps {
  fullScreen?: boolean
}

export default function LoadingSpinner({ fullScreen }: LoadingSpinnerProps) {
  const spinner = (
    <div className="flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (fullScreen) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        {spinner}
      </div>
    )
  }
  return spinner
}
