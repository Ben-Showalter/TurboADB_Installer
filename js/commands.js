// Runs an app's commands.txt on the phone. Plain lines are run as written;
// a few shortcut lines expand into the right commands for the phone's Android
// version. No browser or USB code in here, so it can be tested with Node.

/** Turns commands.txt text into a list of commands, dropping notes and blanks. */
export function parseCommands(text, vars = {}) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m));
}

// Output that means a command failed even though its exit code was 0
// (older Android versions often exit 0 on error).
const FAILURE_OUTPUT = /^(Error\b|Failure\b|Exception\b|Security exception|java\.lang\.\w+(Exception|Error)|Unknown command|Can't find service|Bad component name|usage:)|: (not found|inaccessible or not found)$/im;

export function commandFailed({ output, exitCode }) {
  return (exitCode !== null && exitCode !== 0) || FAILURE_OUTPUT.test(output);
}

/** `pkg/.Cls` -> `pkg/pkg.Cls`, so two spellings of the same component compare equal. */
export function expandComponent(component) {
  const [pkg, cls] = component.split('/');
  if (!pkg || !cls) return component;
  return `${pkg}/${cls.startsWith('.') ? pkg + cls : cls}`;
}

function quote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireComponent(name, arg) {
  if (!arg || !arg.includes('/')) {
    throw new Error(`${name} needs a component, like com.example.app/.MyService`);
  }
  return arg;
}

/** Adds a component to a colon-separated secure setting without removing the others. */
async function addToSecureList(shell, setting, component) {
  const steps = [];
  const get = await shell(`settings get secure ${setting}`);
  steps.push({ command: `settings get secure ${setting}`, ...get });
  const current = get.output.trim();
  const list = current && current !== 'null' ? current.split(':').filter(Boolean) : [];
  const target = expandComponent(component);
  if (list.some((c) => expandComponent(c) === target)) {
    return { steps, alreadyOn: true };
  }
  const command = `settings put secure ${setting} ${quote([...list, component].join(':'))}`;
  steps.push({ command, ...(await shell(command)) });
  return { steps, alreadyOn: false };
}

const SHORTCUTS = {
  async 'enable-accessibility'(arg, { shell }) {
    const component = requireComponent('enable-accessibility', arg);
    const { steps, alreadyOn } = await addToSecureList(shell, 'enabled_accessibility_services', component);
    const command = 'settings put secure accessibility_enabled 1';
    steps.push({ command, ...(await shell(command)) });
    return { steps, note: alreadyOn ? 'Already on.' : undefined };
  },

  async 'enable-notification-listener'(arg, { shell, sdk }) {
    const component = requireComponent('enable-notification-listener', arg);
    const steps = [];
    if (sdk >= 26) {
      const command = `cmd notification allow_listener ${component}`;
      const result = await shell(command);
      steps.push({ command, ...result });
      if (!commandFailed(result)) return { steps };
    }
    const added = await addToSecureList(shell, 'enabled_notification_listeners', component);
    return {
      steps: [...steps, ...added.steps],
      note: added.alreadyOn ? 'Already on.' : undefined,
      // Earlier failed attempt above is replaced by the fallback.
      ignoreFailuresBefore: steps.length,
    };
  },

  async 'set-home'(arg, { shell }) {
    const component = requireComponent('set-home', arg);
    const command = `cmd package set-home-activity ${component}`;
    const result = await shell(command);
    const steps = [{ command, ...result }];
    if (!commandFailed(result)) return { steps };
    const open = 'am start -a android.intent.action.MAIN -c android.intent.category.HOME';
    steps.push({ command: open, ...(await shell(open)) });
    return {
      steps,
      ignoreFailuresBefore: 1,
      warning: 'This phone can’t switch Home apps automatically. On the phone, pick the new Home app and choose “Always”.',
    };
  },

  async 'device-owner'(arg, { shell }) {
    const component = requireComponent('device-owner', arg);
    const accounts = await shell('dumpsys account');
    const steps = [{ command: 'dumpsys account', ...accounts }];
    const count = parseInt(accounts.output.match(/Accounts:\s*(\d+)/)?.[1] ?? '0', 10);
    if (count > 0) {
      return {
        steps,
        error: `The phone has ${count} account(s) signed in (Google, email, etc.). `
          + 'Remove them in Settings → Accounts, then install again.',
      };
    }
    const command = `dpm set-device-owner ${quote(component)}`;
    steps.push({ command, ...(await shell(command)) });
    return { steps };
  },
};

export const SHORTCUT_NAMES = Object.keys(SHORTCUTS);

/**
 * Runs one commands.txt line.
 * `shell(command)` must resolve to `{ output, exitCode }`.
 * Resolves to `{ line, ok, steps, note?, warning?, error? }`; never throws.
 */
export async function runLine(line, { shell, sdk }) {
  const [name, ...rest] = line.split(/\s+/);
  const shortcut = Object.hasOwn(SHORTCUTS, name) ? SHORTCUTS[name] : null;
  try {
    if (!shortcut) {
      const result = await shell(line);
      return { line, ok: !commandFailed(result), steps: [{ command: line, ...result }] };
    }
    const result = await shortcut(rest.join(' '), { shell, sdk });
    const counted = result.steps.slice(result.ignoreFailuresBefore ?? 0);
    const failed = counted.find((s) => commandFailed(s));
    return {
      line,
      ok: !result.error && !failed,
      steps: result.steps,
      note: result.note,
      warning: result.warning,
      error: result.error,
    };
  } catch (e) {
    return { line, ok: false, steps: [], error: e.message };
  }
}

/** Runs every line in order, reporting each result as it finishes. Failures don't stop the rest. */
export async function runAll(lines, ctx, onResult = () => {}) {
  const results = [];
  for (const line of lines) {
    const result = await runLine(line, ctx);
    results.push(result);
    onResult(result);
  }
  return results;
}
