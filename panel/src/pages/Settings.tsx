import { type ReactNode, useState } from 'react'
import { EditableText } from '@/components/EditableText'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { useMe, useProviders, useSaveProvider } from '@/lib/queries'
import { readThemePref, saveTheme, type ThemePref } from '@/lib/theme'
import type { ProviderSetting, ProviderSlot } from '@/lib/types'

const SLOT_LABEL: Record<ProviderSlot, string> = { text: 'Texto', vision: 'Visión', speech: 'Transcripción' }
/** Implementaciones de proveedor de MASTER-SPEC §7.6. */
const KNOWN_PROVIDERS = ['anthropic', 'openai-compatible', 'groq-speech']

export function Settings() {
  const me = useMe().data
  const [theme, setTheme] = useState<ThemePref>(readThemePref)

  return (
    <div className="flex w-full max-w-[52rem] flex-col gap-10 px-5 py-7 md:px-10 md:py-10">
      <PageHeader title="Configuración" />

      <Section title="Cuenta">
        <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Nombre</dt>
          <dd>{me?.name}</dd>
          <dt className="text-muted">Correo</dt>
          <dd className="break-all">{me?.email}</dd>
          <dt className="text-muted">Rol</dt>
          <dd>{me?.role === 'editor' ? 'Editor' : 'Miembro'}</dd>
        </dl>
      </Section>

      <Section title="Tema">
        <Segmented
          label="Tema"
          value={theme}
          onChange={(t) => {
            setTheme(t)
            saveTheme(t)
          }}
          options={[
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Oscuro' },
            { value: 'system', label: 'Sistema' },
          ]}
        />
      </Section>

      {me?.role === 'editor' && <Providers />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-strong pt-5">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Providers() {
  const providers = useProviders(true)
  const save = useSaveProvider()
  const required = (v: string) => (v ? null : 'Obligatorio')

  const row = (p: ProviderSetting) => (
    <div key={p.slot} className="grid items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[8rem_1fr_1.4fr]">
      <span className="pt-0.5 text-sm font-medium">{SLOT_LABEL[p.slot]}</span>
      <EditableText
        value={p.provider}
        label={`Proveedor de ${SLOT_LABEL[p.slot].toLowerCase()}`}
        suggestions={KNOWN_PROVIDERS}
        validate={required}
        onSave={(provider) => save.mutateAsync({ ...p, provider })}
      />
      <EditableText
        value={p.model}
        label={`Modelo de ${SLOT_LABEL[p.slot].toLowerCase()}`}
        validate={required}
        mono
        onSave={(model) => save.mutateAsync({ ...p, model })}
      />
    </div>
  )

  return (
    <Section title="Proveedores">
      <div className="glass leaf overflow-hidden">
        <div className="hidden grid-cols-[8rem_1fr_1.4fr] gap-4 border-b border-line bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-4 py-2 text-xs font-semibold text-muted sm:grid">
          <span>Ranura</span>
          <span>Proveedor</span>
          <span>Modelo</span>
        </div>
        {providers.isPending ? <p className="px-3 py-6 text-center text-sm text-muted">Cargando</p> : (providers.data ?? []).map(row)}
      </div>
    </Section>
  )
}
