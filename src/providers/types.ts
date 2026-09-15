export type SshConnectionConfig = {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  readyTimeoutMs?: number;
};

export type RemoteCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type VpsResourceRequest = {
  ramGb: number;
  vcpu: number;
  storageGb: number;
};

export type LxcProvisionRequest = {
  vpsNumber: number;
  containerName?: string;
  customerUsername?: string;
  hostname: string;
  resources: VpsResourceRequest;
  templateDistribution?: string;
  templateRelease?: string;
  templateArchitecture?: string;
  bridgeName?: string;
  staticPrivateIpv4?: string;
  startupTimeoutSeconds?: number;
  initialPassword?: string;
  publicSshPort?: number;
  enableNesting?: boolean;
  osId?: string;
  virtualizationMode?: "standard" | "nested";
};

export type LxcContainerState =
  | "RUNNING"
  | "STOPPED"
  | "FROZEN"
  | "UNKNOWN";

export type LxcContainerInfo = {
  name: string;
  state: LxcContainerState;
  privateIpv4: string | null;
};

export type LxcProvisionResult = {
  containerName: string;
  hostname: string;
  state: LxcContainerState;
  privateIpv4: string | null;
  requestedRamGb: number;
  requestedVcpu: number;
  requestedStorageGb: number;
  ramLimitApplied: boolean;
  cpuLimitApplied: boolean;
  storageLimitApplied: boolean;
  storageLimitEnforced: boolean;
  storageBackend: string;
  storageStatus: string;
  storageLimitMessage: string;
  virtualizationMode?: "standard" | "nested";
  nestingEnabled?: boolean;
  kvmAvailable?: boolean;
  createdAt: Date;
};

export type HostCapacity = {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  cpuCount: number;
  rootFilesystemAvailableBytes: number;
  existingContainerCount: number;
};

export interface VpsProvider {
  getContainerName(
    vpsNumber: number,
    customerUsername?: string,
  ): string;

  getHostCapacity(): Promise<HostCapacity>;

  containerExists(
    containerName: string,
  ): Promise<boolean>;

  getContainerInfo(
    containerName: string,
  ): Promise<LxcContainerInfo>;

  provision(
    request: LxcProvisionRequest,
  ): Promise<LxcProvisionResult>;

  start(
    containerName: string,
  ): Promise<LxcContainerInfo>;

  stop(
    containerName: string,
  ): Promise<LxcContainerInfo>;

  restart(
    containerName: string,
  ): Promise<LxcContainerInfo>;

  destroy(
    containerName: string,
  ): Promise<void>;

  runInContainer(
    containerName: string,
    command: string,
    timeoutMs?: number,
  ): Promise<string>;
}
