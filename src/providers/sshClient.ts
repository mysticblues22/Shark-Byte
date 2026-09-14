import { readFile } from "node:fs/promises";
import { Client, ConnectConfig } from "ssh2";
import { RemoteCommandResult, SshConnectionConfig } from "./types";

function escapeShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class SshClient {
  private readonly config: SshConnectionConfig;

  public constructor(config: SshConnectionConfig) {
    this.config = config;
  }

  public async run(
    command: string,
    options?: {
      timeoutMs?: number;
      pty?: boolean;
    }
  ): Promise<RemoteCommandResult> {
    const privateKey = await readFile(this.config.privateKeyPath, "utf8");
    const timeoutMs = options?.timeoutMs ?? 60_000;

    return new Promise<RemoteCommandResult>((resolve, reject) => {
      const client = new Client();
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        try {
          client.end();
        } catch {
          // Ignore cleanup errors
        }
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => {
          reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`));
        });
      }, timeoutMs);

      client
        .on("ready", () => {
          const execOptions = options?.pty ? { pty: true } : {};
          client.exec(command, execOptions, (error, stream) => {
            if (error) {
              clearTimeout(timeout);
              finish(() => reject(error));
              return;
            }

            let stdout = "";
            let stderr = "";

            stream.on("data", (chunk: Buffer) => {
              stdout += chunk.toString();
            });

            if (stream.stderr) {
              stream.stderr.on("data", (chunk: Buffer) => {
                stderr += chunk.toString();
              });
            }

            stream.on("close", (code: number | null) => {
              clearTimeout(timeout);
              finish(() => {
                resolve({
                  command,
                  stdout,
                  stderr,
                  exitCode: code ?? -1,
                });
              });
            });
          });
        })
        .on("error", (error) => {
          clearTimeout(timeout);
          finish(() => {
            const code = typeof error === "object" && error && "code" in error ? ` (${String((error as any).code)})` : "";
            reject(
              new Error(
                `SSH connection failed for ${this.config.host}:${this.config.port}${code}: ${error.message}`
              )
            );
          });
        });

      const connectionConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        privateKey,
        readyTimeout: this.config.readyTimeoutMs ?? 20_000,
      };

      client.connect(connectionConfig);
    });
  }

  public async runChecked(
    command: string,
    options?: { timeoutMs?: number; pty?: boolean }
  ): Promise<RemoteCommandResult> {
    const result = await this.run(command, options);

    if (result.exitCode !== 0) {
      const details = [
        `Remote command failed with exit code ${result.exitCode}.`,
        `Command: ${command}`,
        result.stdout ? `STDOUT:\n${result.stdout}` : "",
        result.stderr ? `STDERR:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      throw new Error(details);
    }

    return result;
  }

  public async runArguments(
    executable: string,
    argumentsList: string[],
    options?: { timeoutMs?: number; pty?: boolean }
  ): Promise<RemoteCommandResult> {
    const command = [executable, ...argumentsList.map(escapeShellArgument)].join(" ");
    return this.run(command, options);
  }

  public async runArgumentsChecked(
    executable: string,
    argumentsList: string[],
    options?: { timeoutMs?: number; pty?: boolean }
  ): Promise<RemoteCommandResult> {
    const command = [executable, ...argumentsList.map(escapeShellArgument)].join(" ");
    return this.runChecked(command, options);
  }
}
