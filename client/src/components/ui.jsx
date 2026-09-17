import { useEffect } from 'react'

// Small shared UI primitives so the pages stay short and consistent.

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs sm:text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:gap-3">{actions}</div>}
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-sky-600 text-white hover:bg-sky-700',
    secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant]
  return (
    <button
      className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${styles} ${className}`}
      {...props}
    />
  )
}

export function Card({ className = '', children }) {
  return (
    <div className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`}>
      {children}
    </div>
  )
}

export function Field({ label, hint, required, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Input(props) {
  return <input {...props} className={`input ${props.className || ''}`} />
}

export function Select(props) {
  return <select {...props} className={`input ${props.className || ''}`} />
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    green: 'bg-green-100 text-green-700',
    slate: 'bg-slate-100 text-slate-500',
    amber: 'bg-amber-100 text-amber-700',
    sky: 'bg-sky-100 text-sky-700',
    red: 'bg-red-100 text-red-700',
  }[tone]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}>{children}</span>
}

export function ErrorText({ children }) {
  if (!children) return null
  return (
    <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
      {children}
    </div>
  )
}

export function Modal({ title, onClose, children, wide, className = '' }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs p-3 sm:p-4 flex items-center justify-center min-h-screen"
      onClick={onClose}
    >
      <div
        className={`w-full ${
          wide ? 'max-w-2xl' : 'max-w-md'
        } max-h-[min(90vh,calc(100dvh-2rem))] flex flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 my-auto ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 sm:px-6 sm:py-4 shrink-0">
          <div className="min-w-0 pr-3">
            {typeof title === 'string' ? (
              <h2 className="text-base sm:text-lg font-semibold text-slate-900 truncate">{title}</h2>
            ) : (
              title
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition shrink-0"
            title="Close"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}

export function Table({ columns, rows, empty = 'Nothing here yet.', loading }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr className="border-b border-slate-100">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-5 py-2.5 font-medium whitespace-nowrap ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-5 py-4 text-slate-500">
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-5 py-4 text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={row._key ?? i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-5 py-2.5 align-middle ${
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  )
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
          checked ? 'bg-sky-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition duration-200 ease-in-out ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="flex flex-col">
        {label && <span className="text-sm font-medium text-slate-700">{label}</span>}
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
    </label>
  )
}
