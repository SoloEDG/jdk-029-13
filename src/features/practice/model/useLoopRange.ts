import { computed, ref, watch, type Ref } from 'vue'
import type { Song, TimeRange } from '../../../shared/document'
import {
  adjustRange, commitPending, contextRange, createRange, linesInRange,
  profileSeam, snapBoundary, type PracticeRange,
} from '../lib/ranges'

export function useLoopRange(song: Ref<Song>, isPlaying: Ref<boolean>, loopOn: Ref<boolean>) {
  const range = ref<PracticeRange>(createRange(song.value.lines[0] ?? { start: 0, end: song.value.duration }, song.value.duration))

  /** 当前遍实际生效的练唱窗口 */
  const effective = computed<TimeRange>(() => range.value.pending ?? range.value)
  const context = computed(() => contextRange(effective.value, song.value.duration))
  const pending = computed(() => range.value.pending)
  const windowLines = computed(() => linesInRange(song.value.lines, effective.value))
  const seam = computed(() => profileSeam(effective.value, song.value))

  watch(song, next => {
    range.value = createRange(next.lines[0] ?? { start: 0, end: next.duration }, next.duration)
  })

  /** 选中歌词句：重置为以整句为默认练唱窗口 */
  function resetTo(line: TimeRange) {
    range.value = createRange(line, song.value.duration)
  }

  /** 拖动边界。循环播放中只登记，下一遍生效；否则立即生效 */
  function drag(patch: Partial<TimeRange>) {
    range.value = adjustRange(range.value, patch, song.value.duration, isPlaying.value && loopOn.value)
  }

  function snap(edge: 'start' | 'end') {
    range.value = snapBoundary(range.value, edge, song.value.duration, song.value.notes, isPlaying.value && loopOn.value)
  }

  /** 循环跳回起点时调用：提交拖界改动 */
  function commit(): TimeRange {
    range.value = commitPending(range.value)
    return range.value
  }

  /** 暂停/停止循环时立即落定 pending */
  function flush() {
    if (range.value.pending) range.value = commitPending(range.value)
  }

  return { range, effective, context, pending, windowLines, seam, resetTo, drag, snap, commit, flush }
}
