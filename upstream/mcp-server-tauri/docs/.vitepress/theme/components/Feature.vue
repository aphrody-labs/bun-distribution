<template>
   <div class="feature-card">
      <div class="feature-icon">
         <component :is="iconComponent" :size="24" :stroke-width="2" />
      </div>
      <h3 class="feature-title">{{ title }}</h3>
      <p class="feature-details">{{ details }}</p>
   </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
   Terminal,
   FileJson,
   Smartphone,
   MousePointer,
   Bug,
   Plug,
   Camera,
} from 'lucide-vue-next';

interface Props {
   icon: string;
   title: string;
   details: string;
}

const props = defineProps<Props>();

const iconMap: Record<string, unknown> = {
   terminal: Terminal,
   'file-json': FileJson,
   smartphone: Smartphone,
   'mouse-pointer': MousePointer,
   bug: Bug,
   plug: Plug,
   camera: Camera,
};

const iconComponent = computed(() => { return iconMap[props.icon] || Terminal; });
</script>

<style scoped>
.feature-card {
   background: var(--vp-c-bg-soft);
   border: 1px solid var(--vp-c-border);
   border-radius: 12px;
   padding: 24px;
   transition: all 0.25s ease;
   box-shadow: var(--vp-shadow-2);
   height: 100%;
   display: flex;
   flex-direction: column;
}

.feature-card:hover {
   transform: translateY(-4px);
   box-shadow: var(--vp-shadow-3);
   border-color: var(--vp-c-brand-1);
}

.feature-icon {
   width: 48px;
   height: 48px;
   background: linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%);
   border-radius: 8px;
   display: flex;
   align-items: center;
   justify-content: center;
   margin-bottom: 16px;
   box-shadow: 0 4px 6px rgba(14, 165, 233, 0.2);
   color: white;
}

.feature-title {
   font-size: 1.125rem;
   font-weight: 600;
   color: var(--vp-c-text-1);
   margin-bottom: 8px;
   line-height: 1.4;
   margin-top: 0;
}

.feature-details {
   font-size: 0.9375rem;
   color: var(--vp-c-text-2);
   line-height: 1.6;
   margin: 0;
   flex-grow: 1;
}
</style>
