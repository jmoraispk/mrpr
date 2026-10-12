const SECRET_PREFIX = 'gloas-'
const APPLICATION_ID = /^[0-9a-f]{64}$/

/** Checks what was pasted as an Application ID, catching the Secret. */
export function validateApplicationId(
  value: string,
): { ok: true; clientId: string } | { ok: false; message: string } {
  const text = value.trim()
  if (text.startsWith(SECRET_PREFIX)) {
    return { ok: false, message: "That's the Secret. Copy the Application ID above it." }
  }
  const clientId = text.toLowerCase()
  return APPLICATION_ID.test(clientId)
    ? { ok: true, clientId }
    : {
        ok: false,
        message:
          'An Application ID is 64 letters and digits. Copy it from the top of the page GitLab showed after you saved.',
      }
}
