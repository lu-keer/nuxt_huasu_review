<script setup lang="ts">
const visible = ref(false)
const loading = ref(false)
const message = ref('点击按钮，体验公共弹窗。')
const activeTab = ref<string | number>('overview')
const tabs = [
  { value: 'overview', label: '项目概览' },
  { value: 'details', label: '详细信息' },
  { value: 'settings', label: '设置', disabled: true },
]

async function confirm() {
  if (loading.value) return
  loading.value = true
  try {
    // 模拟异步提交；业务中可替换为接口请求。
    await new Promise(resolve => setTimeout(resolve, 800))
    visible.value = false
    message.value = '提交成功。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="demo">
    <div>
      <NuxtWelcome />
    </div>
  
    <div style="display: flex; flex-direction: column; justify-content: center; gap: 16px;">
      <h2>公共弹窗示例</h2>
      <div>
        <button type="button" class="demo__open" @click="visible = true">打开弹窗</button>
        <p role="status">{{ message }}</p>
      </div>
      <section>
        <h2>公共选项卡示例</h2>
        <AppTabs v-model="activeTab" :items="tabs" aria-label="项目信息">
          <template #panel-overview>
            <h3>项目概览</h3>
            <p>通过 v-model 绑定当前选项，使用具名插槽自定义各项内容。</p>
          </template>
          <template #panel-details>
            <h3>详细信息</h3>
            <p>支持点击或使用左右方向键、Home、End 切换，禁用项会自动跳过。</p>
          </template>
        </AppTabs>
        <p>当前选项：{{ activeTab }}</p>
      </section>
    </div>

    <AppDialog
      v-model="visible"
      title="提交确认"
      confirm-text="确认提交"
      :loading="loading"
      @confirm="confirm"
      @cancel="message = '已取消提交。'"
    >
      <p>确定提交当前内容吗？确认后将模拟一次异步请求。</p>
      <p>你可以点击取消、右上角关闭按钮、遮罩，或按 Esc 关闭弹窗。</p>
    </AppDialog>

  </main>
</template>

<style scoped>
.demo {
  max-width: 1400px; margin: 0 auto; padding: 0 24px; color: #1e293b; font-family: system-ui, sans-serif;
  display: flex;
  gap: 56px;
}
.demo > div { flex: 1; }
.demo p { line-height: 1.6; }
.demo__open { padding: 10px 20px; border: 0; border-radius: 6px; background: #2563eb; color: white; font: inherit; cursor: pointer; }
.demo__open:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
</style>
