# Runs on the hub, as root, fed to `sh -s` by deployOverSsh() in deploy.ts.
# What cf-remote deploy does, plus cf-promises before the swap, so a bad policy
# never replaces a working one. $1 is the login user's private temporary
# directory, holding masterfiles.tgz (the built masterfiles/).
# "::stage <id>" lines on stdout report progress.
set -e
work=$(mktemp -d)
trap 'rm -rf "$work" "$1"' EXIT

# The install: the official packages' /var/cfengine, or a distro package (cf-agent on PATH).
if [ -x /var/cfengine/bin/cf-agent ]; then
  bin=/var/cfengine/bin
  kind="official package"
elif command -v cf-agent >/dev/null 2>&1; then
  bin=$(dirname "$(command -v cf-agent)")
  kind="distro package"
else
  echo "CFEngine isn't installed on this host" >&2
  exit 3
fi

# Where this install keeps masterfiles, as CFEngine itself reports it.
printf 'bundle agent main {}\n' > "$work/probe.cf"
chmod 600 "$work/probe.cf"
master=$("$bin/cf-promises" -f "$work/probe.cf" --show-vars='sys\.masterdir' | awk '$1 == "default:sys.masterdir" { print $2 }')
case "$master" in
  /?*) ;;
  *)
    echo "Can't find this host's masterfiles directory" >&2
    exit 3
    ;;
esac
echo "CFEngine: $("$bin/cf-agent" -V | head -n 1), $kind in $bin; masterfiles: $master"

tar -xzf "$1/masterfiles.tgz" -C "$work" --no-same-owner

echo "::stage validate"
"$bin/cf-promises" -f "$work/masterfiles/promises.cf"

echo "::stage install"
mkdir -p "$(dirname "$master")"
rm -rf "$master.delete"
if [ -e "$master" ]; then mv "$master" "$master.delete"; fi
mv "$work/masterfiles" "$master"
rm -rf "$master.delete"

echo "::stage update"
"$bin/cf-agent" -Kf update.cf

echo "::stage policy"
"$bin/cf-agent" -K
