export type OsAvailability = "available" | "unavailable";

export interface OsDefinition {
  id: string;
  displayName: string;
  distribution: string;
  version: string;
  incusAlias: string | null;
  availability: OsAvailability;
  recommended?: boolean;
  description: string;
}

export const CENTRAL_OS_CATALOG: readonly OsDefinition[] = [
  { id: "ubuntu-24-04", displayName: "Ubuntu 24.04 LTS (Noble)", distribution: "ubuntu", version: "24.04", incusAlias: "24.04", availability: "available", recommended: true, description: "Recommended for most workloads and modern software stacks." },
  { id: "ubuntu-22-04", displayName: "Ubuntu 22.04 LTS (Jammy)", distribution: "ubuntu", version: "22.04", incusAlias: "22.04", availability: "available", description: "Stable Ubuntu LTS release." },
  { id: "debian-13", displayName: "Debian 13 (Trixie)", distribution: "debian", version: "13", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "debian-12", displayName: "Debian 12 (Bookworm)", distribution: "debian", version: "12", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "debian-11", displayName: "Debian 11 (Bullseye)", distribution: "debian", version: "11", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "centos-stream-10", displayName: "CentOS Stream 10", distribution: "centos", version: "10", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "centos-stream-9", displayName: "CentOS Stream 9", distribution: "centos", version: "9", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "almalinux-10", displayName: "AlmaLinux 10", distribution: "almalinux", version: "10", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "almalinux-9", displayName: "AlmaLinux 9", distribution: "almalinux", version: "9", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "almalinux-8", displayName: "AlmaLinux 8", distribution: "almalinux", version: "8", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "rocky-10", displayName: "Rocky Linux 10", distribution: "rocky", version: "10", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "rocky-9", displayName: "Rocky Linux 9", distribution: "rocky", version: "9", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "rocky-8", displayName: "Rocky Linux 8", distribution: "rocky", version: "8", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "fedora-44", displayName: "Fedora 44", distribution: "fedora", version: "44", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "fedora-43", displayName: "Fedora 43", distribution: "fedora", version: "43", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "fedora-42", displayName: "Fedora 42", distribution: "fedora", version: "42", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
  { id: "kali", displayName: "Kali Linux", distribution: "kali", version: "rolling", incusAlias: null, availability: "unavailable", description: "Currently unavailable on this Incus node." },
];

export function getOsCatalog(): OsDefinition[] {
  return [...CENTRAL_OS_CATALOG];
}

export function getOsById(osId: string): OsDefinition | undefined {
  return CENTRAL_OS_CATALOG.find((os) => os.id === osId);
}

export function getAvailableOsList(): OsDefinition[] {
  return CENTRAL_OS_CATALOG.filter((os) => os.availability === "available" && os.incusAlias);
}

export function getDefaultOs(): OsDefinition {
  return getAvailableOsList().find((os) => os.recommended) ?? getAvailableOsList()[0];
}
