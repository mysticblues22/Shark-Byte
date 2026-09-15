import { spawn } from "child_process";
import {
  HostCapacity,
  LxcContainerInfo,
  LxcContainerState,
  LxcProvisionRequest,
  LxcProvisionResult,
  VpsProvider,
} from "./types";
import { SshClient } from "./sshClient";
import { getOsById } from "../config/osCatalog";

const SAFE_CONTAINER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SAFE_HOSTNAME = /^[a-zA-Z0-9.-]{1,253}$/;
const SAFE_PORT = /^[0-9]+$/;

type VirtualizationMode = "standard" | "nested";

export interface IncusProvisionOptions
  extends LxcProvisionRequest {
  osId: string;
  virtualizationMode: VirtualizationMode;
}

function containerNameFor(
  vpsNumber: number,
  customerUsername?: string,
): string {
  if (
    !Number.isSafeInteger(vpsNumber) ||
    vpsNumber < 1
  ) {
    throw new Error(
      "VPS number must be a positive integer.",
    );
  }

  const username =
    customerUsername
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "customer";

  return `${username}-${String(vpsNumber).padStart(2, "0")}`;
}

function assertSafeContainerName(
  value: string,
): void {
  if (!SAFE_CONTAINER_NAME.test(value)) {
    throw new Error(
      `Unsafe container name: ${value}`,
    );
  }
}

function assertSafeHostname(
  value: string,
): void {
  if (!SAFE_HOSTNAME.test(value)) {
    throw new Error(
      `Unsafe hostname: ${value}`,
    );
  }
}

function assertSafePort(
  value: number,
): void {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535 ||
    !SAFE_PORT.test(String(value))
  ) {
    throw new Error(
      `Invalid port: ${value}`,
    );
  }
}

