import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { songs, useTransport } from '../features/playback'
import { useLyrics } from '../features/lyrics'
import { useCapture } from '../features/capture'
import { usePitch } from '../features/pitch'
import { useReview } from '../features/review'
import { useLoopRange } from '../features/practice'
import type { Song, Take } from '../shared/document'

export function useWorkspace() {
  const transport = useTransport(songs[0], {
    beforeSeek: finishCapture, onPause: finishCapture, onLoop: handleLoop,
  })
  const loopRange = useLoopRange(transport.song, transport.isPlaying, computed(() => transport.loop.value !== null))
  const lyrics = useLyrics(transport.song, transport.position)
  const pitch = usePitch()
  const review = useReview(transport.song, lyrics.selected, () => {
    capture.cancelRequest()
    transport.pause()
  }, loopRange.effective)
  const capture = useCapture({
    onFrame: pitch.receive,
    position: transport.read,
    onComplete: async result => {
      await review.save({
        ...result, id: crypto.randomUUID(), createdAt: Date.now(), pitch: pitch.slice(result),
      })
    },
  })
  const graphRange = computed(() => {
    if (review.transition.value === 'playing') return loopRange.context.value
    if (review.position.value !== null || !transport.isPlaying.value || capture.status.value === 'recording') {
      return loopRange.effective.value ?? { start: 0, end: transport.song.value.duration }
    }
    return lyrics.active.value ?? lyrics.upcoming.value ?? lyrics.selected.value!
  })
  const graphPosition = computed(() => review.transitionPosition.value ?? review.position.value ?? transport.position.value)

  /** 循环跳回起点：拖界改动此刻才落到下一遍；播放器由 range 监听器统一同步 */
  function handleLoop() {
    loopRange.commit()
    finishCapture(transport.read())
  }

  // 播放器只认已提交（当前遍）的范围；pending 拖界不会提前影响当前遍
  watch(loopRange.range, value => {
    const current = transport.loop.value
    if (current && (current.start !== value.start || current.end !== value.end)) {
      transport.loop.value = { start: value.start, end: value.end }
    }
  }, { deep: true })

  function finishCapture(position: number): void { void capture.stop(position) }

  function selectLine(id: string) {
    const line = lyrics.select(id)
    if (!line) return
    capture.cancelRequest()
    review.stop()
    loopRange.resetTo(line)
    if (transport.loop.value) transport.loop.value = loopRange.effective.value
    transport.seek(line.start)
  }

  function adjacent(direction: -1 | 1) {
    const line = lyrics.adjacent(direction)
    if (line) selectLine(line.id)
  }

  function selectSong(song: Song) {
    if (song.id === transport.song.value.id) return
    capture.cancelRequest()
    review.stop()
    transport.setSong(song)
    lyrics.reset()
  }

  function seek(position: number) {
    capture.cancelRequest()
    review.stop()
    const loop = transport.loop.value
    if (loop && (position < loop.start || position >= loop.end)) {
      transport.loop.value = null
      loopRange.flush()
    }
    transport.seek(position)
  }

  function toggleLoop() {
    if (transport.loop.value) {
      transport.loop.value = null
      loopRange.flush()
      return
    }
    const line = lyrics.selected.value
    if (!line) return
    loopRange.flush()
    transport.loop.value = loopRange.effective.value
    selectLine(line.id)
  }

  function togglePlay() {
    capture.cancelRequest()
    review.stop()
    if (transport.isPlaying.value) {
      transport.pause()
      loopRange.flush()
    } else void transport.play()
  }

  function toggleRecording() {
    if (capture.status.value === 'recording') {
      finishCapture(transport.read())
      return
    }
    if (capture.status.value === 'requesting') {
      capture.cancelRequest()
      return
    }
    const line = lyrics.selected.value
    if (!line || capture.status.value !== 'idle') return
    review.stop()
    transport.pause()
    loopRange.flush()
    pitch.clear()
    const window = loopRange.effective.value
    void capture.start({ songId: transport.song.value.id, lineId: line.id, range: window }, () => {
      transport.seek(window.start)
      return transport.play()
    })
  }

  function listen(take: Take) { void review.listen(take) }
  function listenTransition() { void review.listenTransition() }

  watch(transport.position, position => {
    const window = loopRange.effective.value
    if (position >= window.end) finishCapture(window.end)
  })

  function handleVisibility() {
    if (!document.hidden) return
    capture.cancelRequest()
    transport.pause()
    loopRange.flush()
  }
  onMounted(() => document.addEventListener('visibilitychange', handleVisibility))
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', handleVisibility))

  return {
    transport, lyrics, pitch, review, capture, loopRange, graphRange, graphPosition,
    selectLine, adjacent, selectSong, seek, toggleLoop, togglePlay, toggleRecording, listen, listenTransition,
  }
}
