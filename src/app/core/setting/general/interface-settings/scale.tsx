'use client'

import { useTranslations } from 'next-intl'
import { SettingPanel } from '../../components/setting-base'
import { ZoomIn } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import useSettingStore from '@/stores/setting'
import { useEffect } from 'react'

const SCALE_OPTIONS = [
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
  { value: 125, label: '125%' },
  { value: 150, label: '150%' },
]

export function ScaleSettings() {
  const t = useTranslations('settings.general.interface')
  const { uiScale, setUiScale } = useSettingStore()

  // 初始化时应用缩放
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}%`
  }, [])

  const handleScaleChange = (value: string) => {
    const scale = parseInt(value)
    setUiScale(scale)
  }

  return (
    <SettingPanel
      title={t('scale.title')}
      desc={t('scale.desc')}
      icon={<ZoomIn className="size-4" />}
    >
      <Select value={uiScale.toString()} onValueChange={handleScaleChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={t('scale.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {SCALE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value.toString()}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingPanel>
  )
}
