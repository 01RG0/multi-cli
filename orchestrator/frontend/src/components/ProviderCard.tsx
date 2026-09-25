import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { animate } from 'framer-motion'

/* Provider "logos" — styled abbreviation circles */
const PROVIDERS = [
  { name: 'groq',        label: 'GQ', color: '#f97316' },
  { name: 'apmix',       label: 'AP', color: '#3b82f6' },
  { name: 'bedrock',     label: 'BR', color: '#f59e0b' },
  { name: 'tokenharbor', label: 'TH', color: '#8b5cf6' },
  { name: 'codecraft',   label: 'CC', color: '#10b981' },
  { name: 'aihubmix',    label: 'AH', color: '#ec4899' },
  { name: 'ollama',      label: 'OL', color: '#64748b' },
  { name: 'anthropic',   label: 'AN', color: '#cc9b7a' },
  { name: 'dahl',        label: 'DL', color: '#06b6d4' },
]

function Sparkles() {
  const count = 10
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        <motion.span
          key={i}
          animate={{
            top:     `${Math.random() * 100}%`,
            left:    `${Math.random() * 100}%`,
            opacity: [0, 1, 0],
            scale:   [1, 1.3, 0],
          }}
          transition={{
            duration: Math.random() * 2 + 3,
            repeat: Infinity,
            ease: 'linear',
            delay: Math.random() * 2,
          }}
          style={{
            position: 'absolute',
            width: 2, height: 2,
            borderRadius: '50%',
            background: '#22d3ee',
          }}
        />
      ))}
    </div>
  )
}

function ProviderOrb({ label, color, delay }: { label: string; color: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const ctrl = animate(ref.current,
      { y: [0, -6, 0], scale: [1, 1.1, 1] },
      { duration: 0.8, delay, repeat: Infinity, repeatDelay: PROVIDERS.length * 0.15 }
    )
    return () => ctrl.stop()
  }, [delay])

  return (
    <div ref={ref} style={{
      width: 52, height: 52,
      borderRadius: '50%',
      background: `radial-gradient(circle at 35% 35%, ${color}33, ${color}11)`,
      border: `1.5px solid ${color}55`,
      boxShadow: `0 0 12px ${color}30, inset 0 0 8px ${color}15`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: "'JetBrains Mono','Courier New',monospace",
        fontSize: 11, fontWeight: 700,
        color, letterSpacing: '0.04em',
      }}>{label}</span>
    </div>
  )
}

export default function ProviderCard() {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.6)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16,
      overflow: 'hidden',
      boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
    }}>
      {/* Animated orb area */}
      <div style={{
        position: 'relative',
        height: 130,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'radial-gradient(ellipse 80% 60% at 50% 50%, rgba(6,182,212,0.05) 0%, transparent 70%)',
        overflow: 'hidden',
      }}>
        {/* Scanning beam */}
        <motion.div
          animate={{ top: ['-10%', '110%'] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'linear', repeatDelay: 1.2 }}
          style={{
            position: 'absolute',
            left: 0, right: 0,
            height: 2,
            background: 'linear-gradient(90deg, transparent, #22d3ee, transparent)',
            zIndex: 4,
          }}
        >
          <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 0, right: 0 }}>
            <Sparkles />
          </div>
        </motion.div>

        {/* Provider orbs — wrap into two rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            {PROVIDERS.slice(0, 5).map((p, i) => (
              <ProviderOrb key={p.name} label={p.label} color={p.color} delay={i * 0.15} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            {PROVIDERS.slice(5).map((p, i) => (
              <ProviderOrb key={p.name} label={p.label} color={p.color} delay={(i + 5) * 0.15} />
            ))}
          </div>
        </div>
      </div>

      {/* Text */}
      <div style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
          Provider chain
        </div>
        <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
          {PROVIDERS.length} providers — auto-fallback on rate limit
        </div>
      </div>
    </div>
  )
}
