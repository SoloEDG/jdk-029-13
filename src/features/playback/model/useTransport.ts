import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Song, TimeRange } from '../../../shared/document'
import { seamGain } from '../../practice/lib/ranges'

interface TransportEvents {
  beforeSeek: (position: number) => void
  onPause: (position: number) => void
  onLoop: (boundary: number) => void
}

export function useTransport(initial: Song, events: TransportEvents) {
  const song = shallowRef(initial)
  const position = ref(0)
  const isPlaying = ref(false)
  const loop = shallowRef<TimeRange | null>(null)
  const volume = ref(0.7)
  const issue = ref('')
  const audio = new Audio(initial.audio)
  audio.preload = 'metadata'
  audio.volume = volume.value
  let render = 0
  let operation = 0
  let context: AudioContext | null = null
  let seam: GainNode | null = null

  /** 用增益节点做接缝混音：保起唱瞬态、让尾音逐渐落下；不支持时退回普通播放 */
  function ensureGraph() {
    if (context) return
    try {
      const ctx = new AudioContext()
      const node = ctx.createGain()
      node.gain.value = 1
      ctx.createMediaElementSource(audio).connect(node).connect(ctx.destination)
      context = ctx
      seam = node
    } catch {
      context = null
      seam = null
    }
  }

  function flatten() {
    if (!context || !seam) return
    seam.gain.cancelScheduledValues(context.currentTime)
    seam.gain.setTargetAtTime(1, context.currentTime, 0.012)
  }

  function applySeam() {
    if (!context || !seam) return
    const range = loop.value
    if (!range || audio.paused) return
    // 指数平滑跟随目标曲线：头部维持增益下限后快速回升，尾部逐步落下
    seam.gain.setTargetAtTime(seamGain(audio.currentTime, range), context.currentTime, 0.02)
  }

  function sync() {
    if (audio.seeking) return
    const next = audio.currentTime
    const range = loop.value
    if (range && !audio.paused && next >= range.end) {
      events.onLoop(range.end)
      audio.currentTime = range.start
      position.value = range.start
      applySeam()
      return
    }
    position.value = next
    applySeam()
  }

  function update() {
    sync()
    if (!audio.paused) render = requestAnimationFrame(update)
  }

  function read() { return audio.currentTime }

  function seek(seconds: number) {
    const time = Math.max(0, Math.min(seconds, song.value.duration))
    events.beforeSeek(read())
    audio.currentTime = time
    position.value = time
    flatten()
  }

  function pause() {
    operation++
    audio.pause()
    isPlaying.value = false
    events.onPause(read())
    cancelAnimationFrame(render)
    flatten()
    sync()
  }

  async function play() {
    if (isPlaying.value) return true
    const current = ++operation
    issue.value = ''
    const range = loop.value
    if (range && (read() < range.start || read() >= range.end)) seek(range.start)
    else if (audio.ended) seek(0)
    try {
      ensureGraph()
      await context?.resume()
      await audio.play()
      if (current !== operation) return false
      isPlaying.value = true
      cancelAnimationFrame(render)
      render = requestAnimationFrame(update)
      applySeam()
      return true
    } catch {
      if (current === operation) issue.value = '伴奏播放失败，请重试。'
      return false
    }
  }

  function setSong(next: Song) {
    pause()
    song.value = next
    loop.value = null
    position.value = 0
    issue.value = ''
    audio.src = next.audio
    audio.load()
  }

  function setVolume(next: number) {
    volume.value = Math.min(1, Math.max(0, next))
    audio.volume = volume.value
  }

  function handleEnd() { pause() }
  function handleError() {
    pause()
    issue.value = '无法读取伴奏。'
  }
  audio.addEventListener('timeupdate', sync)
  audio.addEventListener('ended', handleEnd)
  audio.addEventListener('error', handleError)
  watch(loop, value => { if (!value) flatten() })
  onBeforeUnmount(() => {
    pause()
    audio.removeEventListener('timeupdate', sync)
    audio.removeEventListener('ended', handleEnd)
    audio.removeEventListener('error', handleError)
    audio.removeAttribute('src')
    audio.load()
    void context?.close()
  })

  const progress = computed(() => position.value / song.value.duration)
  return { song, position, progress, loop, isPlaying, volume, issue, read, seek, play, pause, setSong, setVolume }
}
