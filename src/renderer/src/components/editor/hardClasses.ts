// CFEngine's built-in hard classes — a curated, cross-platform list, not a raw
// dump from one machine: hard classes are OS-dependent (a Linux host never
// reports "windows", a Darwin host never reports "redhat"), so a single-host
// dump would be missing most platforms entirely. Every name here is verified
// against CFEngine Core 3.28.0's own shipped policy (CoreBase/inventory/*.cf)
// or the Masterfiles Policy Framework, not recalled from memory.
export interface HardClass {
  description?: string;
  name: string;
}

export const hardClasses: HardClass[] = [
  { name: 'any', description: 'Always true — matches every host' },
  { name: 'linux', description: 'Linux kernel' },
  { name: 'darwin', description: 'Darwin/BSD kernel (macOS)' },
  { name: 'macos', description: 'macOS' },
  { name: 'windows', description: 'Microsoft Windows' },
  { name: 'freebsd', description: 'FreeBSD' },
  { name: 'solaris', description: 'Solaris/illumos' },
  { name: 'aix', description: 'IBM AIX' },
  { name: 'debian', description: 'Debian and derivatives' },
  { name: 'ubuntu', description: 'Ubuntu' },
  { name: 'linuxmint', description: 'Linux Mint' },
  { name: 'redhat', description: 'Red Hat Enterprise Linux and derivatives' },
  { name: 'centos', description: 'CentOS' },
  { name: 'fedora', description: 'Fedora' },
  { name: 'oracle', description: 'Oracle Linux' },
  { name: 'rocky', description: 'Rocky Linux' },
  { name: 'almalinux', description: 'AlmaLinux' },
  { name: 'sles', description: 'SUSE Linux Enterprise Server' },
  { name: 'sled', description: 'SUSE Linux Enterprise Desktop' },
  { name: 'opensuse', description: 'openSUSE' },
  { name: '32_bit', description: '32-bit architecture' },
  { name: '64_bit', description: '64-bit architecture' },
  { name: 'cfengine', description: 'Always true on a CFEngine agent' },
  { name: 'cfengine_3', description: 'Running CFEngine major version 3' },
  { name: 'community_edition', description: 'Running CFEngine Community Edition' },
  { name: 'enterprise_edition', description: 'Running CFEngine Enterprise' },
  { name: 'policy_server', description: 'This host is a policy server' },
  { name: 'am_policy_hub', description: 'Alias for policy_server' }
];
