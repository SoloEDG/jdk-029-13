import type { GuideNote, LyricLine, TimeRange } from '../../../shared/document'
import { within } from '../../../shared/time'

/** 聆听上下文单侧时长（秒）：只用来听，不参与循环和录音 */
export const CONTEXT_PAD = 1.2
/** 头部保护时长（秒）：起唱瞬态不被淡入压掉 */
export const HEAD_KEEP = 0.06
/** 尾音开始淡出的时长（秒） */
export const TAIL_FADE = 0.5
/** 找不到明确听感分界时，给出的调整步长（秒） */
export const BOUNDARY_STEP = 0.1
/** 练唱窗口最小长度（秒） */
export const MIN_WINDOW = 0.4

export interface PracticeRange extends TimeRange {
  /** 下一遍生效的拖界修改；为空表示当前遍即此范围 */
  pending: TimeRange | null
}

export interface SeamProfile {
  /** 循环点两侧是否相邻同音（两遍听感像一整遍） */
  unison: boolean
  /** 相邻两个参考音的音分差，同音为 0；找不到参考音为 null */
  cents: number | null
  /** 下一遍起唱是否为轻辅音/弱起 */
  softHead: boolean
  /** 前一遍尾音与下一遍起音是否不同调（尾音可能盖住轻辅音） */
  keyMismatch: boolean
  /** 循环点两侧的间缝时长（秒） */
  gap: number
  /** 两侧上下文里都落在拍点上，疑似共用鼓点/打击音 */
  sharedPercussion: boolean
  /** 提示用户调整范围的建议 */
  advice: string
}

export function clampRange(range: TimeRange, duration: number): TimeRange {
  const end = Math.min(Math.max(range.end, MIN_WINDOW), duration)
  const cappedStart = Math.max(0, Math.min(range.start, end - MIN_WINDOW))
  // 起点超出歌曲尾部时整体向左拉，保证窗口始终满足最小长度
  const start = Math.min(cappedStart, Math.max(0, duration - MIN_WINDOW))
  const safeEnd = end - start < MIN_WINDOW - 1e-9 ? Math.min(duration, start + MIN_WINDOW) : end
  return { start, end: safeEnd }
}

export function createRange(line: TimeRange, duration: number): PracticeRange {
  return { ...clampRange(line, duration), pending: null }
}

/** 正在循环播放时拖动边界：改动先记为 pending，下一遍生效 */
export function adjustRange(range: PracticeRange, patch: Partial<TimeRange>, duration: number, live: boolean): PracticeRange {
  // 连续拖动时要在已登记的 pending 上叠加，而不是回到已提交范围
  const base = range.pending ?? range
  const next = clampRange({ start: patch.start ?? base.start, end: patch.end ?? base.end }, duration)
  return live ? { ...range, pending: next } : { ...next, pending: null }
}

/** 下一遍开始时提交 pending，返回是否真的发生了改动 */
export function commitPending(range: PracticeRange): PracticeRange {
  if (!range.pending) return range
  return { start: range.pending.start, end: range.pending.end, pending: null }
}

/** 只用来听的上下文：包住窗口两侧的延音与弱起，不录音、不循环 */
export function contextRange(range: TimeRange, duration: number): TimeRange {
  return {
    start: Math.max(0, range.start - CONTEXT_PAD),
    end: Math.min(duration, range.end + CONTEXT_PAD),
  }
}

export function linesInRange(lines: readonly LyricLine[], range: TimeRange): LyricLine[] {
  return lines.filter(line => line.end > range.start && line.start < range.end)
}

/** 只把练唱窗口内的人声归到该遍：与窗口无时间交集的录音不计入 */
export function takeInWindow(take: { songId: string; start: number; end: number }, songId: string, range: TimeRange): boolean {
  return take.songId === songId && take.start < range.end && take.end > range.start
}

export function notesInRange(notes: readonly GuideNote[], range: TimeRange): GuideNote[] {
  return notes.filter(note => note.end > range.start && note.start < range.end)
}

function noteAt(notes: readonly GuideNote[], time: number): GuideNote | undefined {
  return notes.find(note => within(note, time)) ?? notes.find(note => Math.abs(note.start - time) < 0.35)
}

/** 把边界吸附到最近的参考音起止点；live=true 时下一遍生效 */
export function snapBoundary(range: PracticeRange, edge: 'start' | 'end', duration: number, notes: readonly GuideNote[], live: boolean): PracticeRange {
  const base = range.pending ?? range
  const candidates = notes.flatMap(note => [note.start, note.end]).filter(time => time >= 0 && time <= duration)
  const current = edge === 'start' ? base.start : base.end
  const nearest = candidates.reduce((best, time) =>
    Math.abs(time - current) < Math.abs(best - current) ? time : best, candidates[0] ?? current)
  return adjustRange(range, { [edge]: nearest }, duration, live)
}

