<script setup lang="ts">
const props = withDefaults(defineProps<{
  title?: string
  width?: string
  confirmText?: string
  cancelText?: string
  loading?: boolean
  closeOnClickModal?: boolean
  closeOnEscape?: boolean
}>(), {
  title: '提示',
  width: '480px',
  confirmText: '确定',
  cancelText: '取消',
  loading: false,
  closeOnClickModal: true,
  closeOnEscape: true,
})

const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()

// showModal 提供焦点约束、背景不可交互以及关闭后的焦点恢复。
onMounted(() => {
  watch(visible, (value) => {
    if (value && !dialog.value?.open) dialog.value?.showModal()
    if (!value && dialog.value?.open) dialog.value.close()
  }, { immediate: true, flush: 'post' })
})

function cancel() {
  if (props.loading) return
  visible.value = false
  emit('cancel')
}

function onEscape(event: Event) {
  event.preventDefault()
  if (props.closeOnEscape) cancel()
}

let backdropPointerDown = false

function onBackdropClick(event: MouseEvent) {
  if (backdropPointerDown && event.target === dialog.value && props.closeOnClickModal) cancel()
  backdropPointerDown = false
}

function onClose() {
  // 避免旧的 close 事件覆盖快速重新打开后的状态。
  if (!dialog.value?.open) visible.value = false
}
</script>

<template>
  <dialog
    ref="dialog"
    class="app-dialog"
    :style="{ width }"
    :aria-labelledby="titleId"
    :aria-busy="loading"
    @cancel="onEscape"
    @close="onClose"
    @pointerdown="backdropPointerDown = $event.target === dialog"
    @click="onBackdropClick"
  >
    <div class="app-dialog__panel">
      <header class="app-dialog__header">
        <h2 :id="titleId" class="app-dialog__title">
          <slot name="title">{{ title }}</slot>
        </h2>
        <button type="button" class="app-dialog__close" aria-label="关闭弹窗" :disabled="loading" @click="cancel">
          ×
        </button>
      </header>
      <div class="app-dialog__body"><slot /></div>
      <footer class="app-dialog__footer">
        <slot name="footer" :close="cancel" :loading="loading">
          <button type="button" :disabled="loading" @click="cancel">{{ cancelText }}</button>
          <button type="button" class="app-dialog__confirm" :disabled="loading" @click="emit('confirm')">
            {{ loading ? '处理中…' : confirmText }}
          </button>
        </slot>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.app-dialog {
  max-width: calc(100vw - 32px);
  max-height: calc(100dvh - 48px);
  padding: 0;
  border: 0;
  border-radius: 12px;
  color: #1e293b;
  background: white;
  box-shadow: 0 24px 64px #0f172a33;
}
.app-dialog::backdrop { background: #0f172a80; }
.app-dialog__panel { padding: 24px; }
.app-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.app-dialog__title { margin: 0; font-size: 20px; }
.app-dialog__body { margin: 24px 0; line-height: 1.6; overflow-wrap: anywhere; }
.app-dialog__footer { display: flex; justify-content: flex-end; gap: 12px; }
button { padding: 9px 18px; border: 1px solid #cbd5e1; border-radius: 6px; background: white; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
button:disabled { opacity: .6; cursor: not-allowed; }
.app-dialog__close { padding: 0 6px; border: 0; font-size: 28px; line-height: 1; }
.app-dialog__confirm { background: #2563eb; border-color: #2563eb; color: white; }
</style>
