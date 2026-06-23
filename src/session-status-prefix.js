import { tool } from "@opencode-ai/plugin"

const STATUSES = new Set(["pending", "process", "pushed", "done", "closed", "stoped"])
const PREFIX_RE = /^\[(pending|process|pushed|done|closed|stoped)\]\s*/i
const TERMINAL_HOLDS = new Set(["pending", "pushed", "closed", "stoped"])
const DEFAULT_TITLE_RE = /^new session(?:\s*[-:]\s*.*)?$/i

function normalizeStatus(value) {
  const status = String(value ?? "").trim().toLowerCase()
  if (!STATUSES.has(status)) {
    throw new Error(`Unknown session status "${value}". Use one of: ${[...STATUSES].join(", ")}`)
  }
  return status
}

function stripPrefix(title) {
  return String(title ?? "").replace(PREFIX_RE, "").trim()
}

function isUsableBaseTitle(title) {
  const base = stripPrefix(title)
  return base.length > 0 && !DEFAULT_TITLE_RE.test(base)
}

function titleWithPrefix(status, title, fallbackTitle) {
  const base = isUsableBaseTitle(title) ? stripPrefix(title) : stripPrefix(fallbackTitle)
  if (!base) return null
  return `[${status}] ${base}`
}

function eventSessionID(event) {
  const properties = event?.properties
  if (typeof properties?.session?.id === "string" && properties.session.id.length > 0) return properties.session.id
  if (typeof properties?.session?.sessionID === "string" && properties.session.sessionID.length > 0) {
    return properties.session.sessionID
  }
  return typeof properties?.sessionID === "string" && properties.sessionID.length > 0 ? properties.sessionID : null
}

function eventStatusType(event) {
  const properties = event?.properties
  const value = properties?.status ?? properties?.type
  if (typeof value === "string") return value
  if (value && typeof value.type === "string") return value.type
  return null
}

function eventTitle(event) {
  const properties = event?.properties
  const value = properties?.info?.title ?? properties?.session?.title ?? properties?.title
  return typeof value === "string" ? value : null
}

function prefixStatus(title) {
  const match = String(title ?? "").match(PREFIX_RE)
  return match ? match[1].toLowerCase() : null
}

function eventErrorText(event) {
  const properties = event?.properties
  const error = properties?.error
  const parts = [
    error?.name,
    error?.message,
    properties?.name,
    properties?.message,
    event?.type,
  ]
  return parts.filter(Boolean).join(" ").toLowerCase()
}

function isStopEvent(event) {
  const text = eventErrorText(event)
  return (
    event?.type === "session.aborted" ||
    event?.type === "session.cancelled" ||
    event?.type === "session.interrupted" ||
    text.includes("messageabortederror") ||
    text.includes("aborted") ||
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("interrupted")
  )
}

function isSuccessfulGitPush(input, output) {
  if (input?.tool !== "bash") return false
  const command = String(input?.args?.command ?? output?.args?.command ?? "").trim()
  if (!/(^|[;&|]\s*)git\s+push(\s|$)/.test(command)) return false
  const exit = output?.metadata?.exit ?? output?.exit
  return exit === undefined || exit === 0
}

