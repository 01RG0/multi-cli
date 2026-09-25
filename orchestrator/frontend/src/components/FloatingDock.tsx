import {
  AnimatePresence,
  type MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import { useRef, useState } from 'react'
import {
  IconHome,
  IconTerminal2,
  IconBrandGithub,
  IconActivity,
  IconBrain,
  IconDatabase,
  IconHeartbeat,
} from '@tabler/icons-react'

export type DockItem = {
  title: string
  icon: React.ReactNode
  href: string
  onClick?: (e: React.MouseEvent) => void
}

function IconContainer({
  mouseX,
  title,
  icon,
  href,
  onClick,
}: DockItem & { mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  const distance = useTransform(mouseX, val => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 }
    return val - bounds.x - bounds.width / 2
  })

  const sizeTransform = useTransform(distance, [-150, 0, 150], [40, 70, 40])
  const size = useSpring(sizeTransform, { mass: 0.1, stiffness: 150, damping: 12 })

  return (
    <a href={href} onClick={onClick} style={{ textDecoration: 'none', display: 'block' }}>
      <motion.div
        ref={ref}
        style={{
          width: size,
          height: size,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: hovered ? 'rgba(99,102,241,0.15)' : 'rgba(15,23,42,0.8)',
          border: `1px solid ${hovered ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)'}`,
          backdropFilter: 'blur(12px)',
          cursor: 'pointer',
          transition: 'background 0.15s, border-color 0.15s',
          boxShadow: hovered ? '0 0 16px rgba(99,102,241,0.25)' : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        whileTap={{ scale: 0.9 }}
      >
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 6, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 3, x: '-50%' }}
              transition={{ duration: 0.1 }}
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: '50%',
                whiteSpace: 'nowrap',
                background: 'rgba(2,8,23,0.95)',
                border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 6,
                padding: '3px 10px',
                fontSize: 11,
                fontWeight: 600,
                color: '#a5b4fc',
                letterSpacing: '0.04em',
                backdropFilter: 'blur(8px)',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            >
              {title}
            </motion.div>
          )}
        </AnimatePresence>

        <div style={{
          width: '45%', height: '45%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: hovered ? '#a5b4fc' : '#64748b',
          transition: 'color 0.15s',
        }}>
          {icon}
        </div>
      </motion.div>
    </a>
  )
}

export function FloatingDock({ items }: { items: DockItem[] }) {
  const mouseX = useMotionValue(Infinity)

  return (
    <motion.div
      onMouseMove={e => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        height: 68,
        padding: '0 18px 10px',
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 9999,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {items.map(item => (
        <IconContainer key={item.title} mouseX={mouseX} {...item} />
      ))}
    </motion.div>
  )
}

export function buildDockItems(): DockItem[] {
  return [
    {
      title: 'Top',
      icon: <IconHome size="100%" strokeWidth={1.5} />,
      href: '#',
      onClick: e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) },
    },
    {
      title: 'Brain Graph',
      icon: <IconBrain size="100%" strokeWidth={1.5} />,
      href: '#brain',
    },
    {
      title: 'Task Stream',
      icon: <IconTerminal2 size="100%" strokeWidth={1.5} />,
      href: '#feed',
    },
    {
      title: 'Stats',
      icon: <IconActivity size="100%" strokeWidth={1.5} />,
      href: '#stats',
    },
    {
      title: 'Health',
      icon: <IconHeartbeat size="100%" strokeWidth={1.5} />,
      href: '/health',
    },
    {
      title: 'API',
      icon: <IconDatabase size="100%" strokeWidth={1.5} />,
      href: '/api/tasks',
    },
    {
      title: 'GitHub',
      icon: <IconBrandGithub size="100%" strokeWidth={1.5} />,
      href: 'https://github.com/01RG0/multi-cli',
    },
  ]
}
