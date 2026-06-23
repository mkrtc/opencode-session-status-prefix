#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_RAW_BASE = "https://raw.githubusercontent.com/mkrtc/opencode-session-status-prefix/main"
const PLUGIN_SOURCE = "src/session-status-prefix.js"
const INSTRUCTIONS_SOURCE = "session-status-prefix.instructions.md"
const PLUGIN_TARGET_NAME = "session-status-prefix.mjs"
const INSTRUCTIONS_TARGET_NAME = "session-status-prefix.instructions.md"
const DEFAULT_PLUGIN_DEP = "^1.17.9"

const args = new Set(process.argv.slice(2))

function valueArg(name) {
  const prefix = `${name}=`
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}

function defaultConfigDir() {
  const explicit = valueArg("--config-dir") || process.env.OPENCODE_CONFIG_DIR
  if (explicit) return path.resolve(explicit)

  if (process.platform === "win32") {
    return path.join(process.env.USERPROFILE || os.homedir(), ".config", "opencode")
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
}

function stripJsonComments(input) {
  let output = ""
  let inString = false
  let quote = ""
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    const next = input[i + 1]

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false
        output += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        i += 1
      }
      continue
    }

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        inString = false
      }
      continue
    }

    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      inLineComment = true
      i += 1
      continue
    }

    if (char === "/" && next === "*") {
      inBlockComment = true
      i += 1
      continue
    }

    output += char
  }

  return output
}

async function readJsonc(file, fallback) {
  if (!existsSync(file)) return fallback
  const text = await readFile(file, "utf8")
  return JSON.parse(stripJsonComments(text))
}

async function writeJsonWithBackup(file, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`
  const previous = existsSync(file) ? await readFile(file, "utf8") : null
  if (previous === next) return false

  if (previous !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await writeFile(`${file}.bak.${stamp}`, previous)
  }

  await writeFile(file, next)
  return true
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value)
  return list
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          httpGet(response.headers.location).then(resolve, reject)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} while fetching ${url}`))
          response.resume()
          return
        }

        let body = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          body += chunk
        })
        response.on("end", () => resolve(body))
      })
      .on("error", reject)
  })
}

function localSourcePath(relativePath) {
  try {
    const scriptPath = fileURLToPath(import.meta.url)
    const scriptDir = path.dirname(scriptPath)
    const candidates = [
      path.join(scriptDir, relativePath),
      path.join(scriptDir, "..", relativePath),
    ]
    return candidates.find((candidate) => existsSync(candidate)) || null
  } catch {
    return null
  }
}

async function installSource(relativePath, targetPath) {
  const local = localSourcePath(relativePath)
  if (local) {
    await copyFile(local, targetPath)
    return `copied ${relativePath}`
  }

  const text = await httpGet(`${REPO_RAW_BASE}/${relativePath}`)
  await writeFile(targetPath, text)
  return `downloaded ${relativePath}`
}

function detectOpenCodeVersion() {
  const result = spawnSync("opencode", ["--version"], { encoding: "utf8" })
  if (result.status !== 0) return null
  const version = `${result.stdout}${result.stderr}`.match(/\d+\.\d+\.\d+/)?.[0]
  return version || null
}

async function updatePackageJson(configDir) {
  const packagePath = path.join(configDir, "package.json")
  const packageJson = await readJsonc(packagePath, {})
  packageJson.dependencies = packageJson.dependencies && typeof packageJson.dependencies === "object"
    ? packageJson.dependencies
    : {}
  packageJson.dependencies["@opencode-ai/plugin"] = detectOpenCodeVersion() || DEFAULT_PLUGIN_DEP
  await writeJsonWithBackup(packagePath, packageJson)
  return packagePath
}

function runNpmInstall(configDir) {
  if (args.has("--skip-install")) return

  const result = spawnSync("npm", ["install", "--prefix", configDir, "--no-package-lock"], {
    stdio: "inherit",
  })

  if (result.error) {
    console.warn(`[warn] npm install was skipped: ${result.error.message}`)
  } else if (result.status !== 0) {
    console.warn("[warn] npm install failed. OpenCode may still install plugin dependencies on restart.")
  }
}

async function main() {
  const configDir = defaultConfigDir()
  const pluginsDir = path.join(configDir, "plugins")
  const pluginPath = path.join(pluginsDir, PLUGIN_TARGET_NAME)
  const instructionsPath = path.join(configDir, INSTRUCTIONS_TARGET_NAME)
  const configPath = process.env.OPENCODE_CONFIG
    ? path.resolve(process.env.OPENCODE_CONFIG)
    : existsSync(path.join(configDir, "opencode.json"))
      ? path.join(configDir, "opencode.json")
      : path.join(configDir, "opencode.jsonc")

  await mkdir(pluginsDir, { recursive: true })

  const pluginInstall = await installSource(PLUGIN_SOURCE, pluginPath)
  const instructionsInstall = await installSource(INSTRUCTIONS_SOURCE, instructionsPath)

  const config = await readJsonc(configPath, { $schema: "https://opencode.ai/config.json" })
  config.$schema = config.$schema || "https://opencode.ai/config.json"
  config.plugin = addUnique(ensureArray(config.plugin), pathToFileURL(pluginPath).href)
  config.instructions = addUnique(ensureArray(config.instructions), instructionsPath)

  const configChanged = await writeJsonWithBackup(configPath, config)
  const packagePath = await updatePackageJson(configDir)

  runNpmInstall(configDir)

  console.log("")
  console.log("OpenCode Session Status Prefix installed.")
  console.log(`- Plugin: ${pluginPath} (${pluginInstall})`)
  console.log(`- Instructions: ${instructionsPath} (${instructionsInstall})`)
  console.log(`- Config: ${configPath}${configChanged ? " (updated)" : " (already configured)"}`)
  console.log(`- Package dependencies: ${packagePath}`)
  console.log("")
  console.log("Restart OpenCode Desktop or your OpenCode TUI for the plugin to load.")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
