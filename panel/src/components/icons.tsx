import type { SVGProps } from 'react'

// Own icon set: 20 grid, 1.7 stroke with round caps. Only the ones
// the panel uses; each one inherits the text color (currentColor).
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function make(paths: string[], extra?: (p: IconProps) => React.ReactNode) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        {...props}
        className={props.className ? `icon ${props.className}` : 'icon'}
      >
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {extra?.(props)}
      </svg>
    )
  }
}

export const Bell = make(['M10 3.2a4.6 4.6 0 0 0-4.6 4.6v2.6L4 13.2h12l-1.4-2.8V7.8A4.6 4.6 0 0 0 10 3.2Z', 'M8.2 15.6a1.9 1.9 0 0 0 3.6 0'])
export const Menu = make(['M3.5 6h13', 'M3.5 10h9', 'M3.5 14h13'])
export const PanelLeft = make(['M4.5 3.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z', 'M8 3.5v13'])
export const Home = make(['M3 9.6 10 3.6l7 6', 'M5 8.6V16h10V8.6', 'M8.4 16v-3.6h3.2V16'])
export const Inbox = make(['M3 11.5 5.2 4.5h9.6L17 11.5V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3.5Z', 'M3 11.5h4.2a2.8 2.8 0 0 0 5.6 0H17'])
export const Layers = make(['M10 3 17.5 7 10 11 2.5 7 10 3Z', 'M2.5 10.5 10 14.5l7.5-4', 'M2.5 13.8 10 17.8l7.5-4'])
export const LogOut = make(['M8 3.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h3', 'M12 6.5 16 10l-4 3.5', 'M16 10H8'])
export const Plug = make(['M7 3v4', 'M13 3v4', 'M5 7h10v2.5A5 5 0 0 1 10 14.5 5 5 0 0 1 5 9.5V7Z', 'M10 14.5V17'])
export const Plus = make(['M10 4v12', 'M4 10h12'])
export const Settings = make(['M3.5 5.5h6', 'M13.5 5.5h3', 'M3.5 10h2', 'M9.5 10h7', 'M3.5 14.5h8', 'M15.5 14.5h1'], () => (
  <>
    <circle cx="11.5" cy="5.5" r="2" />
    <circle cx="7.5" cy="10" r="2" />
    <circle cx="13.5" cy="14.5" r="2" />
  </>
))
export const Users = make(['M2.8 16c0-2.8 2.3-4.6 5.2-4.6s5.2 1.8 5.2 4.6', 'M14.6 11.6c2 .2 3.4 1.6 3.4 3.6'], () => (
  <>
    <circle cx="8" cy="7" r="3" />
    <circle cx="14" cy="7.5" r="2.4" />
  </>
))
export const ChevronDown = make(['M5 8l5 5 5-5'])
export const ChevronRight = make(['M8 5l5 5-5 5'])
export const X = make(['M5 5l10 10', 'M15 5L5 15'])
export const Check = make(['M4.5 10.5l3.5 3.5 7.5-8'])
export const Paperclip = make(['M14.5 9.5l-5 5a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.9 2.9l-6 6a1 1 0 0 1-1.5-1.5l5-5'])
export const Camera = make(['M3 7a1.5 1.5 0 0 1 1.5-1.5h1.6l1.2-1.8h5.4l1.2 1.8h1.6A1.5 1.5 0 0 1 17 7v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5V7Z'], () => <circle cx="10" cy="10.6" r="2.9" />)
export const Mic = make(['M4.8 9.5a5.2 5.2 0 0 0 10.4 0', 'M10 14.7V17', 'M7.5 17h5'], () => <rect x="7.5" y="3" width="5" height="9" rx="2.5" />)
export const Send = make(['M3.2 9.2 16.8 3.4 11.6 16.8l-2.4-5.4-6-2.2Z', 'M9.2 11.4l3.4-3.6'])
export const Square = make([], () => <rect x="5" y="5" width="10" height="10" rx="2" />)
export const Link2 = make(['M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9', 'M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9'])
export const Search = make(['M12.6 12.6l3.9 3.9'], () => <circle cx="8.8" cy="8.8" r="5" />)
export const Pencil = make(['M3.5 16.5l.8-3.6L13.6 3.6a1.9 1.9 0 0 1 2.7 2.7L7 15.6l-3.5.9Z', 'M12 5.2l2.8 2.8'])
export const Trash2 = make(['M4 5.5h12', 'M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5', 'M5.5 5.5l.7 10a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10', 'M8.5 9v4.5', 'M11.5 9v4.5'])
export const MessageSquare = make(['M3.5 5A1.5 1.5 0 0 1 5 3.5h10A1.5 1.5 0 0 1 16.5 5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.8 3v-3H5A1.5 1.5 0 0 1 3.5 12V5Z'])
export const ArrowRight = make(['M4 10h12', 'M11.5 5.5 16 10l-4.5 4.5'])
export const ArrowLeft = make(['M16 10H4', 'M8.5 5.5 4 10l4.5 4.5'])
const FILE = ['M5.5 2.8h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z', 'M11.5 2.8v3.5H15']
export const Download = make(['M10 3.5v9', 'M6.2 9.2 10 13l3.8-3.8', 'M4 16.5h12'])
export const FileText = make([...FILE, 'M7.3 10h5.4', 'M7.3 13h5.4'])
export const Film = make(['M4.5 4.5h11a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14V6a1.5 1.5 0 0 1 1.5-1.5Z', 'M6.8 4.5v11', 'M13.2 4.5v11', 'M3 8.2h3.8', 'M3 11.8h3.8', 'M13.2 8.2H17', 'M13.2 11.8H17'])
export const Undo = make(['M7.5 4 3.5 8l4 4', 'M3.5 8H12a4.5 4.5 0 0 1 0 9H8'])
export const Redo = make(['M12.5 4l4 4-4 4', 'M16.5 8H8a4.5 4.5 0 0 0 0 9h4'])
export const ChevronLeft = make(['M12 5l-5 5 5 5'])
export const RotateCw = make(['M16 10a6 6 0 1 1-2-4.5', 'M16 3.5V6h-2.5'])
export const Play = make(['M7 4.5v11l9-5.5-9-5.5Z'])
export const Pause = make(['M7 4.5v11', 'M13 4.5v11'])
export const UserPlus = make(['M2.8 16c0-2.8 2.3-4.6 5.2-4.6s5.2 1.8 5.2 4.6', 'M15 6.5v5', 'M12.5 9h5'], () => <circle cx="8" cy="7" r="3" />)
export const Eye = make(['M2.2 10S5 4.8 10 4.8 17.8 10 17.8 10 15 15.2 10 15.2 2.2 10 2.2 10Z'], () => <circle cx="10" cy="10" r="2.4" />)
export const EyeOff = make(['M2.2 10S5 4.8 10 4.8c1.3 0 2.5.4 3.5 1', 'M17.8 10S15 15.2 10 15.2c-1.3 0-2.5-.4-3.5-1', 'M3.5 3.5l13 13', 'M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4'])
export const Lock = make(['M5 9h10v7.5H5V9Z', 'M7 9V6.5a3 3 0 0 1 6 0V9'])
export const Sparkles = make(['M9 3.2c.5 3.4 2.2 5.1 5.6 5.6-3.4.5-5.1 2.2-5.6 5.6-.5-3.4-2.2-5.1-5.6-5.6C6.8 8.3 8.5 6.6 9 3.2Z', 'M15.4 12.6c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z'])

// Priority marks (UD-029): the shape also says the priority, so the color is never the only signal.
export const AlertTriangle = make(['M10 3.4 17.2 16H2.8L10 3.4Z', 'M10 8.2v3.6', 'M10 13.9v.1'])
export const Clock = make(['M10 3.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Z', 'M10 6.4V10l2.4 1.6'])
export const InfoDot = make(['M10 3.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6Z', 'M10 9v4.4', 'M10 6.7v.1'])
