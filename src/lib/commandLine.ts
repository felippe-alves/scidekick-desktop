export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) args.push(current);
  return args;
}

export function formatBytes(value: number | null): string {
  if (value === null) return "file";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Match common ANSI escape sequences: CSI (\x1b[…m, etc.), OSC (\x1b]…BEL or ST), and SGR.
// Covers what CLI tools emit for colour, cursor movement, and titles.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~])|(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)/g;

export function stripAnsi(text: string): string {
  if (!text) return text;
  return text.replace(ANSI_RE, "");
}
