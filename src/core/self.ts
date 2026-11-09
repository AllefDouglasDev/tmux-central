import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "central");

/**
 * Como chamar este mesmo CLI de fora (scripts, hooks, config do MCP).
 * Usa o wrapper bin/central, que escolhe um Node estável — o caminho do
 * process.execPath muda a cada upgrade do Homebrew.
 */
export function centralCommand(): string[] {
  return [BIN];
}
