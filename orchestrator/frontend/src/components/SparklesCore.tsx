import { useEffect, useRef } from 'react'

interface Particle {
  x: number; y: number
  vx: number; vy: number
  size: number; opacity: number
  life: number; maxLife: number
}

interface Props {
  background?: string
  minSize?: number
  maxSize?: number
  particleDensity?: number
  particleColor?: string
  style?: React.CSSProperties
  className?: string
}

export function SparklesCore({
  background = 'transparent',
  minSize = 0.4,
  maxSize = 1,
  particleDensity = 800,
  particleColor = '#a5b4fc',
  style,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>(0)
  const particles = useRef<Particle[]>([])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current as HTMLCanvasElement
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    if (!ctx) return

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    function spawn(): Particle {
      const maxLife = 80 + Math.random() * 120
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.4 - 0.1,
        size: minSize + Math.random() * (maxSize - minSize),
        opacity: 0,
        life: 0,
        maxLife,
      }
    }

    const count = Math.floor((canvas.width * canvas.height) / (800000 / particleDensity))
    particles.current = Array.from({ length: count }, spawn)

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (background !== 'transparent') {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      for (const p of particles.current) {
        p.life++
        p.x += p.vx
        p.y += p.vy
        const half = p.maxLife / 2
        p.opacity = p.life < half ? p.life / half : 1 - (p.life - half) / half
        if (p.life >= p.maxLife) Object.assign(p, spawn())

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = particleColor
        ctx.globalAlpha = Math.max(0, p.opacity)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [background, minSize, maxSize, particleDensity, particleColor])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', ...style }}
    />
  )
}

/* Hero banner with sparkles — used at the top of the dashboard */
export function SparklesHero() {
  return (
    <div style={{
      position: 'relative',
      width: '100%', height: 56,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* Gradient line above sparkles */}
      <div style={{
        position: 'absolute', top: 0, left: '20%', right: '20%', height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.8), rgba(14,165,233,0.6), transparent)',
      }} />
      <div style={{
        position: 'absolute', top: 0, left: '35%', right: '35%', height: 3,
        background: 'linear-gradient(90deg, transparent, #6366f1, transparent)',
        filter: 'blur(2px)',
      }} />

      {/* Sparkles canvas */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <SparklesCore
          particleDensity={600}
          particleColor="#a5b4fc"
          minSize={0.3}
          maxSize={0.9}
        />
      </div>

      {/* Radial fade at edges */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 70% 100% at 50% 0%, transparent 30%, #020817 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  )
}
