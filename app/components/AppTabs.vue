<script setup lang="ts">
export interface AppTabItem {
  value: string | number
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: AppTabItem[]
  ariaLabel?: string
}>(), {
  ariaLabel: '选项卡',
})

const model = defineModel<string | number>()
const emit = defineEmits<{
  change: [value: string | number]
}>()
const id = useId()
const root = useTemplateRef<HTMLElement>('root')
// 未指定值或当前项被移除、禁用时，展示第一个可用项。
const activeValue = computed(() => {
  const current = props.items.find(item => item.value === model.value && !item.disabled)
  return (current ?? props.items.find(item => !item.disabled))?.value
})

function select(item: AppTabItem) {
  if (item.disabled || item.value === activeValue.value) return
  model.value = item.value
  emit('change', item.value)
}

function onKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const enabled = props.items.map((item, i) => item.disabled ? -1 : i).filter(i => i >= 0)
  if (!enabled.length) return
  const position = enabled.indexOf(index)
  const target = event.key === 'Home' ? enabled[0]
    : event.key === 'End' ? enabled[enabled.length - 1]
      : enabled[(position + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
  if (target === undefined) return
  const item = props.items[target]
  if (!item) return
  select(item)
  root.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
}
</script>

<template>
  <div ref="root" class="app-tabs">
    <div class="app-tabs__list" role="tablist" :aria-label="ariaLabel">
      <button
        v-for="(item, index) in items"
        :id="`${id}-tab-${index}`"
        :key="item.value"
        type="button"
        role="tab"
        class="app-tabs__tab"
        :aria-selected="activeValue === item.value"
        :aria-controls="`${id}-panel-${index}`"
        :tabindex="activeValue === item.value ? 0 : -1"
        :disabled="item.disabled"
        @click="select(item)"
        @keydown="onKeydown($event, index)"
      >
        <slot name="label" :item="item" :active="activeValue === item.value">{{ item.label }}</slot>
      </button>
    </div>
    <section
      v-for="(item, index) in items"
      v-show="activeValue === item.value"
      :id="`${id}-panel-${index}`"
      :key="item.value"
      class="app-tabs__panel"
      role="tabpanel"
      :aria-labelledby="`${id}-tab-${index}`"
      tabindex="0"
    >
      <slot :name="`panel-${item.value}`" :item="item" :active="activeValue === item.value">
        <slot :item="item" :active="activeValue === item.value" />
      </slot>
    </section>
  </div>
</template>

<style scoped>
.app-tabs { min-width: 0; width: 100%; }
.app-tabs__list { display: flex; gap: 24px; overflow-x: auto; border-bottom: 1px solid #e2e8f0; }
.app-tabs__tab { flex-shrink: 0; padding: 12px 4px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64748b; font: inherit; cursor: pointer; }
.app-tabs__tab[aria-selected="true"] { border-bottom-color: #2563eb; color: #2563eb; }
.app-tabs__tab:disabled { opacity: .45; cursor: not-allowed; }
.app-tabs__tab:focus-visible { outline: 2px solid #2563eb; outline-offset: -3px; }
.app-tabs__panel { padding: 20px 0; line-height: 1.6; }
.app-tabs__panel:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
</style>
