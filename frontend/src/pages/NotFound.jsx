import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="p-8 flex flex-col items-center justify-center h-full text-center">
      <h1 className="text-6xl font-bold text-zinc-700">404</h1>
      <p className="mt-4 text-zinc-400">Page not found.</p>
      <Link to="/" className="mt-6 text-blue-400 hover:text-blue-300 text-sm">
        Back to Dashboard
      </Link>
    </div>
  )
}
