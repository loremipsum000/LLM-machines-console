export function signalOwnedProcessGroup(
  pid,
  signal,
  ownerHasExited,
  signalProcess = process.kill,
) {
  if (!pid || ownerHasExited()) {
    return false
  }
  try {
    signalProcess(-pid, signal)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false
    }
    if (error?.code === "EPERM" && ownerHasExited()) {
      return false
    }
    throw error
  }
}

export async function terminateProcessGroup(
  pid,
  {
    forceWaitMilliseconds = 5_000,
    graceMilliseconds = 10_000,
    pollMilliseconds = 50,
    signalProcess = process.kill,
  } = {},
) {
  if (!pid) return true
  signalProcessGroup(pid, "SIGTERM", signalProcess)
  if (
    await waitForProcessGroupRemoval(pid, graceMilliseconds, {
      pollMilliseconds,
      signalProcess,
    })
  ) {
    return true
  }
  signalProcessGroup(pid, "SIGKILL", signalProcess)
  return waitForProcessGroupRemoval(pid, forceWaitMilliseconds, {
    pollMilliseconds,
    signalProcess,
  })
}

export async function waitForProcessGroupRemoval(
  pid,
  timeoutMilliseconds,
  { pollMilliseconds = 50, signalProcess = process.kill } = {},
) {
  const deadline = performance.now() + timeoutMilliseconds
  while (performance.now() < deadline) {
    if (!processGroupExists(pid, signalProcess)) return true
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, pollMilliseconds),
    )
  }
  return !processGroupExists(pid, signalProcess)
}

function processGroupExists(pid, signalProcess) {
  try {
    signalProcess(-pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    if (error?.code === "EPERM") return true
    throw error
  }
}

function signalProcessGroup(pid, signal, signalProcess) {
  try {
    signalProcess(-pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}
