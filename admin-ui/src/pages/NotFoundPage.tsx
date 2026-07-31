import { useNavigate, useLocation } from 'react-router';

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sunken px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-10 text-center shadow-sm">
        {/* 404 numeric display */}
        <p className="text-8xl font-extrabold tracking-tight text-accent">404</p>

        <h1 className="mt-4 text-2xl font-bold text-fg">Page Not Found</h1>
        <p className="mt-2 text-sm text-subtle">
          The page{' '}
          <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs text-muted">
            {location.pathname}
          </code>{' '}
          does not exist.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={() => navigate(-1)}
            className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
          >
            Go Back
          </button>
          <button
            onClick={() => navigate('/console', { replace: true })}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
