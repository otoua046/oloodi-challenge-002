import type { ReactNode } from 'react'

// Shows the worker's view on a phone when the window is wide. On a phone-sized window the frame disappears.
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <div className="device-stage">
    <div className="phone">
      <div className="phone-screen">
        <div className="status-bar" aria-hidden="true">
          <span>9:41</span>
          <span />
          <svg width="68" height="12" viewBox="0 0 68 12" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="1" />
            <rect x="4.5" y="6" width="3" height="6" rx="1" />
            <rect x="9" y="3.5" width="3" height="8.5" rx="1" />
            <rect x="13.5" y="1" width="3" height="11" rx="1" />
            <path d="M34 11.6 31.7 9.2a3.3 3.3 0 0 1 4.6 0ZM29.5 7a6.4 6.4 0 0 1 9 0l1.5-1.6a8.6 8.6 0 0 0-12 0Zm-2.2-2.3a9.6 9.6 0 0 1 13.4 0L42.2 3a11.8 11.8 0 0 0-16.4 0Z" />
            <rect x="45.5" y=".5" width="19.5" height="11" rx="3.3" fill="none" stroke="currentColor" opacity=".45" />
            <rect x="47.5" y="2.5" width="15.5" height="7" rx="1.8" />
            <path d="M66.3 4v4a2 2 0 0 0 0-4Z" opacity=".45" />
          </svg>
        </div>
        <div className="phone-scroll">{children}</div>
      </div>
    </div>
  </div>
}
