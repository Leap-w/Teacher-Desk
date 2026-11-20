import { ref } from 'vue'

/** Browser hooks are injected so the state machine can be tested without a DOM. */
export interface FullscreenDeps {
  isFullscreenElement: () => boolean
  requestFullscreen: () => Promise<void>
  exitFullscreen: () => Promise<void>
  lockOrientation: () => Promise<void>
  unlockOrientation: () => void
  setBodyLock: (locked: boolean) => void
}

/**
 * One fullscreen session with re-entrancy guards.
 * Native fullscreen is optional: if it fails, the in-page overlay still works.
 */
export function useFullscreenSession(deps: FullscreenDeps) {
  const active = ref(false)
  const lockFailed = ref(false)
  let entering = false
  let exiting = false
  let generation = 0

  async function enter() {
    if (active.value || entering || exiting) return
    entering = true
    const token = ++generation
    active.value = true
    lockFailed.value = false
    deps.setBodyLock(true)

    try {
      await deps.requestFullscreen()
    } catch {
      /* overlay falls back when native fullscreen is refused */
    } finally {
      entering = false
    }

    // User may have exited while the native request was pending.
    if (token !== generation || !active.value) {
      // A cancelled request can still enter native fullscreen after the exit.
      // Clean it up, otherwise the button state and the browser disagree.
      if (!active.value && deps.isFullscreenElement()) {
        try {
          await deps.exitFullscreen()
        } catch {
          /* already exited */
        }
      }
      return
    }

    try {
      await deps.lockOrientation()
      if (token === generation) lockFailed.value = false
    } catch {
      if (token === generation) lockFailed.value = true
    }
  }

  function finish() {
    generation++
    entering = false
    if (!active.value) return false
    active.value = false
    deps.setBodyLock(false)
    try {
      deps.unlockOrientation()
    } catch {
      /* unlock is optional */
    }
    return true
  }

  async function exit() {
    if ((!active.value && !entering) || exiting) return
    exiting = true
    finish()
    if (deps.isFullscreenElement()) {
      try {
        await deps.exitFullscreen()
      } catch {
        /* already exited */
      }
    }
    exiting = false
  }

  function onChange() {
    if (!deps.isFullscreenElement()) finish()
  }

  function onEscape() {
    if (active.value) void exit()
  }

  return { active, lockFailed, enter, exit, finish, onChange, onEscape }
}