export const SessionStatusPrefixPlugin = async ({ client }) => {
  const holds = new Map()
  const desired = new Map()
  const lastBaseTitle = new Map()

  async function log(level, message, extra) {
    try {
      await client.app.log({
        body: {
          service: "session-status-prefix",
          level,
          message,
          extra,
        },
      })
    } catch {
      // Logging must never break user work.
    }
  }

  async function setStatus(sessionID, rawStatus, options = {}) {
    if (typeof sessionID !== "string" || sessionID.length === 0) return null

    const status = normalizeStatus(rawStatus)
    const session = await client.session.get({ path: { id: sessionID } })
    const sourceTitle = options.title ? String(options.title) : session.title
    const baseTitle = stripPrefix(sourceTitle)
    if (isUsableBaseTitle(baseTitle)) {
      lastBaseTitle.set(sessionID, baseTitle)
    }

    desired.set(sessionID, status)
    if (options.hold ?? TERMINAL_HOLDS.has(status)) {
      holds.set(sessionID, status)
    } else {
      holds.delete(sessionID)
    }

    const nextTitle = titleWithPrefix(status, sourceTitle, lastBaseTitle.get(sessionID))
    if (!nextTitle) {
      await log("info", "session status prefix delayed until session title exists", {
        sessionID,
        status,
        currentTitle: session.title,
        reason: options.reason,
      })
      return null
    }

    if (session.title !== nextTitle) {
      await client.session.update({
        path: { id: sessionID },
        body: { title: nextTitle },
      })
    }

    await log("info", "session status prefix updated", {
      sessionID,
      status,
      title: nextTitle,
      reason: options.reason,
    })

    return nextTitle
  }

  async function handleSessionUpdated(sessionID, event) {
    const updatedTitle = eventTitle(event)
    const updatedStatus = prefixStatus(updatedTitle)

    if (updatedStatus) {
      desired.set(sessionID, updatedStatus)
    }

    if (isUsableBaseTitle(updatedTitle)) {
      lastBaseTitle.set(sessionID, stripPrefix(updatedTitle))
    }

    const status = desired.get(sessionID)
    if (!status) return null

    return setStatus(sessionID, status, {
      title: updatedTitle ?? undefined,
      hold: holds.has(sessionID) || TERMINAL_HOLDS.has(status),
      reason: "session.updated",
    })
  }

  async function setProcess(sessionID, reason) {
    holds.delete(sessionID)
    return setStatus(sessionID, "process", { hold: false, reason })
  }

  async function setDoneIfAllowed(sessionID, reason) {
    if (holds.has(sessionID)) return null
    return setStatus(sessionID, "done", { hold: false, reason })
  }

  async function setPending(sessionID, reason) {
    return setStatus(sessionID, "pending", { hold: true, reason })
  }

  async function setStoped(sessionID, reason) {
    return setStatus(sessionID, "stoped", { hold: true, reason })
  }

  return {
    event: async ({ event }) => {
      try {
        const sessionID = eventSessionID(event)
        if (!sessionID) return

        if (event.type === "session.status") {
          const status = eventStatusType(event)
          if (status === "busy" || status === "retry") {
            await setProcess(sessionID, "session.status")
          } else if (status === "idle") {
            await setDoneIfAllowed(sessionID, "session.status")
          }
          return
        }

        if (event.type === "session.idle") {
          await setDoneIfAllowed(sessionID, "session.idle")
          return
        }

        if (event.type === "session.updated") {
          await handleSessionUpdated(sessionID, event)
          return
        }

        if (
          event.type === "session.aborted" ||
          event.type === "session.cancelled" ||
          event.type === "session.interrupted" ||
          (event.type === "session.error" && isStopEvent(event))
        ) {
          await setStoped(sessionID, event.type)
          return
        }

        if (event.type === "permission.asked" || event.type === "question.asked" || event.type === "session.error") {
          await setPending(sessionID, event.type)
          return
        }

        if (event.type === "permission.replied" || event.type === "question.replied" || event.type === "question.rejected") {
          await setProcess(sessionID, event.type)
        }
      } catch (error) {
        await log("error", "event handler failed", {
          event: event?.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        if (!isSuccessfulGitPush(input, output)) return
        await setStatus(input.sessionID, "pushed", { hold: true, reason: "git.push" })
      } catch (error) {
        await log("error", "git push status update failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    tool: {
      session_status_prefix: tool({
        description:
          "Update the current OpenCode session title prefix. Use status: pending, process, pushed, done, closed, or stoped. This preserves the existing title after the prefix.",
        args: {
          status: tool.schema
            .string()
            .describe("One of: pending, process, pushed, done, closed, stoped."),
          title: tool.schema
            .string()
            .optional()
            .describe("Optional replacement title text after the status prefix. Usually omit this to preserve the existing title."),
        },
        async execute(args, context) {
          const status = normalizeStatus(args.status)
          const nextTitle = await setStatus(context.sessionID, status, {
            title: args.title,
            hold: TERMINAL_HOLDS.has(status),
            reason: "tool",
          })
          return `Session title prefix set to [${status}]${nextTitle ? `: ${nextTitle}` : ""}`
        },
      }),
    },
  }
}
