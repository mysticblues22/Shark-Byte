import {
  HostCapacity,
  LxcContainerInfo,
  LxcContainerState,
  LxcProvisionRequest,
  LxcProvisionResult,
  VpsProvider,
} from "./types";
import { SshClient } from "./sshClient";

const SAFE_CONTAINER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SAFE_HOSTNAME = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
const SAFE_TEMPLATE_VALUE = /^[a-zA-Z0-9._-]+$/;

function containerNameFor(vpsNumber: number): string {
  if (!Number.isInteger(vpsNumber) || vpsNumber < 1) {
    throw new Error("VPS number must be a positive integer.");
  }
  return `shark-vps-${String(vpsNumber).padStart(6, "0")}`;
}

function assertSafeContainerName(value: string): void {
  if (!SAFE_CONTAINER_NAME.test(value)) {
    throw new Error(`Unsafe LXC container name: ${value}`);
  }
}

function assertSafeHostname(value: string): void {
  if (!SAFE_HOSTNAME.test(value)) {
    throw new Error(`Unsafe hostname: ${value}`);
  }
}

function assertSafeTemplateValue(label: string, value: string): void {
  if (!SAFE_TEMPLATE_VALUE.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function bytesFromGb(gb: number): number {
  return Math.floor(gb * 1024 * 1024 * 1024);
}

function parseKeyValueOutput(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values.set(key, value);
  }
  return values;
}

export class LxcProvider implements VpsProvider {
  private readonly ssh: SshClient;

  public constructor(ssh: SshClient) {
    this.ssh = ssh;
  }

  private async runProvisionStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`Failed during LXC ${stage}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  public getContainerName(vpsNumber: number): string {
    return containerNameFor(vpsNumber);
  }

  public async getHostCapacity(): Promise<HostCapacity> {
    const result = await this.ssh.runChecked(
      [
        "set -eu",
        'TOTAL_MEMORY="$(awk \'/MemTotal/ {print $2 * 1024}\' /proc/meminfo)"',
        'AVAILABLE_MEMORY="$(awk \'/MemAvailable/ {print $2 * 1024}\' /proc/meminfo)"',
        'CPU_COUNT="$(nproc)"',
        'ROOT_AVAILABLE="$(df -B1 / | awk \'NR==2 {print $4}\')"',
        'CONTAINER_COUNT="$(lxc-ls 2>/dev/null | wc -l | tr -d \' \')"',
        'printf "totalMemoryBytes=%s\\n" "$TOTAL_MEMORY"',
        'printf "availableMemoryBytes=%s\\n" "$AVAILABLE_MEMORY"',
        'printf "cpuCount=%s\\n" "$CPU_COUNT"',
        'printf "rootFilesystemAvailableBytes=%s\\n" "$ROOT_AVAILABLE"',
        'printf "existingContainerCount=%s\\n" "$CONTAINER_COUNT"',
      ].join("\n")
    );

    const values = parseKeyValueOutput(result.stdout);

    return {
      totalMemoryBytes: Number(values.get("totalMemoryBytes") ?? 0),
      availableMemoryBytes: Number(values.get("availableMemoryBytes") ?? 0),
      cpuCount: Number(values.get("cpuCount") ?? 0),
      rootFilesystemAvailableBytes: Number(values.get("rootFilesystemAvailableBytes") ?? 0),
      existingContainerCount: Number(values.get("existingContainerCount") ?? 0),
    };
  }

  public async containerExists(containerName: string): Promise<boolean> {
    assertSafeContainerName(containerName);
    const result = await this.ssh.run(`test -d /var/lib/lxc/${containerName}`);
    return result.exitCode === 0;
  }

  public async getContainerInfo(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);

    const result = await this.ssh.run(`lxc-info -n ${containerName}`);
    if (result.exitCode !== 0) {
      return { name: containerName, state: "UNKNOWN", privateIpv4: null };
    }

    const stateMatch = result.stdout.match(/^State:\s*(.+)$/m);
    const ipMatch = result.stdout.match(/^IP:\s*([0-9.]+)$/m);
    const stateValue = stateMatch?.[1]?.trim().toUpperCase();

    const state: LxcContainerState =
      stateValue === "RUNNING" || stateValue === "STOPPED" || stateValue === "FROZEN"
        ? stateValue
        : "UNKNOWN";

    return {
      name: containerName,
      state,
      privateIpv4: ipMatch?.[1] ?? null,
    };
  }

  private async waitForPrivateIpv4(containerName: string, timeoutSeconds: number): Promise<string> {
    const startedAt = Date.now();
    const timeoutMs = timeoutSeconds * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      const info = await this.getContainerInfo(containerName);
      if (info.state === "RUNNING" && info.privateIpv4 && info.privateIpv4 !== "0.0.0.0") {
        return info.privateIpv4;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }

    throw new Error(`Timed out waiting for DHCP IPv4 on ${containerName}.`);
  }

  private validateRequest(request: LxcProvisionRequest): void {
    const containerName = request.containerName?.trim() || containerNameFor(request.vpsNumber);
    assertSafeContainerName(containerName);
    assertSafeHostname(request.hostname);
    assertSafeTemplateValue("template distribution", (request.templateDistribution || "ubuntu"));
    assertSafeTemplateValue("template release", (request.templateRelease || "jammy"));
    assertSafeTemplateValue("template architecture", (request.templateArchitecture || "amd64"));
    assertSafeTemplateValue("bridge name", (request.bridgeName || "incusbr1"));

    if (request.resources.ramGb <= 0 || !Number.isFinite(request.resources.ramGb)) {
      throw new Error("RAM must be greater than zero.");
    }
    if (!Number.isInteger(request.resources.vcpu) || request.resources.vcpu < 1) {
      throw new Error("vCPU must be a positive integer.");
    }
    if (request.resources.storageGb <= 0 || !Number.isFinite(request.resources.storageGb)) {
      throw new Error("Storage must be greater than zero.");
    }
  }

  public async provision(request: LxcProvisionRequest): Promise<LxcProvisionResult> {
    this.validateRequest(request);
    const containerName = request.containerName?.trim() || containerNameFor(request.vpsNumber);

    const alreadyExists = await this.runProvisionStage("container existence check", () =>
      this.containerExists(containerName)
    );

    if (alreadyExists) {
      throw new Error(`Container ${containerName} already exists.`);
    }

    const capacity = await this.runProvisionStage("host capacity check", () =>
      this.getHostCapacity()
    );

    const requestedMemoryBytes = bytesFromGb(request.resources.ramGb);

    if (capacity.availableMemoryBytes < requestedMemoryBytes) {
      throw new Error(
        `Insufficient available host memory. Requested ${request.resources.ramGb} GB, available ${(capacity.availableMemoryBytes / 1024 / 1024 / 1024).toFixed(2)} GB.`
      );
    }

    if (capacity.rootFilesystemAvailableBytes < bytesFromGb(request.resources.storageGb)) {
      throw new Error(
        `Insufficient root filesystem capacity for requested ${request.resources.storageGb} GB.`
      );
    }

    let created = false;

    try {
      await this.runProvisionStage("container creation", () =>
        this.ssh.runArgumentsChecked(
          "lxc-create",
          [
            "-n",
            containerName,
            "-t",
            "download",
            "--",
            "-d",
            (request.templateDistribution || "ubuntu"),
            "-r",
            (request.templateRelease || "jammy"),
            "-a",
            (request.templateArchitecture || "amd64"),
          ],
          { timeoutMs: 10 * 60 * 1000 }
        )
      );

      created = true;
      const configPath = `/var/lib/lxc/${containerName}/config`;

      await this.runProvisionStage("container configuration", () =>
        this.ssh.runChecked(
          [
            "set -eu",
            `grep -q '^lxc.uts.name = ' ${configPath} && sed -i 's/^lxc\\.uts\\.name = .*/lxc.uts.name = ${request.hostname}/' ${configPath} || printf '\\nlxc.uts.name = ${request.hostname}\\n' >> ${configPath}`,
            `grep -q '^lxc.net.0.link = ' ${configPath} && sed -i 's/^lxc\\.net\\.0\\.link = .*/lxc.net.0.link = ${(request.bridgeName || "incusbr1")}/' ${configPath} || printf '\\nlxc.net.0.link = ${(request.bridgeName || "incusbr1")}\\n' >> ${configPath}`,
            `grep -q '^lxc.start.auto = ' ${configPath} && sed -i 's/^lxc\\.start\\.auto = .*/lxc.start.auto = 1/' ${configPath} || printf '\\nlxc.start.auto = 1\\n' >> ${configPath}`,
            `printf '\\nlxc.cgroup2.memory.max = ${requestedMemoryBytes}\\n' >> ${configPath}`,
            `printf 'lxc.cgroup2.cpuset.cpus = 0-${Math.max(request.resources.vcpu - 1, 0)}\\n' >> ${configPath}`,
            ...(request.staticPrivateIpv4
              ? [
                  `grep -q '^lxc.net.0.ipv4.address = ' ${configPath} && sed -i 's|^lxc\\.net\\.0\\.ipv4\\.address = .*|lxc.net.0.ipv4.address = ${request.staticPrivateIpv4}/24|' ${configPath} || printf '\\nlxc.net.0.ipv4.address = ${request.staticPrivateIpv4}/24\\n' >> ${configPath}`,
                  `grep -q '^lxc.net.0.ipv4.gateway = ' ${configPath} && sed -i 's|^lxc\\.net\\.0\\.ipv4\\.gateway = .*|lxc.net.0.ipv4.gateway = 10.0.3.1|' ${configPath} || printf 'lxc.net.0.ipv4.gateway = 10.0.3.1\\n' >> ${configPath}`,
                ]
              : []),
          ].join("\n")
        )
      );

      await this.runProvisionStage("container start", () =>
        this.ssh.runArgumentsChecked("lxc-start", ["-n", containerName, "-d"])
      );

      if (request.initialPassword) {
        const encodedPassword = Buffer.from(request.initialPassword, "utf8").toString("base64");
        await this.runProvisionStage("SSH/password setup", () =>
          this.ssh.runChecked(
            [
              "set -eu",
              `lxc-attach -n ${containerName} -- sh -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -y; apt-get install -y openssh-server; mkdir -p /run/sshd /etc/ssh/sshd_config.d; printf "PermitRootLogin yes\\nPasswordAuthentication yes\\n" > /etc/ssh/sshd_config.d/99-shark.conf; grep -q "^Include /etc/ssh/sshd_config.d/\\*.conf" /etc/ssh/sshd_config || printf "\\nInclude /etc/ssh/sshd_config.d/*.conf\\n" >> /etc/ssh/sshd_config; sshd -t; systemctl enable ssh || true; systemctl restart ssh || service ssh restart || true; echo root:$(printf %s ${encodedPassword} | base64 -d) | chpasswd'`,
            ].join("\n")
          )
        );
      }

      const discoveredIp = await this.runProvisionStage("network/DHCP setup", () =>
        this.waitForPrivateIpv4(containerName, request.startupTimeoutSeconds ?? 90)
      );

      const privateIpv4 = request.staticPrivateIpv4 || discoveredIp;

      const finalInfo = await this.runProvisionStage("final verification", () =>
        this.getContainerInfo(containerName)
      );

      if (finalInfo.state !== "RUNNING") {
        throw new Error(`Container ${containerName} did not remain RUNNING. Current state: ${finalInfo.state}`);
      }

      return {
        containerName,
        hostname: request.hostname,
        state: finalInfo.state,
        privateIpv4,
        requestedRamGb: request.resources.ramGb,
        requestedVcpu: request.resources.vcpu,
        requestedStorageGb: request.resources.storageGb,
        ramLimitApplied: true,
        cpuLimitApplied: true,
        storageLimitApplied: false,
        storageLimitEnforced: false,
        storageBackend: "directory",
        storageStatus: "unbounded_directory",
        storageLimitMessage: "Storage quota is validated against host free space.",
        createdAt: new Date(),
      };
    } catch (error) {
      if (created) {
        try {
          const info = await this.getContainerInfo(containerName);
          if (info.state === "RUNNING") {
            await this.ssh.runArguments("lxc-stop", ["-n", containerName], { timeoutMs: 30_000 });
          }
          await this.ssh.runArguments("lxc-destroy", ["-n", containerName], { timeoutMs: 60_000 });
        } catch (rollbackError) {
          console.error(`❌ Failed to roll back LXC container ${containerName}:`, rollbackError);
        }
      }
      throw error;
    }
  }

  public async start(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("lxc-start", ["-n", containerName, "-d"]);
    return this.getContainerInfo(containerName);
  }

  public async stop(containerName: string): Promise<LxcContainerInfo> {
    assertSafeContainerName(containerName);
    await this.ssh.runArgumentsChecked("lxc-stop", ["-n", containerName]);
    return this.getContainerInfo(containerName);
  }

  public async restart(containerName: string): Promise<LxcContainerInfo> {
    await this.stop(containerName);
    return this.start(containerName);
  }

  public async destroy(containerName: string): Promise<void> {
    assertSafeContainerName(containerName);
    const info = await this.getContainerInfo(containerName);
    if (info.state === "RUNNING") {
      await this.stop(containerName);
    }
    await this.ssh.runArgumentsChecked("lxc-destroy", ["-n", containerName], { timeoutMs: 60_000 });
  }

  public async runInContainer(containerName: string, command: string, timeoutMs = 120_000): Promise<string> {
    assertSafeContainerName(containerName);
    const encoded = Buffer.from(command, "utf8").toString("base64");
    const result = await this.ssh.run(
      `lxc-attach -n ${containerName} -- sh -lc "printf %s '${encoded}' | base64 -d | sh"`,
      { timeoutMs }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Container command failed for ${containerName}: ${result.stderr || result.stdout}`);
    }

    return result.stdout;
  }
}