/** 按 BPM 推算覆盖时段的拍点；鼓点一般落在拍上 */
export function beatTimes(bpm: number, from: number, to: number): number[] {
  const period = 60 / bpm
  const first = Math.ceil(from / period - 1e-6) * period
  const beats: number[] = []
  for (let time = first; time <= to + 1e-6; time += period) {
    if (time >= from - 1e-6 && time <= to + 1e-6) beats.push(Number(time.toFixed(4)))
  }
  return beats
}

function hasBeatNear(bpm: number, from: number, to: number): boolean {
  return beatTimes(bpm, from, to).length > 0
}

function headIsSoft(lines: readonly LyricLine[], start: number): boolean {
  const line = lines.find(entry => Math.abs(entry.start - start) <= CONTEXT_PAD) ?? lines.find(entry => within(entry, start))
  return Boolean(line?.softStart)
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export function midiName(midi: number): string {
  const rounded = Math.round(midi)
  return NOTE_NAMES[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1)
}

/**
 * 分析循环接缝的可听性。上下文在歌曲时间上可以不相交，
 * 这里只比较参考音、歌词与拍点，不依赖两段音频实际重叠。
 */
export function profileSeam(range: TimeRange, song: { bpm: number; lines: readonly LyricLine[]; notes: readonly GuideNote[] }): SeamProfile {
  const tailNote = [...song.notes].reverse().find(note => note.start < range.start && note.end <= range.end + 0.05)
    ?? noteAt(song.notes, Math.max(range.start, range.end - 0.5))
  const headNote = noteAt(song.notes, range.start) ?? song.notes.find(note => note.start >= range.start)
  const cents = tailNote && headNote ? Math.round((headNote.midi - tailNote.midi) * 100) : null
  const unison = cents === 0
  const softHead = headIsSoft(song.lines, range.start)
  const keyMismatch = cents !== null && cents !== 0
  const gap = headNote && tailNote ? Math.max(0, headNote.start - tailNote.end) : 0
  const sharedPercussion = hasBeatNear(song.bpm, range.end - CONTEXT_PAD, range.end)
    && hasBeatNear(song.bpm, range.start, range.start + CONTEXT_PAD)

  const tips: string[] = []
  if (unison) tips.push('接缝两侧是相邻同音，两遍会像一整遍，注意保持气息连贯。')
  if (keyMismatch && softHead) {
    tips.push(`前一遍尾音 ${tailNote ? midiName(tailNote.midi) : ''} 与下一遍 ${headNote ? midiName(headNote.midi) : ''} 不同调，尾音延音会盖住弱起的轻辅音；把起点左移 ${BOUNDARY_STEP.toFixed(1)} 秒保住起唱，或把终点提前到尾音发声之前。`)
  } else if (keyMismatch) {
    tips.push('接缝两侧不同调，尾音淡出后再起唱更干净，可把终点略向前调。')
  } else if (softHead) {
    tips.push('下一遍是轻辅音弱起，起点要盖住起唱瞬态，建议向左微调。')
  }
  if (sharedPercussion) tips.push('两侧上下文都落在拍点上（疑似同一鼓点），循环时鼓点会重复敲响，接缝尽量避开拍点。')
  if (tips.length === 0) tips.push(`没找到明确的可听交界，试着把起点或终点按 ${BOUNDARY_STEP.toFixed(1)} 秒微调，直到听到自然的换气口。`)

  return { unison, cents, softHead, keyMismatch, gap, sharedPercussion, advice: tips.join('') }
}

/**
 * 循环播放时的目标增益（纯函数，便于核对）：
 * - 头部保护期维持增益下限，起唱瞬态（含轻辅音）不被压掉
 * - 随后快速回到满电平
 * - 尾部 TAIL_FADE 内逐渐落下，让前一遍延音自然收尾
 */
export function seamGain(position: number, range: TimeRange): number {
  const offset = position - range.start
  const span = range.end - range.start
  if (offset < 0 || offset > span) return 1
  // 头部保护期保持增益下限：起唱瞬态（含轻辅音）完整可闻，不做淡入
  if (offset < HEAD_KEEP) return 0.55
  if (offset < HEAD_KEEP * 3) {
    const progress = (offset - HEAD_KEEP) / (HEAD_KEEP * 2)
    return 0.55 + 0.45 * progress
  }
  if (offset > span - TAIL_FADE) {
    const progress = (offset - (span - TAIL_FADE)) / TAIL_FADE
    return Math.max(0.12, 1 - 0.88 * progress)
  }
  return 1
}
