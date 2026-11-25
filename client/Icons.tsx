import type { ReactNode } from 'react'

const paths = {
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <path d="M7.5 3v4m9-4v4m-13 3h17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 7v5l3.4 2" />
    </>
  ),
  pin: (
    <>
      <path d="M19.3 10c0 5.3-7.3 11-7.3 11S4.7 15.3 4.7 10a7.3 7.3 0 0 1 14.6 0Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4.5V20" />
    </>
  ),
  open: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 11-3m4-4v8m-4-4h8" />
    </>
  ),
  checkIn: (
    <>
      <path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5M3 12h12m-4-4 4 4-4 4" />
    </>
  ),
  checkOut: (
    <>
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m-2-8h12m-4-4 4 4-4 4" />
    </>
  ),
  invite: (
    <>
      <path d="m21 3-5.8 17-4.1-7.2L3 9.4 21 3Zm0 0-9.9 9.8" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 7.5 3v5c0 4.3-3.1 7.8-7.5 10-4.4-2.2-7.5-5.7-7.5-10V6L12 3Z" />
      <path d="m9 11.5 2 2 4-4" />
    </>
  ),
  down: <path d="m7 10 5 5 5-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="m6.5 6.5 11 11m0-11-11 11" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

// A decorative venue plan for the shift header, drawn in local coordinates.
export function VenuePlan() {
  return (
    <svg className="venue-plan" aria-hidden="true" viewBox="0 0 420 210" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="plan-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0v16" fill="none" stroke="currentColor" opacity=".22" strokeWidth=".65" />
        </pattern>
        <pattern id="plan-seats" width="9" height="9" patternUnits="userSpaceOnUse">
          <rect
            x="1"
            y="1"
            width="5.6"
            height="5.6"
            rx=".8"
            fill="none"
            stroke="currentColor"
            opacity=".67"
            strokeWidth=".7"
          />
        </pattern>
      </defs>
      <g transform="rotate(-16 225 105)" fill="none" stroke="currentColor">
        <rect x="-35" y="-75" width="550" height="370" stroke="none" fill="url(#plan-grid)" />
        <g strokeWidth="1.1">
          <path d="M51 35h94v-9h164v12h61v121h-18v22h-44v12H141v-10H60v-35H46V65h5Z" />
          <path d="M57 41h94v-9h152v12h61v109h-18v22h-44v12H147v-10H66v-35H52V71h5Z" />
          <path d="M151 32v155m151-143v131M57 75h69v71H66m-9-67h65v63H65m242-90h44v35h-44zm0 51h44v50h-44z" />
          <path d="M169 47h115v20H169z" fill="currentColor" fillOpacity=".13" />
          <path d="M167 80h47v33h-47zm61 0h57v33h-57zm-61 46h47v41h-47zm61 0h57v41h-57z" fill="url(#plan-seats)" />
          <path d="M72 89h39v43H72z" strokeDasharray="3 3" />
        </g>
        <g strokeWidth=".65" opacity=".75">
          <path
            d="M41 15h340M51 9v12m319-12v12M387 35v146m-5-146h10m-10 146h10M30 201h305M34 26v153"
            strokeDasharray="5 3"
          />
          <path d="M42 15h18m301 0h18M387 28v15m0 131v15" />
        </g>
      </g>
    </svg>
  )
}