function parseKeyValueOutput(
  output: string,
): Map<string, string> {
  const values =
    new Map<string, string>();

  for (
    const line of output.split(/\r?\n/)
  ) {
    const i =
      line.indexOf("=");

    if (i > 0) {
      values.set(
        line.slice(0, i).trim(),
        line.slice(i + 1).trim(),
      );
    }
  }

  return values;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class IncusProvider
  implements VpsProvider
{
  private readonly ssh?: SshClient;
  private readonly processLimit: string;
  private readonly storagePoolType: string;

  public constructor(
    ssh?: SshClient,
  ) {
    this.ssh = ssh;

    this.processLimit =
      process.env.VPS_INCUS_LIMIT_PROCESSES?.trim() ||
      "512";

    this.storagePoolType =
      process.env.VPS_INCUS_STORAGE_POOL_TYPE
        ?.trim()
        .toLowerCase() ||
      "dir";
  }

  /**
   * Execute local Incus commands using spawn rather than
   * exec/execFile.
   *
   * The current Incus host was verified to launch containers
   * correctly through spawn while exec/execFile previously
   * timed out despite the same command succeeding manually.
   */
  private async runCommand(
    cmd: string,
    timeoutMs = 30000,
  ): Promise<CommandResult> {
    const host =
      process.env.VPS_NODE_HOST?.trim();

    const local =
      !host ||
      [
        "127.0.0.1",
        "localhost",
        "local",
      ].includes(host);

    if (!local && this.ssh) {
      return this.ssh.run(cmd);
    }

    return new Promise<CommandResult>(
      (resolve) => {
        const child = spawn(
          "/bin/sh",
          ["-lc", cmd],
          {
            env: process.env,
            cwd: process.cwd(),
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );

        let stdout = "";
        let stderr = "";
        let settled = false;
        let timedOut = false;

        const finish = (
          result: CommandResult,
        ) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };

        const timeout =
          setTimeout(() => {
            if (settled) {
              return;
            }

            timedOut = true;

            try {
              child.kill("SIGTERM");
            } catch {
              // Ignore kill errors.
            }

            setTimeout(() => {
              if (settled) {
                return;
              }

              try {
                child.kill("SIGKILL");
              } catch {
                // Ignore kill errors.
              }
            }, 2000);
          }, timeoutMs);

        child.stdout?.setEncoding(
          "utf8",
        );

        child.stderr?.setEncoding(
          "utf8",
        );

        child.stdout?.on(
          "data",
          (data: string) => {
            stdout += data;
          },
        );

        child.stderr?.on(
          "data",
          (data: string) => {
            stderr += data;
          },
        );

        child.on(
          "error",
          (error) => {
            clearTimeout(timeout);

            finish({
              stdout,
              stderr:
                stderr ||
                error.message,
              exitCode: 1,
            });
          },
        );

        child.on(
          "close",
          (code, signal) => {
            clearTimeout(timeout);

            if (timedOut) {
              finish({
                stdout,
                stderr:
                  `Command timed out after ${timeoutMs}ms: ${cmd}` +
                  (stderr
                    ? `\n${stderr}`
                    : ""),
                exitCode: 124,
              });

              return;
            }

            if (
              typeof code ===
              "number"
            ) {
              finish({
                stdout,
                stderr,
                exitCode: code,
              });

              return;
            }

            finish({
              stdout,
              stderr:
                stderr ||
                `Command terminated by signal ${
                  signal || "unknown"
                }: ${cmd}`,
              exitCode: 1,
            });
          },
        );
      },
    );
  }

  private async runCheckedCommand(
    cmd: string,
    timeoutMs = 30000,
  ): Promise<CommandResult> {
    const result =
      await this.runCommand(
        cmd,
        timeoutMs,
      );

    if (
      result.exitCode !== 0
    ) {
      throw new Error(
        `Command failed (exit ${result.exitCode}): ${cmd}\n` +
          `${
            result.stderr ||
            result.stdout ||
            "No command output."
          }`,
      );
    }

    return result;
  }

  public getContainerName(
    vpsNumber: number,
    customerUsername?: string,
  ): string {
    return containerNameFor(
      vpsNumber,
      customerUsername,
    );
  }

  public async validateImageAlias(
    alias: string,
  ): Promise<boolean> {
    const result =
      await this.runCommand(
        `incus image info ${alias}`,
        10000,
      );

    return result.exitCode === 0;
  }

  public async getHostCapacity(): Promise<HostCapacity> {
    const result =
      await this.runCheckedCommand(
        [
          "set -eu",

          'TOTAL_MEMORY="$(awk \'/MemTotal/ {print $2 * 1024}\' /proc/meminfo)"',

          'AVAILABLE_MEMORY="$(awk \'/MemAvailable/ {print $2 * 1024}\' /proc/meminfo)"',

          'CPU_COUNT="$(nproc)"',

          'ROOT_AVAILABLE="$(df -B1 / | awk \'NR==2 {print $4}\')"',

          'CONTAINER_COUNT="$(incus list --format csv 2>/dev/null | wc -l | tr -d \' \')"',

          'printf "totalMemoryBytes=%s\\n" "$TOTAL_MEMORY"',

          'printf "availableMemoryBytes=%s\\n" "$AVAILABLE_MEMORY"',

          'printf "cpuCount=%s\\n" "$CPU_COUNT"',

          'printf "rootFilesystemAvailableBytes=%s\\n" "$ROOT_AVAILABLE"',

          'printf "existingContainerCount=%s\\n" "$CONTAINER_COUNT"',
        ].join("\n"),
      );

    const values =
      parseKeyValueOutput(
        result.stdout,
      );

    return {
      totalMemoryBytes:
        Number(
          values.get(
            "totalMemoryBytes",
          ) || 0,
        ),

      availableMemoryBytes:
        Number(
          values.get(
            "availableMemoryBytes",
          ) || 0,
        ),

      cpuCount:
        Number(
          values.get(
            "cpuCount",
          ) || 0,
        ),

      rootFilesystemAvailableBytes:
        Number(
          values.get(
            "rootFilesystemAvailableBytes",
          ) || 0,
        ),

      existingContainerCount:
        Number(
          values.get(
            "existingContainerCount",
          ) || 0,
        ),
    };
  }

  public async containerExists(
    containerName: string,
  ): Promise<boolean> {
    assertSafeContainerName(
      containerName,
    );

    return (
      await this.runCommand(
        `incus info ${containerName}`,
        10000,
      )
    ).exitCode === 0;
  }

  public async getContainerInfo(
    containerName: string,
  ): Promise<LxcContainerInfo> {
    assertSafeContainerName(
      containerName,
    );

    const result =
      await this.runCommand(
        `incus list ${containerName} --format json`,
        10000,
      );

    if (
      result.exitCode !== 0
    ) {
      return {
        name: containerName,
        state: "UNKNOWN",
        privateIpv4: null,
      };
    }

    try {
      const instances =
        JSON.parse(
          result.stdout,
        ) as Array<{
          name: string;
          status: string;
          state?: {
            network?: Record<
              string,
              {
                addresses?: Array<{
                  family: string;
                  address: string;
                  scope: string;
                }>;
              }
            >;
          };
        }>;

      const instance =
        instances.find(
          (x) =>
            x.name ===
            containerName,
        );

      if (!instance) {
        return {
          name: containerName,
          state: "UNKNOWN",
          privateIpv4: null,
        };
      }

      const status =
        instance.status.toUpperCase();

      const state: LxcContainerState =
        [
          "RUNNING",
          "STOPPED",
          "FROZEN",
        ].includes(status)
          ? (status as LxcContainerState)
          : "UNKNOWN";

      let privateIpv4:
        | string
        | null = null;

      for (
        const device of Object.values(
          instance.state
            ?.network || {},
        )
      ) {
        for (
          const address of
            device.addresses || []
        ) {
          if (
            address.family ===
              "inet" &&
            address.scope ===
              "global" &&
            ![
              "127.0.0.1",
              "0.0.0.0",
            ].includes(
              address.address,
            )
          ) {
            privateIpv4 =
              address.address;
            break;
          }
        }

        if (privateIpv4) {
          break;
        }
      }

      return {
        name: containerName,
        state,
        privateIpv4,
      };
    } catch {
      return {
        name: containerName,
        state: "UNKNOWN",
        privateIpv4: null,
      };
    }
  }

  private async waitForPrivateIpv4(
    containerName: string,
    timeoutSeconds = 30,
  ): Promise<string> {
    const end =
      Date.now() +
      timeoutSeconds * 1000;

    while (
      Date.now() < end
    ) {
      const info =
        await this.getContainerInfo(
          containerName,
        );

      if (
        info.state ===
          "RUNNING" &&
        info.privateIpv4
      ) {
        return info.privateIpv4;
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            1500,
          ),
      );
    }

    throw new Error(
      `Timed out waiting for DHCP IPv4 address on ${containerName}.`,
    );
  }

  private validateRequest(
    request: IncusProvisionOptions,
  ): void {
    const name =
      request.containerName?.trim() ||
      containerNameFor(
        request.vpsNumber,
        request.customerUsername,
      );

    assertSafeContainerName(
      name,
    );

    assertSafeHostname(
      request.hostname,
    );

    if (!request.osId) {
      throw new Error(
        "An OS selection is required.",
      );
    }

    if (
      ![
        "standard",
        "nested",
      ].includes(
        request.virtualizationMode,
      )
    ) {
      throw new Error(
        "Invalid virtualization mode.",
      );
    }

    if (
      !Number.isFinite(
        request.resources.ramGb,
      ) ||
      request.resources.ramGb <= 0
    ) {
      throw new Error(
        "RAM must be greater than zero.",
      );
    }

    if (
      !Number.isInteger(
        request.resources.vcpu,
      ) ||
      request.resources.vcpu < 1
    ) {
      throw new Error(
        "vCPU must be a positive integer.",
      );
    }

    if (
      !Number.isFinite(
        request.resources.storageGb,
      ) ||
      request.resources.storageGb <= 0
    ) {
      throw new Error(
        "Storage must be greater than zero.",
      );
    }

    if (
      request.publicSshPort !==
      undefined
    ) {
      assertSafePort(
        request.publicSshPort,
      );
    }
  }

  private async configureNestedVirtualization(
    containerName: string,
    enabled: boolean,
  ): Promise<{
    kvmAvailable: boolean;
  }> {
    assertSafeContainerName(
      containerName,
    );

    if (!enabled) {
      await this.runCheckedCommand(
        `incus config set ${containerName} security.nesting false`,
        10000,
      );

      await this.runCommand(
        `incus config device remove ${containerName} kvm`,
        10000,
      );

      return {
        kvmAvailable: false,
      };
    }

    await this.runCheckedCommand(
      `incus config set ${containerName} security.nesting true`,
      10000,
    );

    const kvmHost =
      await this.runCommand(
        "test -c /dev/kvm",
        5000,
      );

    if (
      kvmHost.exitCode !== 0
    ) {
      throw new Error(
        "Nested virtualization requested, but /dev/kvm is unavailable on the Incus host.",
      );
    }

    await this.runCommand(
      `incus config device remove ${containerName} kvm`,
      10000,
    );

    await this.runCheckedCommand(
      `incus config device add ${containerName} kvm unix-char source=/dev/kvm path=/dev/kvm`,
      15000,
    );

    const deviceConfig =
      await this.runCheckedCommand(
        `incus config device show ${containerName}`,
        10000,
      );

    if (
      !deviceConfig.stdout.includes(
        "kvm:",
      )
    ) {
      throw new Error(
        "Nested virtualization requested, but the Incus KVM device could not be verified.",
      );
    }

    const kvmCheck =
      await this.runCommand(
        `incus exec ${containerName} -- sh -lc 'test -c /dev/kvm && test -r /dev/kvm && test -w /dev/kvm'`,
        10000,
      );

    if (
      kvmCheck.exitCode !== 0
    ) {
      throw new Error(
        "Nested virtualization requested, but /dev/kvm is not usable inside the VPS.",
      );
    }

    return {
      kvmAvailable: true,
    };
  }

  /**
   * Install and configure SSH inside the VPS.
   *
   * The minimal Ubuntu Incus images do not necessarily contain
   * openssh-server, so provisioning installs it explicitly.
   */
  private async configureSsh(
    containerName: string,
    password: string,
  ): Promise<void> {
    assertSafeContainerName(
      containerName,
    );

    if (!password) {
      throw new Error(
        "An initial VPS root password is required for SSH configuration.",
      );
    }

    /*
     * IMPORTANT:
     *
     * chpasswd requires:
     *
     *     root:<password>
     *
     * rather than only:
     *
     *     <password>
     *
     * The complete credential string is base64 encoded so the
     * plaintext password does not appear in the command string.
     */
    const encodedCredentials =
      Buffer.from(
        `root:${password}`,
        "utf8",
      ).toString("base64");

    const cmd =
      `incus exec ${containerName} -- sh -lc ` +
      `'set -eu; ` +
      `export DEBIAN_FRONTEND=noninteractive; ` +
      `apt-get update; ` +
      `apt-get install -y --no-install-recommends openssh-server; ` +
      `mkdir -p /run/sshd /etc/ssh/sshd_config.d; ` +
      `printf "%s\\\\n" "PermitRootLogin yes" "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/99-shark.conf; ` +
      `if ! grep -q "^Include /etc/ssh/sshd_config.d/\\\\*.conf" /etc/ssh/sshd_config; then ` +
      `printf "\\\\nInclude /etc/ssh/sshd_config.d/*.conf\\\\n" >> /etc/ssh/sshd_config; ` +
      `fi; ` +
      `printf "%s" ${encodedCredentials} | base64 -d | chpasswd; ` +
      `sshd -t; ` +
      `systemctl enable ssh; ` +
      `systemctl restart ssh; ` +
      `ss -lnt | grep -Eq "([.:])22[[:space:]]"; ` +
      `echo SSH_VERIFIED'`;

    const result =
      await this.runCommand(
        cmd,
        120000,
      );

    if (
      result.exitCode !== 0
    ) {
      throw new Error(
        "Failed to install/configure SSH inside the VPS.\n" +
          `${
            result.stderr ||
            result.stdout ||
            "No command output."
          }`,
      );
    }

    if (
      !result.stdout.includes(
        "SSH_VERIFIED",
      )
    ) {
      throw new Error(
        "SSH installation completed but TCP port 22 could not be verified.",
      );
    }

    console.log(
      `[Incus] SSH verified on "${containerName}".`,
    );
  }

  public async isNestedVirtualizationSupported(): Promise<boolean> {
    const kvm =
      await this.runCommand(
        "test -c /dev/kvm",
        5000,
      );

    if (
      kvm.exitCode !== 0
    ) {
      return false;
    }

    const help =
      await this.runCommand(
        "incus config device add --help",
        5000,
      );

    return (
      help.exitCode === 0 &&
      /unix-char/.test(
        help.stdout +
          help.stderr,
      )
    );
  }

  public async provision(
    request: IncusProvisionOptions,
    onProgress?: (
      text: string,
    ) => Promise<void>,
  ): Promise<LxcProvisionResult> {
    this.validateRequest(
      request,
    );

    const os =
      getOsById(
        request.osId,
      );

    if (
      !os ||
      os.availability !==
        "available" ||
      !os.incusAlias
    ) {
      throw new Error(
        `Selected OS "${request.osId}" is unavailable.`,
      );
    }

    if (
      !(await this.validateImageAlias(
        os.incusAlias,
      ))
    ) {
      throw new Error(
        `Incus image alias "${os.incusAlias}" is not available on this node.`,
      );
    }

    const containerName =
      request.containerName?.trim() ||
      containerNameFor(
        request.vpsNumber,
        request.customerUsername,
      );

    assertSafeContainerName(
      containerName,
    );

    if (
      await this.containerExists(
        containerName,
      )
    ) {
      throw new Error(
        `Container name "${containerName}" already exists. Refusing to overwrite it.`,
      );
    }

    let created = false;

    try {
      await onProgress?.(
        `Launching ${os.displayName}...`,
      ).catch(() => {});

      console.log(
        `[Incus] Launching "${containerName}" from alias "${os.incusAlias}".`,
      );

      /*
       * Keep the launch command simple.
       *
       * The current dir storage backend does not enforce
       * per-container disk quotas, so no limits.disk option
       * is supplied here.
       */
      await this.runCheckedCommand(
        `incus launch ${os.incusAlias} ${containerName} -p default`,
        35000,
      );

      created = true;

      await onProgress?.(
        `Configuring ${request.resources.vcpu} vCPU, ${request.resources.ramGb} GB RAM and ${this.processLimit} processes...`,
      ).catch(() => {});

      await this.runCheckedCommand(
        `incus config set ${containerName} limits.cpu=${request.resources.vcpu}`,
        10000,
      );

      await this.runCheckedCommand(
        `incus config set ${containerName} limits.memory=${request.resources.ramGb}GiB`,
        10000,
      );

      await this.runCheckedCommand(
        `incus config set ${containerName} limits.processes=${this.processLimit}`,
        10000,
      );

      const nested =
        await this.configureNestedVirtualization(
          containerName,
          request.virtualizationMode ===
            "nested",
        );

      if (
        request.initialPassword
      ) {
        await onProgress?.(
          "Installing and configuring SSH...",
        ).catch(() => {});

        await this.configureSsh(
          containerName,
          request.initialPassword,
        );
      }

      if (
        request.publicSshPort
      ) {
        await onProgress?.(
          `Configuring SSH gateway port ${request.publicSshPort}...`,
        ).catch(() => {});

        const device =
          `proxy-ssh-${request.publicSshPort}`;

        await this.runCheckedCommand(
          `incus config device add ${containerName} ${device} proxy listen=tcp:0.0.0.0:${request.publicSshPort} connect=tcp:127.0.0.1:22`,
          15000,
        );

        const devices =
          await this.runCheckedCommand(
            `incus config device show ${containerName}`,
            10000,
          );

        if (
          !devices.stdout.includes(
            `${device}:`,
          )
        ) {
          throw new Error(
            `SSH proxy device "${device}" could not be verified.`,
          );
        }
      }

      await onProgress?.(
        "Waiting for private IPv4 address...",
      ).catch(() => {});

      const privateIpv4 =
        await this.waitForPrivateIpv4(
          containerName,
          30,
        );

      await onProgress?.(
        "Verifying VPS...",
      ).catch(() => {});

      const finalInfo =
        await this.getContainerInfo(
          containerName,
        );

      if (
        finalInfo.state !==
        "RUNNING"
      ) {
        throw new Error(
          `Container ${containerName} is not RUNNING.`,
        );
      }

      const config =
        await this.runCheckedCommand(
          `incus config show ${containerName}`,
          10000,
        );

      if (
        !config.stdout.includes(
          `limits.cpu: "${request.resources.vcpu}"`,
        ) &&
        !config.stdout.includes(
          `limits.cpu: ${request.resources.vcpu}`,
        )
      ) {
        throw new Error(
          "CPU limit verification failed.",
        );
      }

      const expectedMemory =
        `${request.resources.ramGb}GiB`;

      const memoryRegex =
        new RegExp(
          `limits\\.memory:\\s*"?${expectedMemory}"?`,
        );

      if (
        !memoryRegex.test(
          config.stdout,
        )
      ) {
        throw new Error(
          "RAM limit verification failed.",
        );
      }

      return {
        containerName,
        hostname:
          request.hostname,
        state:
          finalInfo.state,
        privateIpv4,

        requestedRamGb:
          request.resources.ramGb,

        requestedVcpu:
          request.resources.vcpu,

        requestedStorageGb:
          request.resources.storageGb,

        ramLimitApplied: true,
        cpuLimitApplied: true,

        storageLimitApplied:
          false,

        storageLimitEnforced:
          false,

        storageBackend:
          this.storagePoolType,

        storageStatus:
          this.storagePoolType ===
          "dir"
            ? "unbounded_directory"
            : "not_configured",

        storageLimitMessage:
          this.storagePoolType ===
          "dir"
            ? "Storage is recorded for the plan but is not enforced by the current dir storage backend."
            : "Storage quota was not configured by this provisioning path.",

        virtualizationMode:
          request.virtualizationMode,

        nestingEnabled:
          request.virtualizationMode ===
          "nested",

        kvmAvailable:
          nested.kvmAvailable,

        createdAt:
          new Date(),
      };
    } catch (error) {
      /*
       * Only delete the exact container created by this
       * provisioning attempt.
       */
      if (created) {
        console.error(
          `[Incus] Provisioning failed for "${containerName}". Cleaning up only this container.`,
        );

        await this.runCommand(
          `incus delete -f ${containerName}`,
          30000,
        ).catch(
          (cleanupError) => {
            console.error(
              `[Incus] Cleanup failed for "${containerName}":`,
              cleanupError,
            );
          },
        );
      }

      throw error;
    }
  }

  public async setNesting(
    containerName: string,
    enable: boolean,
  ): Promise<void> {
    assertSafeContainerName(
      containerName,
    );

    await this.runCheckedCommand(
      `incus config set ${containerName} security.nesting ${enable ? "true" : "false"}`,
      10000,
    );
  }

  public async isNestingEnabled(
    containerName: string,
  ): Promise<boolean> {
    assertSafeContainerName(
      containerName,
    );

    const result =
      await this.runCommand(
        `incus config get ${containerName} security.nesting`,
        5000,
      );

    return (
      result.exitCode === 0 &&
      result.stdout.trim() ===
        "true"
    );
  }

  public async start(
    containerName: string,
  ): Promise<LxcContainerInfo> {
    assertSafeContainerName(
      containerName,
    );

    await this.runCheckedCommand(
      `incus start ${containerName}`,
      30000,
    );

    return this.getContainerInfo(
      containerName,
    );
  }

  public async stop(
    containerName: string,
  ): Promise<LxcContainerInfo> {
    assertSafeContainerName(
      containerName,
    );

    await this.runCheckedCommand(
      `incus stop ${containerName}`,
      30000,
    );

    return this.getContainerInfo(
      containerName,
    );
  }

  public async restart(
    containerName: string,
  ): Promise<LxcContainerInfo> {
    assertSafeContainerName(
      containerName,
    );

    await this.runCheckedCommand(
      `incus restart ${containerName}`,
      30000,
    );

    return this.getContainerInfo(
      containerName,
    );
  }

  public async destroy(
    containerName: string,
  ): Promise<void> {
    assertSafeContainerName(
      containerName,
    );

    await this.runCheckedCommand(
      `incus delete -f ${containerName}`,
      30000,
    );
  }

  public async runInContainer(
    containerName: string,
    command: string,
    timeoutMs = 30000,
  ): Promise<string> {
    assertSafeContainerName(
      containerName,
    );

    return (
      await this.runCheckedCommand(
        `incus exec ${containerName} -- ${command}`,
        timeoutMs,
      )
    ).stdout;
  }

  public async getDiagnostics(): Promise<any> {
    const version =
      await this.runCommand(
        "incus version",
        5000,
      )
        .then((r) =>
          r.stdout.trim(),
        )
        .catch(
          () => "Unavailable",
        );

    const kvm =
      await this.runCommand(
        "test -c /dev/kvm",
        5000,
      ).then(
        (r) =>
          r.exitCode === 0,
      );

    return {
      incusVersion:
        version,

      hostKvmAvailable:
        kvm,

      storageBackend:
        this.storagePoolType,
    };
  }
}
