<script setup lang="ts">
import { computed, ref } from 'vue'
import { Headphones, Magnet, Scissors, TriangleAlert } from '@lucide/vue'
import type { LyricLine, TimeRange } from '../../../shared/document'
import { clockLabel } from '../../../shared/time'
import type { SeamProfile } from '../lib/ranges'

const props = defineProps<{
  duration: number
  effective: TimeRange
  pendingRange: TimeRange | null
  context: TimeRange
  seam: SeamProfile
  lines: LyricLine[]
}>()
const emit = defineEmits<{ drag: [Partial<TimeRange>]; snap: ['start' | 'end'] }>()
const track = ref<HTMLElement | null>(null)

/** 拖动中的下一遍范围优先显示；未拖动时显示当前遍 */
const displayed = computed<TimeRange>(() => props.pendingRange ?? props.effective)

const pct = (time: number) => `${Math.min(100, Math.max(0, time / props.duration * 100))}%`
const band = (range: TimeRange) => ({ left: pct(range.start), width: pct(range.end - range.start) })

function timeFromEvent(event: PointerEvent) {
  const rect = track.value!.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  return Number((ratio * props.duration).toFixed(3))
}

function beginDrag(edge: 'start' | 'end') {
  return (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => emit('drag', { [edge]: timeFromEvent(next) })
    const up = (next: PointerEvent) => {
      handle.releasePointerCapture(next.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}
</script>

<template>
  <section class="range-editor" aria-labelledby="range-title">
    <div class="panel-heading range-heading">
      <Scissors :size="17" />
      <h2 id="range-title">练唱范围（可跨句拖界）</h2>
      <span v-if="pendingRange" class="pending-badge">拖界下一遍生效</span>
    </div>

    <div ref="track" class="range-track">
      <div class="context-band" :style="band(context)"><Headphones :size="12" /> 聆听上下文</div>
      <div v-if="pendingRange" class="window-band current" :style="band(effective)"></div>
      <div class="window-band" :class="{ pending: pendingRange }" :style="band(displayed)"></div>
      <button class="range-handle start" :style="{ left: pct(displayed.start) }" aria-label="拖动练唱起点"
        @pointerdown="beginDrag('start')($event)"></button>
      <button class="range-handle end" :style="{ left: pct(displayed.end) }" aria-label="拖动练唱终点"
        @pointerdown="beginDrag('end')($event)"></button>
    </div>

    <div class="range-fields">
      <label v-for="edge in (['start', 'end'] as const)" :key="edge" class="range-field">
        <span>{{ edge === 'start' ? '起' : '终' }}</span>
        <input type="range" min="0" :max="duration" step="0.01" :value="displayed[edge]"
          :aria-label="edge === 'start' ? '练唱起点' : '练唱终点'"
          :style="{ '--fill': `${displayed[edge] / duration * 100}%` }"
          @input="emit('drag', { [edge]: Number(($event.target as HTMLInputElement).value) })" />
        <button class="snap-button" :title="`把${edge === 'start' ? '起点' : '终点'}吸附到参考音`"
          @click="emit('snap', edge)"><Magnet :size="13" /></button>
        <strong class="mono">{{ clockLabel(displayed[edge], true) }}</strong>
      </label>
    </div>

    <p v-if="pendingRange" class="pending-note mono">
      下一遍：{{ clockLabel(pendingRange.start, true) }} – {{ clockLabel(pendingRange.end, true) }}
    </p>

    <ul class="seam-chips">
      <li v-if="seam.unison" class="chip">相邻同音 · 两遍像一整遍</li>
      <li v-if="seam.keyMismatch && seam.softHead" class="chip warn"><TriangleAlert :size="13" /> 不同调尾音会盖住轻辅音</li>
      <li v-else-if="seam.softHead" class="chip warn">轻辅音弱起 · 保住起唱瞬态</li>
      <li v-if="seam.sharedPercussion" class="chip warn">两侧上下文同拍点 · 鼓点会重复</li>
      <li v-if="seam.gap > 0" class="chip">接缝间缝 {{ seam.gap.toFixed(2) }} 秒</li>
    </ul>
    <p class="seam-advice" role="status">{{ seam.advice }}</p>

    <div class="window-lines">
      <small>窗口内歌词 · 跨 {{ lines.length }} 句</small>
      <p v-for="line in lines" :key="line.id" class="window-line">
        <span class="mono">{{ clockLabel(line.start, true) }}</span>{{ line.text }}
      </p>
    </div>
  </section>
</template>
