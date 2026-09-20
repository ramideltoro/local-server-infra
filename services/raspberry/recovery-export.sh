#!/usr/bin/env bash
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
# Invoked only through a restricted SSH key. Never execute caller-provided text.
case "${1:-}" in
 revision)
   { tar --sort=name --mtime=@0 --owner=0 --group=0 -cf - /etc /usr/local /boot/firmware/config.txt /boot/firmware/cmdline.txt /usr/lib/systemd/system/readsb.service /usr/bin/readsb /var/lib/dpkg/status 2>/dev/null; } | sha256sum | cut -d' ' -f1
   ;;
 archive)
   # Stream off-host; no snapshot or image consumes the Pi's scarce disk space.
   nice -n 19 ionice -c 3 tar --one-file-system --numeric-owner --acls --xattrs \
     --exclude='./proc' --exclude='./sys' --exclude='./dev' --exclude='./run' \
     --exclude='./tmp' --exclude='./var/tmp' --exclude='./var/cache' \
     --exclude='./var/swap' --exclude='./lost+found' \
     -cpf - -C / . ./boot/firmware | gzip -1
   ;;
 *) exit 64 ;;
esac
