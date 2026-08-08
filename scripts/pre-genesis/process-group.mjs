export function signalOwnedProcessGroup(
  pid,
  signal,
  ownerHasExited,
  signalProcess = process.kill,
) {
  if (!pid) {
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
